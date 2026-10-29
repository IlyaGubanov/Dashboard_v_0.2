#!/usr/bin/env bash
# Обновление приложения: копия → новая версия кода → пересборка → проверка.
# Миграции базы применяются автоматически при старте API (только добавляющие; init не переписывается).
#
#   bash deploy/update.sh            — если код получен через git: git pull
#   bash deploy/update.sh --no-pull  — код уже обновлён вручную (скопирован архивом)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Резервная копия перед обновлением"
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
