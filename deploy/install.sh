#!/usr/bin/env bash
# Первая установка МВС СТ на сервер Ubuntu 22.04/24.04 (виртуальная машина Hyper-V).
#
#   sudo bash deploy/install.sh             — установить Docker (если нет), создать .env, запустить, включить резервные копии
#   bash deploy/install.sh --env-only       — только создать .env (для проверки или ручного запуска)
#
# Скрипт можно запускать повторно: существующий .env не перезаписывается, Docker не переустанавливается.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
# пароль из букв и цифр: проходит политику паролей приложения (буква + цифра, от 10 символов)
gen() {
  local s
  s=$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
  printf 'Mv7%s' "${s:0:${1:-24}}"
}

ask() { # ask ПЕРЕМЕННАЯ "вопрос" "значение по умолчанию"
  local v
  read -r -p "$2 [$3]: " v || true
  printf -v "$1" '%s' "${v:-$3}"
}

create_env() {
  if [[ -f .env ]]; then
    say ".env уже есть — оставляю как есть"
    return
  fi
  say "Настройка (.env)"
  local domain tls demo
  ask domain "Домен приложения (DNS A-запись на внешний IP сервера)" "dashboard.example.ru"
  ask tls "Сертификат: auto (Let's Encrypt) / files (свой, в deploy/certs) / internal (самоподписанный)" "auto"
  [[ "$tls" =~ ^(auto|files|internal)$ ]] || die "режим сертификата: auto, files или internal"
  ask demo "Загрузить демо-данные для показа? true / false (для боевого запуска — false)" "true"
  local admin_pass
  admin_pass=$(gen 14)
  sed \
    -e "s|^DOMAIN=.*|DOMAIN=${domain}|" \
    -e "s|^TLS_MODE=.*|TLS_MODE=${tls}|" \
    -e "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$(gen 28)|" \
    -e "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=$(gen 28)|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${admin_pass}|" \
    -e "s|^DEMO_DATA=.*|DEMO_DATA=${demo}|" \
    -e "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" \
    -e "s|^API_DOCS=.*|API_DOCS=false|" \
    .env.example >.env
  chmod 600 .env
  say "Создан .env (права 600). Пароли сгенерированы."
  echo "  Первый вход: логин admin, пароль ${admin_pass} — система попросит сменить его."
  echo "  Пароль также записан в .env (ADMIN_PASSWORD). После первого входа он больше не используется."
}

install_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    say "Docker уже установлен: $(docker --version)"
    return
  fi
  [[ $EUID -eq 0 ]] || die "для установки Docker запустите через sudo"
  say "Установка Docker из репозитория Ubuntu"
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 curl
  systemctl enable --now docker
}

wait_healthy() {
  say "Ожидание запуска (миграции и загрузка данных — до нескольких минут)"
  for _ in $(seq 1 90); do
    if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "  API отвечает."
      return
    fi
    sleep 5
  done
  docker compose logs --tail=80 api
  die "API не запустился за 7,5 минут — см. журнал выше"
}

install_backup_cron() {
  local cron=/etc/cron.d/mvs-backup
  [[ $EUID -eq 0 ]] || { echo "  (резервные копии по расписанию: запустите скрипт через sudo или добавьте cron вручную)"; return; }
  echo "30 2 * * * root bash ${ROOT}/deploy/backup.sh >>/var/log/mvs-backup.log 2>&1" >"$cron"
  chmod 644 "$cron"
  say "Резервная копия — каждый день в 02:30 (${cron}), хранится 14 дней в /var/backups/mvs"
}

create_env
[[ "${1:-}" == "--env-only" ]] && exit 0

install_docker
say "Сборка и запуск контейнеров"
docker compose up -d --build
wait_healthy
install_backup_cron

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
say "Готово"
echo "  Откройте https://${DOMAIN}"
echo "  Проверка снаружи: порты 80 и 443 должны быть открыты на межсетевом экране и проброшены на этот сервер."
echo "  Дальше — по плану запуска: docs/10-zapusk.md"
