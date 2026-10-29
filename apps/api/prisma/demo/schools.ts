/**
 * Школы: школы → site (+ доп. поля: тип здания, площадь, пищеблок…), виды работ с весами → work_type,
 * выполнение видов работ на дату выгрузки → progress_entry, дневной журнал людей и техники → site_report,
 * закупки, индивидуальные испытания, МГЭ → трекеры.
 */
import type { Prisma } from '@prisma/client';
import { assign, attrs, chunked, day, mergeSettings, num, Orgs, People, text, type Tx } from './lib';

interface School {
  name: string; short?: string; okrug?: string; district?: string; type?: string; area?: number; terr?: number;
  contractor?: string; designer?: string; responsible?: string; order?: number; archived?: boolean;
  fin?: { limitTotal?: number; limit2026?: number; paid?: number };
  works: Record<string, { pct?: number; pv?: number | null; fv?: number | null }>;
  kitchen?: string; res?: { people?: number; tech?: number; peopleBl?: number; techBl?: number; date?: string };
  proc: Record<string, { maker?: string; supplier?: string; pay?: number; deliv?: number; inst?: number; qty?: number; unit?: string; dDeliv?: string; dDone?: string }>;
  procPayTotal?: number; ii: Record<string, { st?: string; idDocs?: boolean }>; iiComplex?: string; iiSourceDemo?: string;
  mge?: Record<string, string | undefined>;
}
interface SchoolsData {
  asOf: string;
  objects: Record<string, School>;
  ref: {
    works: { items: Record<string, { name: string; group?: string; w?: number; start?: string; end?: string; unit?: string; order?: number }> };
    materials: { items: Record<string, { cat?: string; name: string; order?: number; period?: string }> };
    systems: { items: Record<string, { name: string; order?: number }> };
  };
  log: Record<string, { date: string; obj: string; people?: number; tech?: number; peopleBl?: number; techBl?: number; src?: string }>;
}

const II_STATUS = [
  { value: 'готово', label: 'Готово', color: 'teal', done: true },
  { value: 'работоспособна', label: 'Работоспособна', color: 'green', done: true },
  { value: 'в работе', label: 'В работе', color: 'blue' },
  { value: 'не начато', label: 'Не начато', color: 'gray' },
  { value: 'отсутствует', label: 'Отсутствует', color: 'dark' },
];
const MGE_STATUS = [
  { value: 'ВЕДЁТСЯ РАЗРАБОТКА ПСД', label: 'Ведётся разработка ПСД', color: 'gray' },
  { value: 'НА РАССМОТРЕНИИ В МГЭ', label: 'На рассмотрении в МГЭ', color: 'blue' },
  { value: 'ПОЛУЧЕНО ПОЛОЖИТЕЛЬНОЕ ЗАКЛЮЧЕНИЕ', label: 'Положительное заключение', color: 'green', done: true },
  { value: 'ПЕРЕЗАХОД / ОТРИЦАТЕЛЬНОЕ', label: 'Перезаход / отрицательное', color: 'red' },
];
const MGE_STAGES = [
  { code: 'designer', name: 'Проектировщик', valueType: 'TEXT' },
  { code: 'reviewer', name: 'Заказчик экспертизы', valueType: 'TEXT' },
  { code: 'pirStart', name: 'Начало ПИР', valueType: 'DATE' },
  { code: 'pDone', name: 'Проект готов', valueType: 'DATE' },
  { code: 'expIn', name: 'Подано в МГЭ', valueType: 'DATE' },
  { code: 'expOut', name: 'Заключение МГЭ', valueType: 'DATE' },
  { code: 'handover', name: 'Передача документации', valueType: 'DATE' },
  { code: 'status', name: 'Статус экспертизы', valueType: 'STATUS', options: MGE_STATUS },
] as const;

export async function importSchools(db: Tx, directionId: number, d: SchoolsData) {
  await mergeSettings(db, directionId, { asOf: d.asOf });

  await db.fieldDef.createMany({
    data: [
      { directionId, entity: 'SITE', code: 'type', label: 'Тип здания', type: 'TEXT', groupName: 'Объект', showInList: true, sort: 10 },
      { directionId, entity: 'SITE', code: 'area', label: 'Площадь здания', type: 'NUMBER', unit: 'м²', groupName: 'Объект', sort: 20 },
      { directionId, entity: 'SITE', code: 'terr', label: 'Площадь территории', type: 'NUMBER', unit: 'га', groupName: 'Объект', sort: 30 },
      { directionId, entity: 'SITE', code: 'limit2026', label: 'Лимит 2026', type: 'MONEY', unit: '₽', groupName: 'Финансы', sort: 40 },
      {
        directionId, entity: 'SITE', code: 'kitchen', label: 'Пищеблок', type: 'SELECT', groupName: 'Готовность', sort: 50,
        options: [{ value: 'ГОТОВ', label: 'Готов', color: 'green' }, { value: 'НЕ ГОТОВ', label: 'Не готов', color: 'red' }],
      },
      { directionId, entity: 'SITE', code: 'iiComplex', label: 'Комплексное опробование', type: 'TEXT', groupName: 'Готовность', sort: 60 },
      { directionId, entity: 'SITE', code: 'procPayTotal', label: 'Оплата закупок, итого', type: 'PERCENT', groupName: 'Закупки', sort: 70 },
      { directionId, entity: 'SITE', code: 'iiSourceDemo', label: 'Источник примера испытаний', type: 'TEXT', groupName: 'Готовность', sort: 80 },
    ],
  });

  const groups = new Map<string, number>();
  const refWorks = Object.entries(d.ref.works.items).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  for (const g of [...new Set(refWorks.map(([, w]) => w.group || 'Прочее'))]) {
    groups.set(g, (await db.workGroup.create({ data: { directionId, name: g, sort: groups.size * 10 } })).id);
  }
  const wt = new Map<string, { id: number; unit: string | null; start: Date | null; end: Date | null }>();
  for (const [code, w] of refWorks) {
    const r = await db.workType.create({
      data: {
        directionId,
        groupId: groups.get(w.group || 'Прочее'),
        code,
        name: w.name,
        unit: text(w.unit),
        weight: num(w.w),
        planStart: day(w.start),
        planEnd: day(w.end),
        sort: (w.order ?? 0) * 10,
      },
    });
    wt.set(code, { id: r.id, unit: r.unit, start: r.planStart, end: r.planEnd });
  }

  // трекеры
  const proc = await db.tracker.create({
    data: {
      directionId, code: 'proc', name: 'Закупки', sort: 10, description: 'Оплата → поставка → монтаж по каждому материалу и оборудованию',
      items: {
        create: Object.entries(d.ref.materials.items).map(([code, m]) => ({
          code, name: m.name, category: text(m.cat), sort: (m.order ?? 0) * 10, attrs: attrs({ period: text(m.period) }),
        })),
      },
      stages: {
        create: [
          { code: 'pay', name: 'Оплата', valueType: 'PERCENT', sort: 10 },
          { code: 'deliv', name: 'Поставка', valueType: 'PERCENT', sort: 20 },
          { code: 'inst', name: 'Монтаж', valueType: 'PERCENT', sort: 30 },
        ],
      },
    },
    include: { items: true, stages: true },
  });
  const ii = await db.tracker.create({
    data: {
      directionId, code: 'ii', name: 'Индивидуальные испытания', sort: 20, description: 'Сдача систем по объектам',
      items: { create: Object.entries(d.ref.systems.items).map(([code, s]) => ({ code, name: s.name, sort: (s.order ?? 0) * 10 })) },
      stages: {
        create: [
          { code: 'st', name: 'Статус', valueType: 'STATUS', options: II_STATUS, sort: 10 },
          { code: 'idDocs', name: 'Исполнительная документация', valueType: 'BOOL', inProgress: false, sort: 20 },
        ],
      },
    },
    include: { items: true, stages: true },
  });
  const mge = await db.tracker.create({
    data: {
      directionId, code: 'mge', name: 'Проектирование и МГЭ', layout: 'CARD', sort: 30,
      items: { create: { code: 'main', name: 'Проект и экспертиза' } },
      stages: { create: MGE_STAGES.map((s, i) => ({ ...s, options: 'options' in s ? s.options : undefined, sort: i * 10 })) },
    },
    include: { items: true, stages: true },
  });
  const idx = (t: { items: { id: number; code: string }[]; stages: { id: number; code: string }[] }) => ({
    item: new Map(t.items.map((x) => [x.code, x.id])),
    stage: new Map(t.stages.map((x) => [x.code, x.id])),
  });
  const P = idx(proc), I = idx(ii), G = idx(mge);

  // периоды: каждый день журнала ресурсов + дата выгрузки
  const dates = [...new Set([...Object.values(d.log).map((l) => l.date), d.asOf])].sort();
  const period = new Map<string, number>();
  for (const dt of dates) {
    period.set(dt, (await db.reportingPeriod.create({ data: { directionId, date: day(dt)!, status: dt === d.asOf ? 'OPEN' : 'CLOSED' } })).id);
  }

  const people = new People(db);
  const orgs = new Orgs(db, directionId);
  const site = new Map<string, number>();
  const progress: Prisma.ProgressEntryCreateManyInput[] = [];
  const values: Prisma.TrackerValueCreateManyInput[] = [];

  for (const [code, o] of Object.entries(d.objects)) {
    const r = await db.site.create({
      data: {
        directionId,
        code,
        num: o.order ?? null,
        name: o.name,
        shortName: text(o.short) ?? o.name,
        address: o.name,
        okrug: text(o.okrug),
        district: text(o.district),
        contractorId: await orgs.get(o.contractor, 'CONTRACTOR'),
        designerId: await orgs.get(o.designer, 'DESIGNER'),
        limitAmount: num(o.fin?.limitTotal),
        sort: (o.order ?? 0) * 10,
        isArchived: !!o.archived,
        attrs: attrs({
          type: text(o.type), area: num(o.area), terr: num(o.terr), limit2026: num(o.fin?.limit2026),
          kitchen: text(o.kitchen), iiComplex: text(o.iiComplex), procPayTotal: o.procPayTotal == null ? null : o.procPayTotal * 100,
          iiSourceDemo: text(o.iiSourceDemo),
        }),
      },
    });
    site.set(code, r.id);
    await assign(db, r.id, await people.get(o.responsible, { position: 'Ответственный по объекту' }), 'RESPONSIBLE');

    for (const [wcode, w] of Object.entries(o.works)) {
      const t = wt.get(wcode);
      if (!t) continue;
      const item = await db.workItem.create({
        data: { siteId: r.id, workTypeId: t.id, code: wcode, unit: t.unit, planQty: num(w.pv), planStart: t.start, planEnd: t.end },
      });
      progress.push({
        workItemId: item.id,
        periodId: period.get(d.asOf)!,
        pct: w.pct == null ? null : Math.round(w.pct * 10000) / 100,
        factQty: num(w.fv),
        source: 'MIGRATION',
      });
    }

    for (const [mcode, m] of Object.entries(o.proc)) {
      const itemId = P.item.get(mcode);
      if (!itemId) continue;
      const row = await db.trackerRow.create({
        data: {
          siteId: r.id, itemId, qty: num(m.qty), unit: text(m.unit), planDate: day(m.dDeliv), dueDate: day(m.dDone),
          attrs: attrs({ maker: text(m.maker), supplier: text(m.supplier) }),
        },
      });
      for (const k of ['pay', 'deliv', 'inst'] as const) {
        if (m[k] != null) values.push({ rowId: row.id, stageId: P.stage.get(k)!, valueNum: m[k]! * 100 });
      }
    }
    for (const [scode, s] of Object.entries(o.ii)) {
      const itemId = I.item.get(scode);
      if (!itemId) continue;
      const row = await db.trackerRow.create({ data: { siteId: r.id, itemId } });
      if (s.st) values.push({ rowId: row.id, stageId: I.stage.get('st')!, valueText: s.st });
      if (s.idDocs != null) values.push({ rowId: row.id, stageId: I.stage.get('idDocs')!, valueBool: s.idDocs });
    }
    if (o.mge) {
      const row = await db.trackerRow.create({ data: { siteId: r.id, itemId: G.item.get('main')! } });
      for (const s of MGE_STAGES) {
        const v = o.mge[s.code];
        if (!text(v)) continue;
        values.push(
          s.valueType === 'DATE'
            ? { rowId: row.id, stageId: G.stage.get(s.code)!, valueDate: day(v) }
            : { rowId: row.id, stageId: G.stage.get(s.code)!, valueText: text(v)!.slice(0, 500) },
        );
      }
    }
  }

  // журнал людей и техники по дням; на дату выгрузки — ещё и оплачено
  const reports = new Map<string, Prisma.SiteReportCreateManyInput>();
  for (const l of Object.values(d.log)) {
    const siteId = site.get(l.obj);
    if (!siteId) continue;
    reports.set(`${l.obj}|${l.date}`, {
      siteId, periodId: period.get(l.date)!, workers: num(l.people), machines: num(l.tech),
      workersBlocked: num(l.peopleBl), machinesBlocked: num(l.techBl), source: 'MIGRATION', attrs: attrs({ src: l.src }),
    });
  }
  for (const [code, o] of Object.entries(d.objects)) {
    const key = `${code}|${d.asOf}`;
    const res = o.res?.date === d.asOf ? o.res : undefined;
    const base = reports.get(key) ?? { siteId: site.get(code)!, periodId: period.get(d.asOf)!, source: 'MIGRATION' as const };
    reports.set(key, {
      ...base,
      workers: base.workers ?? num(res?.people),
      machines: base.machines ?? num(res?.tech),
      workersBlocked: base.workersBlocked ?? num(res?.peopleBl),
      machinesBlocked: base.machinesBlocked ?? num(res?.techBl),
      paidAmount: num(o.fin?.paid),
    });
  }

  await chunked(progress, 2000, (part) => db.progressEntry.createMany({ data: part }));
  await chunked([...reports.values()], 2000, (part) => db.siteReport.createMany({ data: part }));
  await chunked(values, 2000, (part) => db.trackerValue.createMany({ data: part }));

  return { sites: site.size, workTypes: wt.size, periods: period.size, progress: progress.length, reports: reports.size, trackerValues: values.length };
}
