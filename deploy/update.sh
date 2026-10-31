#!/usr/bin/env bash
# Обновление приложения: копия → новая версия кода → пересборка → проверка.
# Миграции базы применяются автоматически при старте API (только добавляющие; init не переписывается).
#
#   bash deploy/update.sh            — если код получен через git: git pull
#   bash deploy/update.sh --no-pull  — код уже обновлён вручную (скопирован архивом)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Резервная копия перед обновлением"
bash deploy/video-secrets.sh
bash deploy/backup.sh

if [[ "${1:-}" != "--no-pull" ]]; then
  if [[ -d .git ]]; then
    echo "== Получение новой версии"
    git pull --ff-only
  else
    echo "Каталог не под git — обновите файлы вручную и запустите с --no-pull" >&2
    exit 1
  fi
fi

echo "== Сборка и перезапуск"
bash deploy/video-secrets.sh
# Образы собираются по очереди: одновременная сборка сервера и интерфейса требует 3–4 ГБ памяти,
# при нехватке сервер уходит в подкачку и сборка тянется десятками минут.
# Пока идёт сборка, работает прежняя версия; Ctrl+C до строки «-- перезапуск» её не затрагивает.
for svc in api web mediamtx; do
  echo "-- сборка: $svc"
  docker compose build "$svc"
done
echo "-- перезапуск"
# --build: всё уже собрано (берётся из кеша за секунды); дособерёт службу, если её нет в списке выше
docker compose up -d --build

echo "== Проверка"
for _ in $(seq 1 60); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "API отвечает. Обновление завершено."
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done
docker compose logs --tail=80 api
echo "API не запустился. Откат: bash deploy/restore.sh с последней копией и предыдущая версия кода (git checkout)." >&2
exit 1
