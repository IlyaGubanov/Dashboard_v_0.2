# Вместо автодеплоя — ручной запуск dev

Команда выбрала ручное развёртывание. Актуальная инструкция для чистой Debian 13,
локальной сети, приватного GitHub и wildcard-сертификата:
**[DEV_DEPLOYMENT.md](DEV_DEPLOYMENT.md)**. Скрипт: [deploy/dev.sh](../deploy/dev.sh).

GitHub runner и deploy-задания Actions не требуются. Коммиты и merge сами сервер не обновляют.
