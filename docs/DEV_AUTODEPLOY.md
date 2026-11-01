# Автодеплой dev: Debian 13, локальная сеть, GitHub Free

Это инструкция для администратора. Она не означает, что сервер уже настроен.
Команды выполняются **на отдельной dev-VM**. Production и его данные в этой процедуре не используются.
Сначала сделайте Dashboard_v_0.2 приватным, затем подключайте собственный GitHub runner.
Для HTTPS используется имеющийся wildcard-сертификат организации, режим Caddy `TLS_MODE=files`.

## Что получится

```text
Коммит или merge в dev
    → CI на GitHub: типы, тесты, сборка
    → при успехе задание получает runner внутри локальной сети
    → dev-VM получает проверенный коммит
    → резервная копия, сборка контейнеров, миграции, проверка сайта
```

Runner — небольшая служба на вашей VM, которая сама подключается к GitHub.
Пробрасывать входящие порты из интернета на VM не требуется. Push в mvsst-N и main не развёртывает dev.
При частых коммитах промежуточные устаревшие версии могут пропускаться: разворачивается актуальная dev.

GitHub Free подходит: использование собственного runner бесплатно, облачный CI приватного репозитория
расходует включённую квоту аккаунта владельца. Квота не бесконечна; смотрите Billing → Usage/Budgets.
Если привязана карта, ограничьте Actions бюджетом с остановкой потребления при достижении лимита.
Платные environments, обязательные approvals и branch protection для этой схемы не нужны.
[Условия и квоты GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## 1. Подготовить VM и адрес

Практический начальный размер: 4 vCPU, 8 ГБ ОЗУ, диск от 80 ГБ. Сборка выполняется на VM.
Понадобятся постоянный локальный IP и DNS-имя, покрываемое вашим wildcard-сертификатом.
Например, для `*.example.org` подходит `dev.example.org`, но не `dashboard.dev.example.org`,
не само `example.org` и не IP-адрес (если они не перечислены в SAN отдельно).
Здесь `example.org` — **пример**: замените его доменом из вашего сертификата во всех командах,
DOMAIN и DEV_URL. Сопоставление wildcard ограничено одним уровнем имени:
[правила TLS](https://www.rfc-editor.org/rfc/rfc9525.html#section-6.3).

Внутренний DNS должен направлять выбранное имя на локальный IP dev-VM; сама VM также должна
разрешать это имя. Публичная DNS-запись и доступ из интернета для использования готового сертификата
не требуются. Открывать приложение и проверять HTTPS нужно по имени, а не по IP.

Доступ пользователей: HTTPS/443 из локальной сети, HTTP/80 для перенаправления.
SSH/22 — только для администратора из локальной сети. Не делайте внешнего NAT на эту VM.
Учтите: публикация портов Docker может обходить правила UFW; ограничение локальной сетью
проверяется на сетевом экране/маршрутизаторе и в правилах Docker, а не только командой ufw.

Исходящий доступ: Debian/Docker repositories, GitHub и адреса Actions из
[требований GitHub runner](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
реестры Docker-образов и npm. Сам runner использует HTTPS/443; доступ Git к GitHub настроим также через 443.
На хосте не нужно устанавливать Node.js или MySQL: приложение работает в Docker.

## 2. Установить Docker на Debian 13

Под администратором с sudo. Если рабочие Docker Engine и Compose уже установлены, проверьте версии
и не переустанавливайте их. Следующие команды рассчитаны на новую VM без конфликтующих Docker-пакетов.
Это установка из [официального репозитория Docker для Debian](https://docs.docker.com/engine/install/debian/).

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssh-client openssl util-linux nano
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Штатный `deploy/install.sh` имеет установочный fallback для Ubuntu. На Debian сначала установите
Docker командами выше. Для создания .env ниже используется только его режим `--env-only`.

## 3. Создать пользователя и доступ к приватному GitHub

Под администратором:

```bash
sudo adduser --disabled-password --gecos '' mvsst-dev
sudo usermod -aG docker mvsst-dev
sudo install -d -o mvsst-dev -g mvsst-dev /srv/mvsst-dev
sudo install -d -m 0700 -o mvsst-dev -g mvsst-dev /var/lib/mvsst-dev /var/backups/mvsst-dev
sudo -iu mvsst-dev
```

Далее под **mvsst-dev**. Эта учётная запись управляет Docker на dev-VM; production-доступ ей не выдаётся.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/mvsst-dev-repo -N '' -C mvsst-dev-read-only
cat ~/.ssh/mvsst-dev-repo.pub
```

В GitHub: репозиторий → Settings → Deploy keys → Add deploy key. Вставить **публичный** ключ .pub,
назвать `dev VM read-only`, **Allow write access не включать**. Настройку выполняет участник с admin-доступом.
Закрытый ключ остаётся на dev-VM, его не отправляют в чат и не записывают в репозиторий.

Создать `~/.ssh/config`:

```sshconfig
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/mvsst-dev-repo
    IdentitiesOnly yes
```

```bash
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

При первом подключении сверить fingerprint с
[официальным списком GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints),
после совпадения подтвердить сохранение ключа. Сообщение об успешной аутентификации без shell-доступа
означает успех; сама команда ssh -T при этом может вернуть код 1.
[Про SSH через порт 443](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port).

## 4. Один раз развернуть приложение вручную

Под **mvsst-dev**:

```bash
git clone --branch dev git@github.com:IlyaGubanov/Dashboard_v_0.2.git /srv/mvsst-dev/app
cd /srv/mvsst-dev/app
bash deploy/install.sh --env-only
```

На вопросы скрипта: DNS-имя dev-сайта из вашего wildcard-домена, режим `files`,
демо-данные `true` для тестовой среды. Скрипт создаст .env и отдельные случайные пароли.
Перед первым запуском открыть `nano .env` и проверить/добавить:

```dotenv
COMPOSE_PROJECT_NAME=mvsst-dev
DOMAIN=dev.example.org
TLS_MODE=files
MYSQL_DATABASE=mvs_dev
MYSQL_USER=mvs_dev
ADMIN_LOGIN=admin
COOKIE_SECURE=true
DEMO_DATA=true
API_DOCS=false
VIDEO_ALLOWED_NETWORKS=
VIDEO_ALLOWED_DNS_SUFFIXES=
```

Это фрагмент, а не замена всего .env. MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, ADMIN_PASSWORD и
VIDEO_* ключи оставить сгенерированными. Не копировать .env, БД, пользовательские файлы,
учётные данные и служебные ключи production. Общий TLS wildcard-сертификат устанавливается отдельно
из согласованного защищённого хранилища организации, как описано ниже.
При DEMO_DATA=true загружаются штатные демо-данные, а не production-БД. Подключение реальных камер
не требуется; пустые VIDEO_ALLOWED_NETWORKS/DNS_SUFFIXES запрещают их сетевой доступ.
Проверьте, что VIDEO_CONTROL_SUBNET не пересекается с вашей локальной сетью/VPN/другими Docker-сетями.

### Установить wildcard-сертификат до запуска контейнеров

Администратор передаёт на dev-VM два PEM-файла:

- `fullchain.pem`: сначала серверный wildcard-сертификат, затем промежуточные сертификаты по цепочке;
- `privatekey.pem`: соответствующий закрытый ключ без пароля, чтобы Caddy мог запускаться автоматически.

Корневой CA обычно не добавляется в выдаваемую сервером цепочку. Если исходник — PFX/P12,
администратор сначала экспортирует из него эти PEM-файлы. Не размещать закрытый ключ в GitHub,
чатах, workflow или общедоступной папке.

В командах ниже `/srv/mvsst-dev/incoming` — временный закрытый каталог приёма файлов, доступный
пользователю mvsst-dev. Создайте его с правами 700 и передайте файлы туда защищённым способом.
Далее под **mvsst-dev**, в `/srv/mvsst-dev/app`:

```bash
install -d -m 0700 /srv/mvsst-dev/incoming
install -d -m 0700 deploy/certs
install -m 0644 /srv/mvsst-dev/incoming/fullchain.pem deploy/certs/cert.pem
install -m 0600 /srv/mvsst-dev/incoming/privatekey.pem deploy/certs/key.pem
openssl x509 -in deploy/certs/cert.pem -noout -subject -issuer -dates -ext subjectAltName
openssl x509 -in deploy/certs/cert.pem -noout -checkhost dev.example.org
openssl x509 -in deploy/certs/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256
openssl pkey -in deploy/certs/key.pem -pubout -outform DER | openssl dgst -sha256
```

Последние две строки должны вывести одинаковый SHA-256: это проверка соответствия сертификата ключу.
Также проверить срок действия и DNS-имя. Команды не выводят закрытый ключ.
`deploy/certs/*.pem` исключены из Git. Docker монтирует каталог в Caddy как `/certs` только для чтения;
существующий `tls-files.caddy` использует `/certs/cert.pem` и `/certs/key.pem`.
[Поддерживаемый формат Caddy](https://caddyserver.com/docs/caddyfile/directives/tls).

Теперь проверить конфигурацию и запустить контейнеры:

```bash
chmod 600 .env
docker compose config -q
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
for service in api web mediamtx; do docker compose build "$service"; done
docker compose up -d
docker compose ps
docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health
```

Дождаться healthy у db и api: первый запуск применяет миграции и наполняет демо-данные, это занимает
несколько минут. После настройки доверия к CA ниже открыть `https://ВАШ_DEV_АДРЕС`, войти
и сменить начальный пароль администратора.
При ошибке сначала смотреть `docker compose logs --tail=150 api caddy web`.

После ручного запуска вернуться от пользователя mvsst-dev к администратору:

```bash
exit
```

Если сертификат выдан публичным CA, которому уже доверяют Debian и браузеры, ничего добавлять
в доверенные сертификаты не нужно. Если его выдал внутренний CA организации, администратор
устанавливает **корневой сертификат CA организации** на dev-VM и клиентские компьютеры.
На Debian (путь к исходному CA-файлу — пример, заменить своим):

```bash
sudo install -m 0644 /secure/corp-root-ca.crt /usr/local/share/ca-certificates/mvsst-org-root.crt
sudo update-ca-certificates
```

Не добавлять сам серверный wildcard-сертификат в корневые CA. В этой схеме тестовый CA Caddy
не используется. После настройки доверия проверить с VM:

```bash
curl --fail https://dev.example.org/api/health
curl --fail --output /dev/null https://dev.example.org/
```

Не отключать проверку сертификата через curl -k: те же проверки затем выполняет автодеплой.
Использовать HTTPS даже в локальной сети: COOKIE_SECURE=true требует HTTPS для входа.

## 5. Подключить GitHub runner

Сначала убедиться, что репозиторий уже **private**. Под администратором GitHub:
Settings → Actions → Runners → New self-hosted runner → Linux и архитектура VM (`uname -m`).
Для x86_64 выбрать x64. Под **mvsst-dev** создать `~/actions-runner` и выполнить команды скачивания
и регистрации, которые показывает GitHub. Они содержат актуальную версию, checksum и временный токен;
не брать старую версию из примеров и не сохранять токен регистрации в Git.

При регистрации задать:

- имя runner: `mvsst-dev-vm`;
- дополнительную метку: `mvsst-dev`;
- остальные стандартные метки сохранить.

Установить и запустить службу **под администратором ОС** в каталоге runner:

```bash
sudo -i
cd /home/mvsst-dev/actions-runner
./svc.sh install mvsst-dev
./svc.sh start
./svc.sh status
exit
```

В GitHub runner должен стать Idle. Саму регистрацию config.sh не запускать от root.
Служба должна работать как mvsst-dev, имеющий доступ к Docker и ключу чтения репозитория.
После перезагрузки VM проверить, что Docker и runner снова работают.
[Регистрация runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[запуск как службы](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application).
Если на Debian используется needrestart, применить рекомендацию GitHub по исключению runner из
автоматического перезапуска во время задания на странице настройки службы.

## 6. Установить команду обновления на VM

Под администратором создать `/etc/mvsst-dev-deploy.env` (без production-секретов):

```dotenv
DEV_URL=https://dev.example.org
```

Заменить адрес своим. Создать `/usr/local/bin/mvsst-dev-deploy` со следующим содержимым:

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
sha=${1:?Передайте SHA коммита из задания GitHub}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Некорректный SHA'; exit 1; }
. /etc/mvsst-dev-deploy.env
: "${DEV_URL:?Укажите HTTPS-адрес dev}"
[[ "$DEV_URL" == https://* ]] || { echo 'Нужен HTTPS'; exit 1; }
export COMPOSE_PROJECT_NAME=mvsst-dev
state=/var/lib/mvsst-dev
exec 9>"$state/deploy.lock"
flock -w 600 9 || { echo 'Не удалось дождаться завершения обновления или резервной копии'; exit 1; }
cd /srv/mvsst-dev/app
git diff --quiet || { echo 'В deploy-копии изменены отслеживаемые файлы'; exit 1; }
git diff --cached --quiet || { echo 'В deploy-копии есть staged-изменения'; exit 1; }
[[ -z "$(git ls-files --others --exclude-standard)" ]] || { echo 'В deploy-копии есть посторонние файлы'; exit 1; }
git fetch origin dev
latest=$(git rev-parse origin/dev)
if [[ "$sha" != "$latest" ]]; then
  echo "Пропущен устаревший коммит $sha; актуальная dev: $latest"
  exit 0
fi
if [[ -f "$state/deployed-sha" ]] && [[ "$(cat "$state/deployed-sha")" == "$sha" ]]; then
  echo "Эта версия уже успешно развернута: $sha"
  exit 0
fi
old=$(cat "$state/deployed-sha")
export BACKUP_DIR="/var/backups/mvsst-dev/deployments/$(date -u +%Y%m%dT%H%M%S%N)-${sha:0:12}"
mkdir -p "$BACKUP_DIR"
printf '%s\n' "$old" > "$BACKUP_DIR/code-sha.txt"
printf '%s\n' "$old" > "$state/previous-sha"
git switch --detach "$sha"
bash deploy/update.sh --no-pull
curl --fail --silent --show-error --retry 6 --retry-delay 5 --max-time 15 "$DEV_URL/api/health" >/dev/null
curl --fail --silent --show-error --retry 6 --retry-delay 5 --max-time 15 "$DEV_URL/" >/dev/null
printf '%s\n' "$sha" > "$state/deployed-sha.tmp"
mv "$state/deployed-sha.tmp" "$state/deployed-sha"
echo "Dev успешно обновлена: $old -> $sha"
echo "Копия перед обновлением: $BACKUP_DIR"
```

```bash
sudo chown root:root /usr/local/bin/mvsst-dev-deploy /etc/mvsst-dev-deploy.env
sudo chmod 755 /usr/local/bin/mvsst-dev-deploy
sudo chmod 644 /etc/mvsst-dev-deploy.env
sudo -u mvsst-dev bash -c 'git -C /srv/mvsst-dev/app rev-parse HEAD > /var/lib/mvsst-dev/deployed-sha'
```

Последнюю команду выполнить только после успешного ручного запуска и проверки сайта из шага 4.
Серверный clone далее находится в detached HEAD на точном коммите. Это нормально для deploy-копии;
разрабатывать и коммитить в ней не нужно. .env и постоянные Docker-тома остаются на VM.

Скрипт использует штатный update.sh: копия БД/файлов/.env, последовательная сборка, перезапуск,
миграции при запуске API и проверка API. Затем дополнительно проверяется HTTPS через Caddy и web.
Записывается только SHA **последнего успешно проверенного обновления**. После ошибки он может отличаться
от реально запущенных контейнеров — частично выполненный деплой нужно разобрать по журналу.

## 7. Добавить deploy-задание в существующий CI

Этот шаг — будущая правка `.github/workflows/ci.yml` через обычную рабочую ветку и PR в dev.
Не создавать второй одинаковый CI и не подключать runner к job quality: PR проверяются на GitHub.

Сейчас в workflow стоит cancel-in-progress: true. Заменить существующий блок concurrency на:

```yaml
concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Так новый PR-коммит может отменить старый CI, но push в dev не обрывает уже начатый deploy.
В существующий раздел jobs, рядом с quality, добавить:

```yaml
  deploy-dev:
    name: Deploy dev
    needs: quality
    if: github.event_name == 'push' && github.ref == 'refs/heads/dev'
    runs-on: [self-hosted, linux, x64, mvsst-dev]
    timeout-minutes: 45
    concurrency:
      group: mvsst-dev-deploy
      cancel-in-progress: false
    steps:
      - name: Update dev VM
        env:
          TARGET_SHA: ${{ github.sha }}
        run: /usr/local/bin/mvsst-dev-deploy "$TARGET_SHA"
```

Для ARM64 заменить x64 на ARM64-метку, которую показывает GitHub. Job использует точный SHA события,
не выполняет `git pull` без фиксации версии и не получает файлы из ветки PR. В GitHub Secrets не нужны
пароли БД или файл .env — они остаются на dev-VM. Production SSH-ключи в этой схеме не используются.
Ключ чтения приватного репозитория и регистрация runner — разные вещи, нужны оба.

При нескольких быстрых push GitHub может заменить ожидающий запуск более новым; это ожидаемо.
Скрипт также пропускает устаревший SHA. Если новейший CI красный, предыдущая рабочая версия остаётся.
Не использовать кнопку отмены активного Deploy dev во время миграций.

## 8. Проверить автоматическое обновление

1. Внедрить workflow из шага 7 в dev, когда VM и runner уже готовы.
2. В Actions увидеть job Quality, затем Deploy dev. При красном Quality deploy не должен запускаться.
3. Сравнить SHA коммита dev и `cat /var/lib/mvsst-dev/deployed-sha` на VM.
4. Открыть dev-адрес, проверить вход и основные страницы; `docker compose ps` показывает healthy db/api.
5. Push в рабочую ветку или main не должен запускать Deploy dev.
6. Проверить, что production-адрес и production-сервер не затронуты.

Для первого теста можно использовать обычное изменение документации в dev. Если очередь содержит
более новый commit, проверять последний не пропущенный Deploy dev, а не любой зелёный workflow.

## Обслуживание и ошибки

Журналы задания — Actions → нужный запуск → Deploy dev. На VM, под mvsst-dev:

```bash
cd /srv/mvsst-dev/app
docker compose ps
docker compose logs --tail=150 api web caddy
cat /var/lib/mvsst-dev/deployed-sha
cat /var/lib/mvsst-dev/previous-sha
df -h
```

Копия перед каждым обновлением находится в `/var/backups/mvsst-dev/deployments/<время-SHA>/`:
дамп БД, файлы, secrets-*.env и code-sha.txt. Копия содержит пароли — каталог закрыт для других пользователей.
Переносите копии с VM на отдельный dev-backup диск/хранилище; снимок одной VM не заменяет такую копию.
Для ежедневной копии используйте штатный backup.sh с BACKUP_DIR=/var/backups/mvsst-dev/daily.
Пример строки для `/etc/cron.d/mvsst-dev-backup` (создаёт администратор, завершающий перевод строки обязателен):

```cron
30 2 * * * mvsst-dev cd /srv/mvsst-dev/app && flock -w 3600 /var/lib/mvsst-dev/deploy.lock env BACKUP_DIR=/var/backups/mvsst-dev/daily bash deploy/backup.sh
```

Ежедневный каталог штатный скрипт очищает по KEEP_DAYS (по умолчанию 14).
Ежедневная копия и deploy используют один lock: копирование БД не пересекается с изменением схемы.
Ручные копии и обслуживание также выполнять с этим lock, когда нет активного deploy.
Отдельные каталоги deployments автоматически им не очищаются: раз в неделю проверять размер и удалять
старые dev-копии по выбранному сроку хранения, сохраняя нужную копию для отката.

### Продление wildcard-сертификата

Caddy использует предоставленные файлы и не выпускает новый wildcard-сертификат автоматически.
Продление выполняется по принятой в организации процедуре. Перед истечением срока администратор
получает новую пару сертификат/ключ и цепочку, проверяет имя, срок и совпадение ключей, затем под lock заменяет
`deploy/certs/cert.pem` и `key.pem` с теми же правами. Сертификат и ключ обновлять согласованной парой.
Сохранить предыдущую пару в отдельном защищённом хранилище до проверки новой.

Замену файлов, проверку конфигурации и перезапуск Caddy выполнять под mvsst-dev, из `/srv/mvsst-dev/app`,
под тем же lock, что и deploy. Новую пару предварительно передать в закрытый incoming-каталог:

```bash
flock -w 600 /var/lib/mvsst-dev/deploy.lock bash -c '
  set -euo pipefail
  cd /srv/mvsst-dev/app
  install -m 0644 /srv/mvsst-dev/incoming/fullchain.pem deploy/certs/cert.pem
  install -m 0600 /srv/mvsst-dev/incoming/privatekey.pem deploy/certs/key.pem
  docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker compose restart caddy
  curl --fail https://dev.example.org/api/health
'
```

Не менять пару параллельно с deploy. Если validation завершилась ошибкой, перезапуска не будет;
до следующего deploy/перезапуска нужно восстановить предыдущую корректную пару.
Перезапуск Caddy кратковременно прервёт HTTPS-доступ
на dev; БД и API для этого перезапускать не требуется. Обычный `docker compose up -d` может не
перезапустить Caddy только из-за смены содержимого PEM-файлов.
Штатный backup.sh копирует БД, файлы приложения и .env, но **не TLS-сертификат и key.pem**.
Для восстановления VM эта пара и цепочка должны оставаться в защищённом хранилище организации
или отдельной защищённой резервной копии.

| Проблема | Что проверить |
|---|---|
| Deploy dev ожидает runner | Runner Idle/Online, служба запущена, метки linux/x64/mvsst-dev совпадают |
| Permission denied при Git | Read-only deploy key, SSH config/known_hosts именно пользователя mvsst-dev |
| Docker permission denied | Группа docker у mvsst-dev; после её изменения перезапустить службу runner |
| Ошибка сертификата curl | DEV_URL/DOMAIN покрыты wildcard; срок действия, полная цепочка и доверие к CA |
| CI не запускается после приватизации | Actions разрешены, включённая квота/бюджет не исчерпаны |
| Сборка очень долгая | Память/подкачка и диск; Docker-образы собираются последовательно |
| Ошибка deploy после миграции | Сначала журнал и копия; автоматический откат схемы БД не выполнять |

Штатный backup.sh архивирует файлы через работающий контейнер api. Если api не запускается,
это может остановить и следующую попытку обновления на стадии копирования. В этом случае нужен
ручной разбор администратором и копирование файлов через maintenance files-helper до восстановления;
не отключать резервную копию, чтобы «продавить» повторный deploy.

После ошибки не считать версию успешно установленной только по HEAD Git. Повторить задание можно
через Re-run failed jobs после устранения причины, если этот SHA всё ещё актуален в dev.
Обычно исправление отправляется новым коммитом в dev и проходит тот же CI/deploy.
Откат кода без отката БД допустим только после проверки совместимости с уже применёнными миграциями.
При несовместимой схеме администратор восстанавливает согласованные код, .env/ключи, БД и файлы из одной
копии; дамп старой схемы нужно восстанавливать в чистую dev-БД, а не считать импорт поверх новой схемы
полноценным откатом. `deploy/restore.sh` — вспомогательный инструмент, он сам не удаляет все новые таблицы.
Не применять `docker compose down -v`: эта команда удаляет постоянные данные.

## Что ещё не выполнено

В этом задании подготовлена инструкция. VM не подключалась, Docker и runner не устанавливались,
ключи и секреты не создавались, действующий workflow не изменялся, автодеплой не включён.
Для фактической настройки выполните шаги 1–8 на dev-VM и внесите описанную правку CI в dev.
