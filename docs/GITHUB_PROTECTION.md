# Включение защиты GitHub владельцем

## Фактические полномочия и границы

На момент аудита аккаунт formaset имеет write, владелец @IlyaGubanov — admin.
Rulesets отсутствуют; main отмечена GitHub как protected=false. Административные настройки,
webhooks и политика Actions не полностью доступны текущему доступу. Защита ниже — подготовленная
конфигурация, а не утверждение о её активации. Репозиторий public: штатная branch protection
доступна и на GitHub Free. Нет необходимости менять тариф или делать репозиторий приватным/публичным.

Источники GitHub: [защита веток](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners),
[события Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## Точная целевая конфигурация

Settings → Branches → Add classic branch protection rule, отдельно для **main** и **dev**.
Не включать одновременно перекрывающиеся classic rules и rulesets без проверки их совместного эффекта.

| Настройка | main | dev |
|---|---|---|
| Require a pull request before merging | Да | Да |
| Required approving reviews | 1 | 1 |
| Require review from Code Owners | Да | Да |
| Dismiss stale approvals | Да | Да |
| Require approval of most recent reviewable push | Да | Да |
| Require status checks | PR direction; Quality | PR direction; Quality |
| Expected source каждого check | GitHub Actions, app ID 15368 | То же |
| Require branches to be up to date | Да | Да |
| Require conversation resolution | Да | Да |
| Do not allow bypassing (include administrators) | Да | Да |
| Allow force pushes / Allow deletions | Нет / Нет | Нет / Нет |
| Require linear history | Нет: нужны merge-коммиты | Нет |
| Lock branch | Нет после перехода | Нет |
| Bypass lists / allowed actors | Пусто | Пусто |

CODEOWNERS `* @IlyaGubanov` требует review владельца для любого изменения. Все файлы, включая
сам CODEOWNERS и workflows, защищены review из целевой ветки. Автор собственного PR не может
его approve: release PR по прямому поручению открывает другой участник, владелец согласует.
Если credentials агента принадлежат самому владельцу, GitHub не отличает его от человека;
для работы ИИ нужен отдельный аккаунт с write, без admin и bypass. Проверять существующие токены
должен владелец, без пересылки секретов в чат. Доступы автоматически не менялись.

Готовые REST-параметры: [main.json](../.github/protection/main.json),
[dev.json](../.github/protection/dev.json). На доверенной машине владельца, после проверки текущих
правил и выполнения bootstrap ниже, можно применить эти файлы через `gh api --method PUT
repos/IlyaGubanov/Dashboard_v_0.2/branches/main/protection --input .github/protection/main.json`
и аналогично для dev. PUT заменяет classic protection, поэтому сначала сохранить и изучить
существующую конфигурацию; не затирать появившиеся после аудита настройки.

Settings → General → Pull Requests: сохранить Allow merge commits; рекомендуем отключить
Allow squash merging и Allow rebase merging, не включать автоматическое удаление веток.
Это отдельное согласуемое изменение настроек репозитория; текущий агент его не выполнял.
На main/dev всегда выбирать **Create a merge commit**.

## Почему два workflow

- `ci.yml`: один набор Quality для PR в dev/main и push в эти ветки. Одноразовый MySQL,
  без production-секретов; CI не выполняет deploy. PR-код выполняется с contents:read,
  checkout без сохранения credentials. Не использовать self-hosted production-runner.
- `pr-direction.yml`: `pull_request_target`, checkout только точного github.workflow_sha,
  исполняется доверенный скрипт ревизии workflow из default branch. Никаких зависимостей, секретов, checkout/head,
  артефактов PR или shell-интерполяции названия ветки. Проверяет base/head и ID + полное имя
  обеих сторон: main принимает только dev этого репозитория; dev — только mvsst-[1-9][0-9]*.

Required checks без branch protection не запрещают merge. Привязка к приложению GitHub Actions
отсекает простую подмену commit-status через пользовательский API. Она не превращает админа
репозитория или GitHub App с доступом к workflows в недоверенного исполнителя: такие полномочия
следует ограничивать отдельно. Изменение контроля Git в dev всегда требует поручения и review владельца.

## Первое включение без блокировки собственного внедрения

1. На время перехода договориться о паузе других merge. main остаётся исходной production-веткой.
2. Интегрировать организационный PR mvsst-1 → dev после зелёного Quality и независимого review.
   Текущее прямое поручение на миграцию разрешает этот bootstrap в dev. До него в dev нет
   доверенного gate: Quality проверяет направление из PR; полный diff проверяется отдельно.
3. pull_request_target берёт workflow из default branch. Пока default=main без workflow,
   наличие файла только в dev не активирует gate. Владелец после проверки интеграций может
   согласованно переключить default на dev; тогда доверенная ревизия workflow из dev проверяет
   PR в обе системные ветки, даже пока main не содержит новых файлов. Открыть/переоткрыть
   проверочный PR в dev, получить PR direction, проверить failure неверного источника и применить
   полную защиту dev/main. CODEOWNERS из main начнёт требовать именно владельца после первого
   организационного выпуска; до него согласование владельца проверяется вручную.
   Если default остаётся main, сначала нужен отдельный bootstrap следующими пунктами, а полный
   required gate до этого будет ожидать отсутствующую проверку. Не утверждать, что он уже работает.
4. До включения main gate **не считать main защищённой этим workflow**: в исходной main файла нет.
   Не ставить обязательный PR direction и затем снимать его ради разблокировки.
   Безопасный вариант ожидания: владелец временно включает **Lock branch** main и запрет bypass
   и удаления/force push на время рассмотрения первого организационного выпуска.
5. Только отдельное явное решение владельца разрешает первый dev → main с организационными файлами.
   Проверить `git diff main...dev --name-only`: только документы и .github, без приложения/deploy;
   Quality успешен, исходный repo ID правильный, владелец явно approve конкретный SHA.
   Владелец проводит короткое согласованное окно bootstrap: снимает временную блокировку для
   этого PR, выполняет merge без изменения кода приложения и немедленно включает полную main protection.
   Если внешняя система развёртывает любой push main, владелец сначала должен согласовать её паузу:
   этот агент не изменяет deployment-интеграции и не выполняет этот выпуск.
6. После merge main содержит доверенный gate и CODEOWNERS. Полная защита main/dev должна
   быть подтверждена GET API и тестовыми PR; синхронизация истории — по GIT_WORKFLOW.md.
   Ни один временный bypass/исключение не сохранять.

Вариант ожидания пункта 4 намеренно блокирует релизы до решения владельца. Он не требует
прямых push, переписывания main или постоянной лазейки. В этой задаче main не обновляется.

## Проверка владельцем после активации

Получить GET `/repos/IlyaGubanov/Dashboard_v_0.2/branches/{main,dev}/protection` и список rulesets;
сверить required contexts/app IDs, reviews, enforce_admins, force/deletion=false.
Открыть временный draft PR mvsst-N → main: PR direction должен завершиться failure, merge
должен быть заблокирован required checks. Fork dev → main также failure. Закрыть тестовый PR
без merge; не пытаться реально протолкнуть коммит в production для проверки защиты.
Разрешённые mvsst-N → dev и отдельно согласованный dev → main должны получить success gate,
Quality и при этом требовать review владельца. Локальные fixture-тесты не доказывают серверную блокировку.

## Default branch

Оставлена main: текущий доступ не admin, webhooks и внешние инструменты полностью не видны.
Проверенные файлы не содержат Actions-деплоя; deploy/update.sh делает pull текущей ветки,
поэтому production-checkout должен быть явно main. Владелец проверяет webhooks, GitHub Apps,
внешние CI, скрипты клонирования и настройки сервера, затем отдельно согласует переключение
Settings → General → Default branch → dev. Существующие PR при аудите закрыты, перенаправлять нечего.
После переключения проверить PR base по умолчанию, свежий clone и неизменность production-источника main.
До этого разработчики явно выбирают dev в PR и origin/dev при создании ветки.
