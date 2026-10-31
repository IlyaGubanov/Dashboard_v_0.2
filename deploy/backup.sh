#!/usr/bin/env bash
# Резервная копия: база (mysqldump) и файлы (фото, документы). Старые копии удаляются.
#
#   bash deploy/backup.sh                    — в /var/backups/mvs, хранить 14 дней
#   BACKUP_DIR=/mnt/nas/mvs KEEP_DAYS=30 bash deploy/backup.sh
#
# Копию стоит регулярно уносить с сервера (сетевой диск, другой сервер): при потере ВМ локальная копия пропадёт вместе с ней.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/var/backups/mvs}
KEEP=${KEEP_DAYS:-14}
STAMP=$(date +%F_%H%M)
mkdir -p "$DIR"
chmod 700 "$DIR"

# Recorder passwords require the matching key; this private file must travel with the DB backup.
if [[ -f .env ]]; then
  cp -- .env "$DIR/secrets-$STAMP.env"
  chmod 600 "$DIR/secrets-$STAMP.env"
fi

echo "$(date '+%F %T') начало резервной копии → $DIR"

# база: согласованный снимок без блокировки работы пользователей; пишем во временный файл, чтобы не оставить обрывок
docker compose exec -T db sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces "$MYSQL_DATABASE"' \
  | gzip >"$DIR/db-$STAMP.sql.gz.part"
mv "$DIR/db-$STAMP.sql.gz.part" "$DIR/db-$STAMP.sql.gz"

# Reuse the running container: compose run api would conflict with its fixed control-network IP.
docker compose exec -T api tar czf - -C /data/files . >"$DIR/files-$STAMP.tar.gz.part"
mv "$DIR/files-$STAMP.tar.gz.part" "$DIR/files-$STAMP.tar.gz"

# проверка: архивы читаются, в дампе есть таблицы
gzip -t "$DIR/db-$STAMP.sql.gz"
gzip -t "$DIR/files-$STAMP.tar.gz"
tables=$(gzip -dc "$DIR/db-$STAMP.sql.gz" | grep -c '^CREATE TABLE' || true)
[[ "$tables" -gt 20 ]] || { echo "ОШИБКА: в дампе только $tables таблиц" >&2; exit 1; }

find "$DIR" -name 'db-*.sql.gz' -mtime +"$KEEP" -delete
find "$DIR" -name 'files-*.tar.gz' -mtime +"$KEEP" -delete
find "$DIR" -name 'secrets-*.env' -mtime +"$KEEP" -delete
find "$DIR" -name '*.part' -mtime +1 -delete

echo "$(date '+%F %T') готово: db-$STAMP.sql.gz ($(du -h "$DIR/db-$STAMP.sql.gz" | cut -f1), таблиц $tables), files-$STAMP.tar.gz ($(du -h "$DIR/files-$STAMP.tar.gz" | cut -f1))"
