# МВС СТ — производственный дашборд

Клиент-серверное приложение: сводка руководства по направлениям (Школы, МКД, Сети, Благоустройство),
ввод данных ответственными, кураторы направлений, журнал изменений.

| Папка | Что внутри |
|---|---|
| `apps/api` | сервер: NestJS + Prisma, схема БД `prisma/schema.prisma`, миграции, сид |
| `apps/web` | интерфейс: React + Vite + Mantine + TanStack Router/Query |
| `packages/shared` | общие типы и проверки (zod) для сервера и интерфейса |
| `deploy/caddy` | HTTPS-шлюз: сертификат, перенаправление на https, заголовки безопасности |
| `docs/` | анализ, архитектура, описание БД, [развёртывание](docs/03-razvertyvanie.md), [расчёт показателей](docs/04-raschet-pokazateley.md), [экраны направлений](docs/05-ekrany-napravleniy.md), [ввод данных](docs/06-vvod-dannyh.md), [конструктор направлений](docs/07-konstruktor.md), [замечания и файлы](docs/08-zamechaniya-i-faily.md), [прогнозы, задачи, телефон](docs/09-prognozy-zadachi-telefon.md), **[план запуска](docs/10-zapusk.md)** |

## Запуск на сервере (Docker, HTTPS)

Пошагово — в [docs/03-razvertyvanie.md](docs/03-razvertyvanie.md): виртуальная машина в Hyper-V, домен, порты, режимы сертификата, резервные копии.

```bash
sudo bash deploy/install.sh    # спросит домен, сгенерирует пароли, запустит, включит ночные копии
```

Приложение откроется на `https://<DOMAIN>`. Сертификат Let's Encrypt выпускается автоматически (`TLS_MODE=auto`),
можно подключить сертификат организации (`files`) или временный собственный (`internal`).
Первый вход: логин `admin` и пароль, который выведет скрипт, — система сразу попросит сменить пароль.
Копии, восстановление, обновление: `deploy/backup.sh`, `deploy/restore.sh`, `deploy/update.sh`.
Порядок запуска для пользователей — [docs/10-zapusk.md](docs/10-zapusk.md).

При каждом старте контейнер `api` применяет новые миграции и дозаполняет справочники — отдельных действий при обновлении не нужно.

## Демо-данные

Данные исходного дашборда (4 школы, 42 адреса МКД, 154 объекта Сетей, 37 улиц с отчётами) лежат в
`apps/api/prisma/demo/*.json`. При `DEMO_DATA=true` (по умолчанию) они загружаются при первом старте.

```bash
docker compose exec api npm run db:demo -- --force           # перезагрузить демо-данные
docker compose exec api npm run db:demo -- --clear           # удалить демо-данные перед вводом реальных (обратно при перезапуске не вернутся)
docker compose exec api npm run db:demo:verify               # сверить показатели с исходным дашбордом
```

Можно ограничить направления: `-- --only=mkd,networks`. Пересобрать JSON из HTML-модулей: `node scripts/extract-demo.mjs <папка с модулями>`.

## Разработка

Нужны Node.js 22+ и MySQL 8.0+ (можно в Docker: `docker compose up -d db` с открытым портом 3306).

```bash
npm install
npm run build -w @mvs/shared
cd apps/api && npx prisma migrate deploy && npx tsx prisma/seed.ts && npm run db:demo && cd ../..
COOKIE_SECURE=false npm run dev:api     # http://localhost:3000/api (вход по http — только при разработке)
npm run dev:web     # http://localhost:5173
```

Изменили `schema.prisma` → создайте миграцию: `cd apps/api && npx prisma migrate dev --name <что_изменили>`.

## Роли

| Роль | Права |
|---|---|
| Администратор | всё: пользователи, роли, настройки направлений |
| Руководство | просмотр сводки и всех направлений |
| Куратор направления | всё в своём направлении, закрытие отчётных периодов |
| Ответственный за ввод | ввод факта по всем объектам направления или только по назначенным |
| Просмотр | просмотр направления |
