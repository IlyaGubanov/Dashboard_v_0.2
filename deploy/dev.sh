#!/usr/bin/env bash
# Ручной запуск только отдельного dev-сервера. См. docs/DEV_DEPLOYMENT.md.
set -euo pipefail
umask 077

die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
case "${1:-}" in
  start|update) action=$1 ;;
  ''|-h|--help)
    printf '%s\n' 'bash deploy/dev.sh start   — первый запуск на подготовленной dev-VM' \
      'bash deploy/dev.sh update  — копия данных и обновление из origin/dev' \
      'Подготовка Debian 13, .env и сертификата: docs/DEV_DEPLOYMENT.md'
    exit 0 ;;
  *) die 'используйте start или update; справка: --help' ;;
esac
[[ $# == 1 ]] || die 'ожидается только start или update'

cd "$(dirname "$0")/.."
for cmd in git docker curl openssl flock; do
  command -v "$cmd" >/dev/null || die "не найдена команда $cmd; сначала подготовьте VM по инструкции"
done
[[ $(git branch --show-current) == dev ]] || die 'запускайте только в ветке dev на отдельной dev-VM'

# Один ручной запуск за раз. Ключи и пароли не читаются через source и не попадают в журнал.
exec 9>"$(git rev-parse --git-path mvsst-dev.lock)"
flock -n 9 || die 'другое обновление уже выполняется; дождитесь его завершения'
[[ -f .env ]] || die 'сначала создайте .env по инструкции'
setting() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit}' .env; }
[[ $(setting COMPOSE_PROJECT_NAME) == mvsst-dev ]] || die 'в .env требуется COMPOSE_PROJECT_NAME=mvsst-dev'
[[ $(setting TLS_MODE) == files ]] || die 'в .env требуется TLS_MODE=files для вашего wildcard-сертификата'
domain=$(setting DOMAIN)
[[ $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ && $domain == *.* ]] || die 'DOMAIN должен содержать DNS-имя без https://, порта и пути'
export COMPOSE_PROJECT_NAME=mvsst-dev
export COMPOSE_FILE="$PWD/docker-compose.yml"

check_files() {
  git diff --quiet && git diff --cached --quiet || die 'есть локальные изменения; сохраните и разберите их вручную'
  [[ -z $(git ls-files --others --exclude-standard) ]] || die 'есть локальные изменения: неотслеживаемые файлы; перенесите их вне репозитория'
  [[ -f deploy/certs/cert.pem && -f deploy/certs/key.pem ]] || die 'установите сертификат cert.pem и ключ key.pem по инструкции'
  openssl x509 -in deploy/certs/cert.pem -noout -checkhost "$domain" >/dev/null 2>&1 || die 'сертификат не покрывает DOMAIN'
  openssl x509 -in deploy/certs/cert.pem -noout -checkend 0 >/dev/null 2>&1 || die 'истёк срок действия сертификата'
  local cert_key private_key
  cert_key=$(openssl x509 -in deploy/certs/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
  private_key=$(openssl pkey -in deploy/certs/key.pem -passin pass: -pubout -outform DER | openssl dgst -sha256)
  [[ $cert_key == "$private_key" ]] || die 'сертификат и закрытый ключ не соответствуют друг другу'
}
check_files
docker info >/dev/null
docker compose version >/dev/null

printf '\n== Получение origin/dev\n'
git fetch origin refs/heads/dev:refs/remotes/origin/dev
git merge-base --is-ancestor HEAD origin/dev || die 'локальная dev содержит коммиты вне origin/dev; автоматическое выравнивание запрещено'
target=$(git rev-parse origin/dev)
previous=$(git rev-parse HEAD)

if [[ $action == start ]]; then
  [[ -z $(docker compose ps -a -q) ]] || die 'контейнеры уже существуют; для обновления используйте update с резервной копией'
else
  # До смены кода: если копия не получилась, работающая версия не обновляется.
  export BACKUP_DIR="${BACKUP_DIR:-/var/backups/mvsst-dev}/$(date +%Y%m%d-%H%M%S-%N)-${previous:0:12}"
  printf '\n== Резервная копия → %s\n' "$BACKUP_DIR"
  bash deploy/backup.sh
  printf '%s\n' "$previous" > "$BACKUP_DIR/code-sha.txt"
  marker=$(git rev-parse --git-path mvsst-dev.deployed)
  if [[ -f $marker ]]; then cp "$marker" "$BACKUP_DIR/last-successful-sha.txt"; fi
fi

git merge --ff-only "$target"
check_files
bash deploy/video-secrets.sh
docker compose config -q
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

printf '\n== Сборка (прежние контейнеры продолжают работать)\n'
for service in api web mediamtx; do docker compose build "$service"; done
printf '\n== Запуск контейнеров и применение миграций\n'
docker compose up -d --build

printf '\n== Проверка HTTPS и базы данных\n'
curl --fail --silent --show-error --retry 60 --retry-delay 5 --retry-all-errors \
  --connect-timeout 5 --max-time 10 --retry-max-time 600 "https://$domain/api/health"
curl --fail --silent --show-error --output /dev/null --connect-timeout 5 --max-time 20 "https://$domain/"
marker=$(git rev-parse --git-path mvsst-dev.deployed)
printf '%s\n' "$target" > "$marker.tmp"
mv "$marker.tmp" "$marker"
printf '\nГотово: https://%s\nПроверенный коммит: %s\n' "$domain" "$target"
docker compose ps
