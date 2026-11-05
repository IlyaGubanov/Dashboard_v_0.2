# Dev на Debian 13: первая установка и ручное обновление

Схема простая: **с любого ПК в вашей сети подключиться по SSH к dev-VM и выполнить команду**.
Сборка и запуск происходят на VM. На ПК не нужны Docker, Node.js или копия репозитория.
Коммит в dev сам сервер не обновляет. GitHub runner, автодеплой и платный тариф GitHub не нужны.
Репозиторий может быть приватным. Существующий CI продолжает проверять код отдельно от развёртывания.

Ниже — установка на чистую **отдельную Debian 13 VM**, доступную только из локальной сети.
Приложение, MySQL и HTTPS-шлюз Caddy запускаются в Docker; используется ваш wildcard-сертификат.
Production, его база, файлы и настройки в этой процедуре не используются.

## 1. Подготовить адрес и подключиться к VM

Для начала достаточно 4 vCPU, 8 ГБ памяти и диска от 80 ГБ. VM нужен постоянный локальный IP.
Попросите администратора внутреннего DNS направить dev-имя на этот IP.
Для сертификата `*.example.org` подойдёт **dev.example.org**. Имя `site.dev.example.org` этим
wildcard не покрывается. Во всех примерах замените `dev.example.org` своим именем из сертификата.
И VM, и клиентские ПК должны разрешать это имя через внутренний DNS.

Нужны входящие SSH/22 для администраторов, HTTPS/443 и HTTP/80 из вашей сети.
Входящие порты из интернета не пробрасывать. Для установки и обновления VM нужен исходящий доступ
к Debian/Docker, GitHub, реестрам контейнеров и npm. Docker публикует порты отдельно от UFW:
доступ ограничьте также на сетевом экране. Адрес production на эту VM не перенаправлять.

С Windows откройте PowerShell, с macOS/Linux — терминал. Здесь и далее `ADMIN` — ваша учётная
запись на VM с правом sudo, `DEV_VM_IP` — её локальный IP; замените оба значения:

```text
ssh ADMIN@DEV_VM_IP
```

Если SSH ещё не установлен, через консоль VM под root выполните:

```bash
apt update
apt install -y sudo openssh-server
systemctl enable --now ssh
```

Создайте обычную административную учётную запись, если её ещё нет: `adduser ИМЯ`,
`usermod -aG sudo ИМЯ`. Затем подключитесь под ней. Остальные команды — внутри SSH-сеанса.

## 2. Установить Docker один раз

Под **ADMIN**. Команды рассчитаны на чистую Debian 13 без другого Docker:

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

Источник: [установка Docker на Debian](https://docs.docker.com/engine/install/debian/).
Node.js и MySQL на сам Linux устанавливать не нужно.

## 3. Создать пользователя приложения и доступ к приватному репозиторию

Под **ADMIN**:

```bash
sudo adduser --disabled-password --gecos '' mvsst-dev
sudo usermod -aG docker mvsst-dev
sudo install -d -o mvsst-dev -g mvsst-dev /srv/mvsst-dev
sudo install -d -m 0700 -o mvsst-dev -g mvsst-dev /var/backups/mvsst-dev
sudo -iu mvsst-dev
```

Теперь вы под **mvsst-dev**. Прямой вход под этой записью с ПК не нужен: заходите под своим
ADMIN и переключайтесь через sudo. Доступ к Docker даёт управление этой VM, поэтому эта запись
используется только на dev-сервере.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/mvsst-dev-repo -N '' -C mvsst-dev-read-only
cat ~/.ssh/mvsst-dev-repo.pub
```

В GitHub откройте репозиторий → **Settings → Deploy keys → Add deploy key**.
Добавьте выведенный публичный `.pub`-ключ, имя `dev VM read-only`.
**Allow write access оставьте выключенным**. Добавить ключ может администратор репозитория.
Закрытый ключ остаётся на VM. Личные GitHub-пароли и токены участников на неё переносить не нужно.

Создайте SSH-настройку (порт 443 удобен, если исходящий SSH/22 в организации закрыт):

```bash
cat > ~/.ssh/config <<'EOF'
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/mvsst-dev-repo
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

При первом соединении сравните fingerprint с [официальным списком GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
и подтвердите только совпадающий ключ. Сообщение `successfully authenticated` — успех;
GitHub не даёт shell-доступа, поэтому код завершения этой проверки может быть 1.
Справка: [Deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys),
[SSH через 443](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port).

## 4. Получить dev и создать отдельные настройки

Перед этим инструкция и `deploy/dev.sh` должны быть объединены в GitHub-ветку dev.
Под **mvsst-dev**:

```bash
git clone --branch dev git@github.com:IlyaGubanov/Dashboard_v_0.2.git /srv/mvsst-dev/app
cd /srv/mvsst-dev/app
bash deploy/install.sh --env-only
nano .env
```

На вопросы установщика ответьте: ваш dev-домен, сертификат **files**, демо-данные **true**.
Этот режим только создаёт .env и ключи приложения. Полный install.sh рассчитан на Ubuntu;
на Debian не запускайте его вместо шагов этой инструкции.

В `.env` измените/добавьте следующие строки **без кавычек и без пробелов вокруг `=`**.
Остальные строки и сгенерированные пароли сохраните:

```dotenv
COMPOSE_PROJECT_NAME=mvsst-dev
DOMAIN=dev.example.org
TLS_MODE=files
MYSQL_DATABASE=mvs_dev
MYSQL_USER=mvs_dev
COOKIE_SECURE=true
DEMO_DATA=true
API_DOCS=false
VIDEO_ALLOWED_NETWORKS=
VIDEO_ALLOWED_DNS_SUFFIXES=
```

Это фрагмент, а не замена всего файла. MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, ADMIN_PASSWORD
и VIDEO_* ключи оставьте сгенерированными. Не копируйте .env, базу и файлы production.
Демо-данные — из репозитория. Пустые списки VIDEO_ALLOWED_* не разрешают подключать реальные камеры.
Проверьте с администратором, что VIDEO_CONTROL_SUBNET не пересекается с вашей сетью/VPN.

```bash
chmod 600 .env
install -d -m 0700 /srv/mvsst-dev/incoming
exit
```

`exit` вернул вас под **ADMIN**.

## 5. Установить ваш wildcard-сертификат

Нужны два PEM-файла из защищённого хранилища организации:

- `fullchain.pem`: wildcard-сертификат первым, затем промежуточные сертификаты;
- `privatekey.pem`: соответствующий закрытый ключ без пароля для запуска Caddy.

Если сертификат в PFX/P12, попросите администратора экспортировать эти два файла.
Корневой сертификат обычно в fullchain не включают. Сертификат/ключ не отправлять в GitHub и чаты.
Формат: [документация Caddy](https://caddyserver.com/docs/caddyfile/directives/tls).

В SSH-сеансе под **ADMIN** сначала создайте закрытую папку приёма:

```bash
install -d -m 0700 ~/mvsst-dev-tls
```

С **вашего ПК**, из папки с этими файлами, передайте их в эту папку на VM:

```text
scp fullchain.pem privatekey.pem ADMIN@DEV_VM_IP:~/mvsst-dev-tls/
```

Затем в SSH-сеансе под **ADMIN** (исходные файлы в домашнем каталоге удалятся после переноса):

```bash
chmod 600 ~/mvsst-dev-tls/fullchain.pem ~/mvsst-dev-tls/privatekey.pem
sudo install -d -m 0700 -o mvsst-dev -g mvsst-dev /srv/mvsst-dev/app/deploy/certs
sudo install -m 0644 -o mvsst-dev -g mvsst-dev ~/mvsst-dev-tls/fullchain.pem /srv/mvsst-dev/app/deploy/certs/cert.pem
sudo install -m 0600 -o mvsst-dev -g mvsst-dev ~/mvsst-dev-tls/privatekey.pem /srv/mvsst-dev/app/deploy/certs/key.pem
rm -- ~/mvsst-dev-tls/fullchain.pem ~/mvsst-dev-tls/privatekey.pem
```

Файлы `deploy/certs/*.pem` и `.env` исключены из Git; Caddy получает сертификаты только для чтения.
Если wildcard выдан **внутренним CA**, до запуска установите корневой CA организации на VM
и клиентских ПК. Для VM под ADMIN (путь `/secure/...` замените местом своего CA-файла):

```bash
sudo install -m 0644 /secure/corp-root-ca.crt /usr/local/share/ca-certificates/mvsst-org-root.crt
sudo update-ca-certificates
```

Если CA уже доверенный публичный — этот блок пропустите. Сам wildcard в корневые CA не добавлять.
В проверках не использовать `curl -k` и не отключать проверку HTTPS в браузере.

## 6. Первый запуск — одна команда

В SSH-сеансе под **ADMIN**:

```bash
sudo -iu mvsst-dev bash /srv/mvsst-dev/app/deploy/dev.sh start
```

Скрипт получит свежую dev, проверит настройки, имя/срок сертификата и совпадение ключа,
проверит конфигурацию Caddy, последовательно соберёт образы и запустит контейнеры.
API сам применит миграции и загрузит демо-данные. Проверка HTTPS дождётся ответа приложения.
Первый запуск может занять 10–20 минут; дождитесь строки **Готово** и SHA коммита.

Откройте **https://ВАШ_DEV_ДОМЕН** с ПК в вашей сети. Логин `admin`, начальный пароль выведен
при создании .env; его можно посмотреть в .env на VM. При первом входе смените пароль.
Проверьте вход, основные страницы и `docker compose ps`: db/api должны быть healthy.
После перезагрузки VM контейнеры запускаются сами; новая версия кода автоматически не скачивается.

## 7. Последующие обновления с любого ПК

Сначала объедините нужные изменения в dev и дождитесь успешного CI в GitHub.
Затем на любом ПК в вашей локальной сети, где есть SSH и доступ вашей ADMIN-записи:

```text
ssh -t ADMIN@DEV_VM_IP "sudo -iu mvsst-dev bash /srv/mvsst-dev/app/deploy/dev.sh update"
```

Можно выполнить те же действия в уже открытом SSH-сеансе без внешнего `ssh -t`.
Текущая папка на вашем ПК значения не имеет. Вне локальной сети сначала нужен ваш VPN.
GitHub-ключ и Docker остаются на VM; выдавать всем ПК сертификат или ключ репозитория не нужно.

Обновление делает копию БД, файлов и .env **до смены кода**, затем получает актуальную dev,
собирает образы, перезапускает контейнеры, применяет миграции и проверяет HTTPS/API.
Скрипт не проверяет CI сам: результат CI смотрит запускающий. Запускается dev на момент получения
кода; более поздние коммиты попадут в следующее ручное обновление.
Во время перезапуска возможен короткий перерыв. Не закрывайте сеанс до завершения.

Две одновременные команды не запустятся: вторая остановится с понятным сообщением.
При локальных изменениях или коммитах вне origin/dev скрипт остановится и ничего не сотрёт.
В серверной копии не разрабатывайте. Настройки изменяйте в .env, а код — через репозиторий.

## Копии, ошибки и продление сертификата

Под ADMIN для диагностики:

```bash
sudo -iu mvsst-dev
cd /srv/mvsst-dev/app
docker compose ps
docker compose logs --tail=100 api web caddy
cat .git/mvsst-dev.deployed
df -h
```

`.git/mvsst-dev.deployed` — SHA **последнего успешного** запуска. После ошибки он не доказывает,
что все контейнеры остались на этой версии: смотрите журнал. До первой успешной установки файла нет.
После исправления причины повторите update. Если первый start прервался и контейнеры уже созданы,
сначала разберите журнал; повторный start преднамеренно не заменяет update с копией.
Start также остановится, если контейнеры удалены, но тома БД/файлов сохранились (например, после
обычного `docker compose down`). Для существовавшего окружения сначала верните его прежнюю
версию в рабочее состояние и сделайте копию; затем запускайте update. При прерванной первой
установке администратор сначала определяет, появились ли данные, и сохраняет нужные тома.
Автоматического удаления томов или обхода копии скрипт не предлагает.
Если до первой сборки успела пройти только проверка Caddy и сохранились лишь его служебные тома,
повторный start разрешён: базы и пользовательских файлов ещё нет.

Копии перед обновлениями: `/var/backups/mvsst-dev/<время-SHA>/`. Внутри БД, файлы, .env,
`code-sha.txt` и, при наличии, `last-successful-sha.txt`. Они содержат пароли: храните закрыто,
переносите на отдельный backup-диск. Папки разных обновлений **автоматически не очищаются**:
периодически проверяйте место и удаляйте ненужные старые копии по сроку хранения команды.
Эта схема не создаёт копии по расписанию. Если данные важны между обновлениями, делайте также
ручную копию под mvsst-dev, из папки приложения, когда приложение работает:

```bash
flock -n .git/mvsst-dev.lock env BACKUP_DIR=/var/backups/mvsst-dev/manual bash deploy/backup.sh
```

У штатного backup.sh ручные копии имеют точность до минуты; не запускайте их дважды в одну минуту.
Если API не работает, штатная копия файлов через него тоже не получится — сначала нужен ручной
разбор администратором. Скрипт не пропускает такую ошибку и не делает автоматический откат БД.
Возврат старого кода после миграций требует проверки совместимости; восстановление старой схемы —
в чистую dev-БД, а не импорт поверх новой. **Не выполняйте `docker compose down -v`: удалятся данные.**

Wildcard Caddy автоматически не продлевает. До истечения срока получите новую пару и цепочку,
сохраните старую в защищённом хранилище, перенесите новые файлы в закрытый
`/srv/mvsst-dev/incoming` с владельцем mvsst-dev и правами 600. Под mvsst-dev из папки приложения:

```bash
flock -n .git/mvsst-dev.lock bash -c '
  set -euo pipefail
  install -m 0644 /srv/mvsst-dev/incoming/fullchain.pem deploy/certs/cert.pem
  install -m 0600 /srv/mvsst-dev/incoming/privatekey.pem deploy/certs/key.pem
  docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker compose restart caddy
  curl --fail https://dev.example.org/api/health
'
```

При любой ошибке validation или HTTPS восстановите прежнюю пару под тем же lock,
перезапустите Caddy и снова проверьте HTTPS; не оставляйте неверную пару до следующего update.
После успешной замены
проверьте в браузере имя и срок нового сертификата. Кратко перезапустится только HTTPS-шлюз.
Штатная копия приложения **не включает TLS-файлы**: их храните отдельно в защищённом хранилище.

## Что писать ИИ

Готовые короткие тексты для слияния работы в dev и выпуска dev → main — в [AI_PROMPTS.md](AI_PROMPTS.md).
Слияние в main обновляет GitHub-ветку production; фактическое обновление production-сервера —
отдельное поручение. Скрипт `deploy/dev.sh` предназначен только для dev и main не развёртывает.

Эта инструкция и скрипт сами VM не настраивают. Установка и проверка на вашей VM выполняются
администратором по шагам выше; подключения к VM при подготовке этих файлов не было.
