#!/usr/bin/env bash
# Восстановление из резервной копии. ЗАМЕНЯЕТ текущие данные: всё, что внесено после копии, будет потеряно.
#
#   bash deploy/restore.sh /var/backups/mvs/db-2026-11-02_0230.sql.gz [/var/backups/mvs/files-2026-11-02_0230.tar.gz]
#
# Перед восстановлением делается копия текущего состояния (на случай, если выбрали не тот файл).
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${1:?Укажите файл копии базы: db-ГГГГ-ММ-ДД_ЧЧММ.sql.gz}
FILES=${2:-}
[[ -f "$DB" ]] || { echo "Нет файла $DB" >&2; exit 1; }
[[ -z "$FILES" || -f "$FILES" ]] || { echo "Нет файла $FILES" >&2; exit 1; }
gzip -t "$DB"

echo "Будет восстановлена база из: $DB"
[[ -n "$FILES" ]] && echo "и файлы из: $FILES"
echo "Текущие данные будут ЗАМЕНЕНЫ. Пользователи на время восстановления не смогут работать."
read -r -p "Продолжить? Введите ДА: " ok
[[ "$ok" == "ДА" ]] || { echo "Отменено"; exit 1; }

echo "Копия текущего состояния перед восстановлением…"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/mvs}/before-restore KEEP_DAYS=90 bash deploy/backup.sh

docker compose stop web mediamtx api
gzip -dc "$DB" | docker compose exec -T db sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
if [[ -n "$FILES" ]]; then
  docker compose run --rm --no-deps -T -v "$(cd "$(dirname "$FILES")" && pwd)":/backup files-helper \
    -c "find /data/files -mindepth 1 -delete && tar xzf /backup/$(basename "$FILES") -C /data/files"
fi
docker compose up -d --no-build api mediamtx web
echo "Видеонаблюдение: проверьте VIDEO_ENCRYPTION_KEY из secrets-*.env той же резервной копии. Без совпадающего ключа пароли регистраторов не расшифруются."
echo "Готово. Входы пользователей сохранились из копии; при необходимости попросите войти заново."
