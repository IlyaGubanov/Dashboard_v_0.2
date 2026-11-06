# Карта актуального интерфейса

Источник: router.tsx, страницы и фактический локальный обход актуальной dev. Таблицы ниже разделяют статическую инвентаризацию и браузерную проверку; наличие компонента в коде не считается проверкой его полного сценария.

## Страницы и вкладки

| Адрес | Раздел | Обнаруженные вкладки |
|---|---|---|
| `/` | Производственная сводка | — |
| `/map` | Карта объектов | — |
| `/reb` | РЭБ — Ремонтно-эксплуатационная база | Обзор РЭБ; Реестр техники; Распределение техники; ДТП; Неиспользуемая техника; Потребности в технике; Расходы |
| `/contractors` | Подрядчики | — |
| `/video` | Видеонаблюдение | — |
| `/staffing` | Штатная численность | Обзор; Подразделения; Должности; Приём и увольнение; ФОТ; Журнал |
| `/economics` | Экономика | Обзор; Доходы и расходы; Движение денег; Отклонения; Лимиты; Факт за месяц; Статьи; Журнал |
| `/admin/users` | Пользователи и роли | — |
| `/admin/directions` | Конструктор направлений | — |
| `/admin/directions/schools` | Капремонт школ 2026–2027 | Основное; Причины отставания; Статусы · 0; Доп. поля · 8; Надстройки · 3; Показатели сводки · 3; Плитки обзора |
| `/admin/appearance` | Оформление | — |
| `/admin/video` | Видеонаблюдение | Регистраторы · 0; Камеры · 0 |
| `/help` | Справка | — |
| `/d/schools` | Капремонт школ 2026–2027 | Ввод данных; Обзор; Объекты; Причины отставания; Матрица; График работ; Надстройки; Динамика; Замечания; Ответственные; Управление; Журнал; Устройство |
| `/d/mkd` | Капремонт МКД — 2026 | Ввод данных; Обзор; Объекты; Причины отставания; Матрица; График работ; Динамика; Замечания15; Ответственные; Управление; Журнал; Устройство |
| `/d/networks` | Сети, коллекторы, водные объекты | Ввод данных; Обзор; Объекты; Причины отставания; Матрица; График работ; Надстройки; Динамика; Замечания14; Ответственные; Управление; Журнал; Устройство |
| `/d/streets` | Благоустройство улиц | Обзор; Объекты; Причины отставания; Матрица; Динамика; Замечания; Ответственные; Управление; Журнал; Устройство |

Дополнительно: `/login`, `/change-password`; совместимый переход `/d/reb` → `/reb`; тестовое динамическое направление `/d/ui-audit`. Вложенные расходы РЭБ: fines, tolls, fuel. Программы REPORT берутся из конфигурации направления и периодов, а не из фиксированного перечня страниц.

Конструктор использует внутренний state, а не query `tab`. Его семь вкладок проверены реальным выбором в `extra-checks.json`; записи query в массовом обходе не заменяют эту проверку.

## Окна и карточки по коду

| Файл | Поверхности | Заголовки/выражения title |
|---|---|---|
| [ContractorsPage.tsx](../../apps/web/src/pages/ContractorsPage.tsx) | Modal | "Подрядчик в направления" |
| [Departments.tsx](../../apps/web/src/pages/Departments.tsx) | Modal | "Подразделения" |
| [MapPage.tsx](../../apps/web/src/pages/MapPage.tsx) | Modal, Modal | "Выберите объект в этой точке"; "Объект на карте" |
| [UserCard.tsx](../../apps/web/src/pages/UserCard.tsx) | Modal, Modal | "Новый сотрудник"; { <Group gap="xs"> <Text fw={600}>{user.fullName}</Text> {!user.isActive && ( <Badge color="red" variant="ligh |
| [UsersImport.tsx](../../apps/web/src/pages/UsersImport.tsx) | Modal | "Загрузка пользователей списком" |
| [UsersPage.tsx](../../apps/web/src/pages/UsersPage.tsx) | Modal | {`Пароль: ${user.fullName}`} |
| [AdminDirectionsPage.tsx](../../apps/web/src/pages/admin/AdminDirectionsPage.tsx) | Modal | "Новое направление" |
| [EntryTab.tsx](../../apps/web/src/pages/direction/EntryTab.tsx) | Modal | { action === 'new' ? `Новая ${periodKind === 'WEEK' ? 'отчётная неделя' : 'отчётная дата'}` : action === 'CLOS |
| [ManageTab.tsx](../../apps/web/src/pages/direction/ManageTab.tsx) | Modal, Modal, Modal | {edit?.id ? 'Раздел' : 'Новый раздел'}; {edit?.id ? 'Вид работ' : 'Новый вид работ'}; {edit?.id ? 'Организация' : 'Новая организация'} |
| [OverviewTab.tsx](../../apps/web/src/pages/direction/OverviewTab.tsx) | Modal | {detail === 'volume' ? 'Выполнено по объёмам' : 'Завершено по отчётному статусу'} |
| [RemarkDrawer.tsx](../../apps/web/src/pages/direction/RemarkDrawer.tsx) | Drawer | {data ? <Text fw={700}>Замечание № {data.num}</Text> : 'Замечание'} |
| [RemarkForm.tsx](../../apps/web/src/pages/direction/RemarkForm.tsx) | Modal | {edit ? `Замечание № ${edit.num}` : 'Новое замечание'} |
| [ReportEntry.tsx](../../apps/web/src/pages/direction/ReportEntry.tsx) | Modal | "Новый отчёт программы" |
| [SiteDrawer.tsx](../../apps/web/src/pages/direction/SiteDrawer.tsx) | Drawer | { data ? ( <Group gap="md" wrap="nowrap" align="flex-start"> <div> <Text fw={700} size="lg" lh={1.2}> {data.ro |
| [SiteEditor.tsx](../../apps/web/src/pages/direction/SiteEditor.tsx) | Drawer, Modal | {<Text fw={700}>{isNew ? 'Новый объект' : (data?.shortName ?? data?.name ?? 'Объект')}</Text>}; {item ? 'Позиция работ' : 'Новая позиция работ'} |
| [EconArticles.tsx](../../apps/web/src/pages/economics/EconArticles.tsx) | Modal | {article ? 'Статья расходов' : 'Новая статья расходов'} |
| [EconBudgetEditor.tsx](../../apps/web/src/pages/economics/EconBudgetEditor.tsx) | Modal | {<Group gap="xs"><Badge variant="light" color={scopeColor[budget.scope]}>{ECON_SCOPE_LABELS[budget.scope]}</Ba |
| [EconCashEntry.tsx](../../apps/web/src/pages/economics/EconCashEntry.tsx) | Modal | {`Вставка ${kind === 'plan' ? 'плана' : 'факта'} ДДС из Excel`} |
| [EconDeviations.tsx](../../apps/web/src/pages/economics/EconDeviations.tsx) | Modal, Modal | "Разбор отклонения"; "Разбор отклонения" |
| [EconDialogs.tsx](../../apps/web/src/pages/economics/EconDialogs.tsx) | Modal, Modal | "Ставки и НДС"; "Ответственные ПЭО" |
| [EconFacts.tsx](../../apps/web/src/pages/economics/EconFacts.tsx) | Modal | {`Загрузка факта из Excel — ${econMonthLabel(month)}`} |
| [EconLimits.tsx](../../apps/web/src/pages/economics/EconLimits.tsx) | Modal | "Новый центр затрат" |
| [EconomicsPage.tsx](../../apps/web/src/pages/economics/EconomicsPage.tsx) | Modal | {demo === 'load' ? 'Загрузить демо-данные экономики?' : 'Удалить демо-данные экономики?'} |
| [FleetDrawer.tsx](../../apps/web/src/pages/fleet/FleetDrawer.tsx) | Drawer, Modal | {`${FLEET_LABELS[kind]} · № ${id}`}; "Подтверждённая материальная ответственность" |
| [FleetForm.tsx](../../apps/web/src/pages/fleet/FleetForm.tsx) | Modal | {`${row?'Изменить':'Добавить'} · ${FLEET_LABELS[kind]}`} |
| [FleetList.tsx](../../apps/web/src/pages/fleet/FleetList.tsx) | Modal | "Изменение архива" |
| [StaffingForms.tsx](../../apps/web/src/pages/staffing/StaffingForms.tsx) | Modal, Modal, Modal, Modal, Modal, Modal, Modal | {value.department // (canEdit ? 'Новое подразделение' : 'Карточка подразделения')}; {`Редактирование таблицей: ${items.length}`}; "Группы подразделений"; {initial ? 'Настройки среза' : 'Новый месячный срез'}; "Ответственные за кадровые данные"; "ФОТ за месяц, млн ₽"; "Редактировать годовой ФОТ" |
| [StaffingMovements.tsx](../../apps/web/src/pages/staffing/StaffingMovements.tsx) | Modal | "Приём и увольнение за день" |
| [StaffingPage.tsx](../../apps/web/src/pages/staffing/StaffingPage.tsx) | Modal | "Подтвердите действие" |
| [StaffingPositions.tsx](../../apps/web/src/pages/staffing/StaffingPositions.tsx) | Modal, Modal, Modal | {isNew ? 'Новая должность' : 'Должность'}; {`Перенести должности: ${count}`}; {`Загрузить таблицу должностей в срез ${period.asOf.split('-').reverse().join('.')}`} |
| [PanoramaGallery.tsx](../../apps/web/src/ui/PanoramaGallery.tsx) | Modal, Modal | "Добавить панорамы 360°"; "Панорамы объекта" |
| [attachments.tsx](../../apps/web/src/ui/attachments.tsx) | Modal | {view?.fileName} |
| [VideoAdminPage.tsx](../../apps/web/src/video/VideoAdminPage.tsx) | Modal, Modal, Modal | {edit?.item ? 'Изменить подключение' : tab === 'recorders' ? 'Добавить регистратор' : 'Добавить камеру'}; {archive?.item.isArchived ? 'Восстановление' : 'Архивирование'}; "Проверка изображения · Прямой эфир" |

Всего деклараций Modal/Drawer: 52. Общая тема и перенос кнопок действуют на все, но каждая декларация не означает отдельный выполненный цикл записи. Представительные окна и ограничения перечислены в README.

## Роли и состояния

ADMIN; MANAGEMENT; CURATOR; EDITOR; VIEWER; USER с ограничениями; USER без направлений. Области SECTIONS/SITES, доступ к финансам, журналу и административным действиям сохраняются. Серверные интеграционные тесты проверяют ограничения отдельно от визуального обхода.

Проверены заполненные реестры/матрицы направлений; кадровые срезы, должности, движения и ФОТ; демо-экономика с отклонениями/ДДС; пустые вкладки РЭБ и видео; ошибка кадров; пустое динамическое направление; длинные формы; карточка, надстройка, 360°; фильтры, выбор вкладок, клавиатура и повторное открытие после сохранения. Реальное потоковое видео и все варианты импорта не проверены.
