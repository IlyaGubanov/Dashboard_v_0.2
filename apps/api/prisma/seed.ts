/**
 * Базовое наполнение БД: направления с настройками, статусы, общие настройки, первый администратор.
 * Повторный запуск безопасен (upsert). Демо-данные направлений загружаются отдельно (этап 3).
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const DIRECTIONS: Prisma.DirectionCreateInput[] = [
  {
    code: 'schools',
    name: 'Капремонт школ 2026–2027',
    shortName: 'Школы',
    icon: 'school',
    color: '#2f6fd6',
    sort: 10,
    periodKind: 'DAY',
    progressMethod: 'WEIGHTED_BY_WORK_WEIGHT',
    planMethod: 'LINEAR_ITEM_DATES',
    moneySource: 'SITE_LIMIT',
    moneyLabel: 'Лимит',
    thrWarn: -2,
    thrCrit: -10,
    siteUnit: 'школ',
  },
  {
    code: 'mkd',
    name: 'Капремонт МКД — 2026',
    shortName: 'МКД',
    icon: 'building',
    color: '#0f9d76',
    sort: 20,
    periodKind: 'WEEK',
    planWeekday: 3, // план на среду отчётной недели
    progressMethod: 'WEIGHTED_BY_COST',
    planMethod: 'LINEAR_ITEM_DATES',
    moneySource: 'WORK_ITEMS',
    moneyLabel: 'Договор',
    thrWarn: -5,
    thrCrit: -15,
    siteUnit: 'адресов',
  },
  {
    code: 'networks',
    name: 'Сети, коллекторы, водные объекты',
    shortName: 'Сети',
    icon: 'pipe',
    color: '#7a4fd6',
    sort: 30,
    periodKind: 'WEEK',
    planWeekday: 3, // план на среду отчётной недели
    progressMethod: 'WEIGHTED_BY_COST',
    planMethod: 'LINEAR_SITE_DATES',
    moneySource: 'CONTRACTS',
    moneyLabel: 'Договоры',
    thrWarn: -5,
    thrCrit: -15,
    siteUnit: 'объектов',
  },
  {
    code: 'streets',
    name: 'Благоустройство улиц',
    shortName: 'Благоустройство',
    icon: 'road',
    color: '#d6801f',
    sort: 40,
    isReadonly: true,
    periodKind: 'REPORT',
    progressMethod: 'SHARE_COMPLETED',
    planMethod: 'NONE',
    moneySource: 'NONE',
    thrWarn: -2,
    thrCrit: -10,
    siteUnit: 'объектов',
  },
];

type StatusSeed = Omit<Prisma.StatusDefCreateManyInput, 'directionId' | 'entity'>;

/** Статусы позиции МКД (из исходного дашборда). */
const MKD_ITEM_STATUSES: StatusSeed[] = [
  { code: 'plan', name: 'Не начато', color: '#9aa4b2', sort: 10 },
  { code: 'work', name: 'В работе', color: '#2f6fd6', sort: 20 },
  { code: 'stop', name: 'Приостановлено', color: '#d64545', sort: 30 },
  { code: 'ks', name: 'КС-2 подписаны, к оплате', shortName: 'К оплате', color: '#e0a526', sort: 40, countsAsDone: true },
  { code: 'paid', name: 'Оплачено', color: '#0f9d76', sort: 50, countsAsDone: true, isFinal: true },
  { code: 'excl', name: 'Исключено', color: '#b7bec8', sort: 60, excludeFromCalc: true, isFinal: true },
];

/** Статусы объекта Сетей. */
const NETWORK_SITE_STATUSES: StatusSeed[] = [
  { code: 'prep', name: 'Подготовка', color: '#9aa4b2', sort: 10 },
  { code: 'work', name: 'В работе', color: '#2f6fd6', sort: 20 },
  { code: 'stop', name: 'Приостановлено', color: '#d64545', sort: 30 },
  { code: 'done', name: 'Выполнено', color: '#0f9d76', sort: 40, isFinal: true },
  { code: 'plan2027', name: 'План 2027', color: '#b7bec8', sort: 50 },
];

/**
 * Настройки отображения направлений: подпись готовности и дополнительные показатели сводки
 * (метрики — apps/api/src/kpi/metrics.ts). Записываются, только если ключа ещё нет, — правки из админки не затираются.
 */
const STREETS_DONE = ['Работы завершены', 'Сдан ЦККБ'];
const DIRECTION_SETTINGS: Record<string, Record<string, unknown>> = {
  schools: {
    factLabel: 'Готовность ДКР (взвешенная по видам работ)',
    kpis: [
      { metric: 'scheduleLagDays', label: 'Отставание от графика' },
      { metric: 'trackerOverdue', label: 'Просрочено поставок', params: { tracker: 'proc', stage: 'deliv' } },
      { metric: 'trackerStatusDone', label: 'Заключения МГЭ', params: { tracker: 'mge', stage: 'status' } },
    ],
  },
  mkd: {
    kpis: [
      { metric: 'toPay', label: 'К оплате (КС-2 подписаны)' },
      { metric: 'overdueItems', label: 'Просрочено позиций' },
      { metric: 'itemsByStatus', label: 'Позиций в работе', params: { statuses: ['work', 'stop'] } },
      { metric: 'remarksOverdue', label: 'Просрочено замечаний' },
    ],
  },
  networks: {
    kpis: [
      { metric: 'qtyByUnit', label: 'Проложено и отремонтировано', params: { unit: 'п.м' } },
      { metric: 'sitesDone', label: 'Выполнено объектов' },
      { metric: 'advance', label: 'Аванс выплачен' },
      { metric: 'remarksOverdue', label: 'Просрочено замечаний' },
    ],
  },
  streets: {
    programs: { kbu: 'КБУ', current: 'Текущий ремонт' },
    kpis: [
      { metric: 'reportStatusCount', label: 'Завершены по статусу', params: { statuses: STREETS_DONE } },
      { metric: 'sitesWithRemainder', label: 'Есть остаток объёмов', params: { doneStatuses: STREETS_DONE } },
      { metric: 'remarksTotal', label: 'Замечаний в отчёте' },
    ],
  },
};

const APP_SETTINGS: Record<string, Prisma.InputJsonValue> = {
  'org.name': 'МВС СТ',
  // светофор направления в сводке, п.п. отклонения факт − план
  'overview.thresholds': { warn: -2, crit: -10 },
};

async function main() {
  for (const d of DIRECTIONS) {
    const { code, ...rest } = d;
    await prisma.direction.upsert({ where: { code }, create: d, update: rest });
  }
  const byCode = Object.fromEntries((await prisma.direction.findMany()).map((d) => [d.code, d.id]));

  for (const [code, defaults] of Object.entries(DIRECTION_SETTINGS)) {
    const d = await prisma.direction.findUniqueOrThrow({ where: { code }, select: { settings: true } });
    const cur = (d.settings ?? {}) as Record<string, unknown>;
    const missing = Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in cur)));
    if (Object.keys(missing).length) {
      await prisma.direction.update({ where: { code }, data: { settings: { ...cur, ...missing } as Prisma.InputJsonValue } });
    }
  }

  const statuses: [string, 'SITE' | 'WORK_ITEM', StatusSeed[]][] = [
    ['mkd', 'WORK_ITEM', MKD_ITEM_STATUSES],
    ['networks', 'SITE', NETWORK_SITE_STATUSES],
  ];
  for (const [dir, entity, list] of statuses) {
    for (const s of list) {
      const directionId = byCode[dir];
      await prisma.statusDef.upsert({
        where: { directionId_entity_code: { directionId, entity, code: s.code } },
        create: { directionId, entity, ...s },
        update: s,
      });
    }
  }

  for (const [key, value] of Object.entries(APP_SETTINGS)) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  if (!(await prisma.user.count({ where: { globalRole: 'ADMIN' } }))) {
    const login = process.env.ADMIN_LOGIN || 'admin';
    const password = process.env.ADMIN_PASSWORD;
    if (!password) throw new Error('Задайте ADMIN_PASSWORD для создания первого администратора');
    await prisma.user.create({
      data: {
        login,
        passwordHash: await hash(password, 12),
        canLogin: true,
        mustChangePassword: true,
        globalRole: 'ADMIN',
        fullName: 'Администратор',
      },
    });
    console.log(`Создан администратор «${login}». При первом входе система попросит сменить пароль.`);
  }
  console.log(`Направлений: ${DIRECTIONS.length}. Базовое наполнение завершено.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
