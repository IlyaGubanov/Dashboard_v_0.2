/**
 * Сети: объекты → site, договоры → contract, линии прокладки → work_item,
 * weekly[неделя][объект] = { f: факт по линиям, ks, w, m } → progress_entry + site_report,
 * документация (ПСД, DWG, МГЭ, согласования, ордер) → трекер «Документация».
 */
import type { Prisma } from '@prisma/client';
import { assign, attrs, chunked, day, member, mergeSettings, num, Orgs, People, text, type Tx } from './lib';

interface Line { id: string; kind: string; label?: string; unit?: string; plan?: number; d?: string | null; sn?: string | null }
interface NetObject {
  id: string; n?: number; sec: string; name: string; short?: string; ex?: string[]; status?: string; start?: string; end?: string;
  contracts: { no?: string; date?: string; end?: string; cost?: number; adv?: number; ks?: number }[];
  docs?: Record<string, string | null>; sub?: string; designer?: string; curator?: string; note?: string | null; note_end?: string;
  lines: Line[]; archived?: boolean;
}
interface NetData {
  meta: { source: string; sections: { id: string; title: string }[] };
  weeks: string[];
  objects: NetObject[];
  weekly: Record<string, Record<string, { f: Record<string, number>; ks?: number; w?: number; m?: number }>>;
}

/** Виды работ Сетей (из справочника исходного модуля). */
const WORK_TYPES = [
  { code: 'open', name: 'Открытая прокладка', unit: 'п.м', group: 'Сети' },
  { code: 'closed', name: 'Закрытая прокладка', unit: 'п.м', group: 'Сети' },
  { code: 'san', name: 'Санация', unit: 'п.м', group: 'Сети' },
  { code: 'kol', name: 'Коллектор: ремонт/реконструкция', unit: 'п.м', group: 'Коллекторы' },
  { code: 'clean', name: 'Очистка пруда', unit: 'м³', group: 'Водные объекты' },
  { code: 'shore', name: 'Береговая полоса', unit: 'м', group: 'Водные объекты' },
  { code: 'memb', name: 'Мембрана', unit: 'м²', group: 'Водные объекты' },
  { code: 'well', name: 'Колодцы', unit: 'шт.', group: 'Сети' },
  { code: 'blag', name: 'Восстановление благоустройства', unit: 'м²', group: 'Прочее' },
];

const DOC_STAGES = [
  { code: 'psd', name: 'ПСД' },
  { code: 'dwg', name: 'DWG' },
  { code: 'mge', name: 'МГЭ' },
  { code: 'sogl', name: 'Согласования' },
  { code: 'soglG', name: 'Согл. городка' },
  { code: 'order', name: 'Ордер / уведомление' },
];

const SITE_STATUS: Record<string, string> = {
  Подготовка: 'prep',
  'В работе': 'work',
  Приостановлено: 'stop',
  Выполнено: 'done',
  'План 2027': 'plan2027',
};

export async function importNetworks(db: Tx, directionId: number, d: NetData) {
  await mergeSettings(db, directionId, { source: d.meta.source });

  const sec = new Map<string, number>();
  for (const [i, s] of d.meta.sections.entries()) {
    sec.set(s.id, (await db.section.create({ data: { directionId, code: s.id, name: s.title, sort: i * 10 } })).id);
  }
  const groups = new Map<string, number>();
  for (const g of [...new Set(WORK_TYPES.map((w) => w.group))]) {
    groups.set(g, (await db.workGroup.create({ data: { directionId, name: g, sort: groups.size * 10 } })).id);
  }
  const wt = new Map<string, number>();
  for (const [i, w] of WORK_TYPES.entries()) {
    const r = await db.workType.create({
      data: { directionId, groupId: groups.get(w.group), code: w.code, name: w.name, unit: w.unit, sort: i * 10 },
    });
    wt.set(w.code, r.id);
  }

  const docs = await db.tracker.create({
    data: {
      directionId,
      code: 'docs',
      name: 'Документация',
      layout: 'CARD',
      description: 'Готовность проектной и разрешительной документации: «+» — есть, иначе — текущее состояние',
      items: { create: { code: 'main', name: 'Документация объекта' } },
      stages: { create: DOC_STAGES.map((s, i) => ({ ...s, valueType: 'TEXT' as const, sort: i * 10 })) },
    },
    include: { items: true, stages: true },
  });
  const docItem = docs.items[0].id;
  const docStage = new Map(docs.stages.map((s) => [s.code, s.id]));

  await db.fieldDef.createMany({
    data: [
      { directionId, entity: 'SITE', code: 'contractorNote', label: 'Подрядчик (примечание)', type: 'TEXT', groupName: 'Основное', sort: 10 },
      { directionId, entity: 'SITE', code: 'noteEnd', label: 'Примечание к сроку окончания', type: 'TEXT', groupName: 'Сроки', sort: 20 },
      { directionId, entity: 'WORK_ITEM', code: 'd', label: 'Диаметр', type: 'TEXT', unit: 'мм', sort: 10 },
      { directionId, entity: 'WORK_ITEM', code: 'sn', label: 'Кольцевая жёсткость (SN)', type: 'TEXT', sort: 20 },
    ],
  });

  const status = new Map((await db.statusDef.findMany({ where: { directionId, entity: 'SITE' } })).map((s) => [s.code, s.id]));
  const people = new People(db);
  const orgs = new Orgs(db, directionId);

  const site = new Map<string, number>();
  const line = new Map<string, { id: number; plan: number }>();
  for (const [i, o] of d.objects.entries()) {
    // «Готовы к конкурсу…» — не организация, а состояние; кладём в примечание
    const subIsOrg = !!o.sub && !/^готов/i.test(o.sub);
    const contractorId = subIsOrg ? await orgs.get(o.sub, 'CONTRACTOR', !!o.ex?.includes('sub')) : null;
    const r = await db.site.create({
      data: {
        directionId,
        sectionId: sec.get(o.sec),
        code: o.id,
        num: o.n ?? i + 1,
        name: o.name,
        shortName: text(o.short) ?? o.name,
        statusId: o.status ? status.get(SITE_STATUS[o.status]) : undefined,
        planStart: day(o.start),
        planEnd: day(o.end),
        contractorId,
        designerId: await orgs.get(o.designer, 'DESIGNER', !!o.ex?.includes('designer')),
        note: text(o.note),
        sort: i * 10,
        isArchived: !!o.archived,
        isExample: !!o.ex?.length,
        attrs: attrs({ contractorNote: subIsOrg ? null : o.sub, noteEnd: text(o.note_end), exampleFields: o.ex }),
      },
    });
    site.set(o.id, r.id);

    // куратор объекта — ответственный за ввод по своим объектам
    const cur = await people.get(o.curator, { position: 'Куратор ГУП МВС' });
    await assign(db, r.id, cur, 'CURATOR');
    await member(db, directionId, cur, 'EDITOR', 'SITES');

    for (const c of o.contracts) {
      await db.contract.create({
        data: {
          siteId: r.id,
          organizationId: contractorId,
          number: text(c.no),
          signedAt: day(c.date),
          endAt: day(c.end),
          amount: num(c.cost),
          advanceAmount: num(c.adv),
          attrs: attrs({ ks: num(c.ks) }),
          isExample: !!o.ex?.some((f) => f.startsWith('c')),
        },
      });
    }

    for (const [j, l] of o.lines.entries()) {
      const w = await db.workItem.create({
        data: {
          siteId: r.id,
          workTypeId: wt.get(l.kind)!,
          code: l.id,
          label: text(l.label),
          unit: text(l.unit),
          planQty: num(l.plan),
          sort: j,
          isExample: !!o.ex?.includes(`line:${l.id}.plan`),
          attrs: attrs({ d: text(l.d), sn: text(l.sn) }),
        },
      });
      line.set(`${o.id}|${l.id}`, { id: w.id, plan: num(l.plan) ?? 0 });
    }

    const row = await db.trackerRow.create({ data: { siteId: r.id, itemId: docItem } });
    const values = Object.entries(o.docs ?? {})
      .filter(([k, v]) => docStage.has(k) && text(v))
      .map(([k, v]) => ({ rowId: row.id, stageId: docStage.get(k)!, valueText: text(v)!.slice(0, 500) }));
    if (values.length) await db.trackerValue.createMany({ data: values });
  }

  const period = new Map<string, number>();
  for (const [i, w] of d.weeks.entries()) {
    const last = i === d.weeks.length - 1;
    period.set(w, (await db.reportingPeriod.create({ data: { directionId, date: day(w)!, status: last ? 'OPEN' : 'CLOSED', closedAt: last ? null : day(w) } })).id);
  }

  const progress: Prisma.ProgressEntryCreateManyInput[] = [];
  const reports: Prisma.SiteReportCreateManyInput[] = [];
  const byId = new Map(d.objects.map((o) => [o.id, o]));
  for (const [w, objs] of Object.entries(d.weekly)) {
    for (const [oid, e] of Object.entries(objs)) {
      const o = byId.get(oid);
      const siteId = site.get(oid);
      if (!o || !siteId) continue;
      reports.push({
        siteId,
        periodId: period.get(w)!,
        ksAmount: num(e.ks),
        workers: num(e.w),
        machines: num(e.m),
        source: 'MIGRATION',
        isExample: !!o.ex?.includes('c0.ks'),
      });
      for (const l of o.lines) {
        const it = line.get(`${oid}|${l.id}`)!;
        const f = num(e.f?.[l.id]);
        if (f == null) continue;
        progress.push({
          workItemId: it.id,
          periodId: period.get(w)!,
          factQty: f,
          pct: it.plan > 0 ? Math.min(100, (f / it.plan) * 100) : null,
          source: 'MIGRATION',
          isExample: !!o.ex?.includes(`line:${l.id}.fact`),
        });
      }
    }
  }
  await chunked(reports, 2000, (part) => db.siteReport.createMany({ data: part }));
  await chunked(progress, 2000, (part) => db.progressEntry.createMany({ data: part }));

  return { sections: sec.size, sites: site.size, workItems: line.size, periods: period.size, progress: progress.length, reports: reports.length };
}
