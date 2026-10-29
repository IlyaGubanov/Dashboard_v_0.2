/**
 * Благоустройство: каталог улиц → site (+ координаты), листы сводного отчёта → reporting_period (program: kbu / current),
 * объёмы по видам работ на каждый отчёт → progress_entry (факт; проект и «принято» — в attrs),
 * люди, техника, статус и число замечаний → site_report.
 */
import type { Prisma } from '@prisma/client';
import { attrs, chunked, day, mergeSettings, num, text, type Tx } from './lib';

interface Cell { p: number | null; f: number | null; a: number | null }
interface StreetsData {
  source: string; unitsNote?: string;
  works: { id: string; name: string; unit: string | null }[];
  catalog: {
    id: string; name: string; okrug?: string;
    geo: { lat: number; lon: number; address?: string; precision?: string; source?: string } | null; geoNote: string | null;
  }[];
  excluded: { sheet: string; reason: string }[];
  discrepancies: { sheet: string; work: string; field: string; detail: number; summary: number }[];
  snapshots: {
    sheet: string; date: string; program: string; works: string[];
    objects: { id: string; status: string | null; people: number | null; tech: number | null; remarks: number | null; row: number | null; works: Record<string, Cell> }[];
  }[];
}

const PROGRAMS: Record<string, string> = { kbu: 'КБУ', current: 'Текущий ремонт' };

export async function importStreets(db: Tx, directionId: number, d: StreetsData) {
  await mergeSettings(db, directionId, {
    source: d.source, unitsNote: d.unitsNote ?? null, programs: PROGRAMS,
    excludedSheets: d.excluded, discrepancies: d.discrepancies,
  });

  // разделы = программы отчёта
  const program = new Map<string, number>();
  for (const [i, [code, name]] of Object.entries(PROGRAMS).entries()) {
    program.set(code, (await db.section.create({ data: { directionId, code, name, sort: i * 10 } })).id);
  }

  const wt = new Map<string, { id: number; unit: string | null }>();
  for (const [i, w] of d.works.entries()) {
    const r = await db.workType.create({ data: { directionId, code: w.id, name: w.name, unit: text(w.unit), sort: i * 10 } });
    wt.set(w.id, { id: r.id, unit: r.unit });
  }

  // объект относится к программе, в отчётах которой встречается (последней)
  const lastProgram = new Map<string, string>();
  for (const s of d.snapshots) for (const o of s.objects) lastProgram.set(o.id, s.program);

  const site = new Map<string, number>();
  for (const [i, c] of d.catalog.entries()) {
    const r = await db.site.create({
      data: {
        directionId,
        sectionId: program.get(lastProgram.get(c.id) ?? 'kbu'),
        code: c.id.slice(0, 120),
        num: i + 1,
        name: c.name,
        shortName: c.name.length > 200 ? `${c.name.slice(0, 197)}…` : c.name,
        okrug: text(c.okrug),
        address: text(c.geo?.address)?.slice(0, 500),
        lat: c.geo ? Number(c.geo.lat.toFixed(6)) : null,
        lon: c.geo ? Number(c.geo.lon.toFixed(6)) : null,
        sort: i * 10,
        attrs: attrs({ geoPrecision: text(c.geo?.precision), geoSource: text(c.geo?.source), geoNote: c.geoNote }),
      },
    });
    site.set(c.id, r.id);
  }
  await db.fieldDef.createMany({
    data: [
      { directionId, entity: 'SITE', code: 'geoPrecision', label: 'Точность координат', type: 'TEXT', groupName: 'Карта', sort: 10 },
      { directionId, entity: 'SITE', code: 'geoSource', label: 'Источник координат', type: 'URL', groupName: 'Карта', sort: 20 },
      { directionId, entity: 'SITE', code: 'geoNote', label: 'Уточнение местоположения', type: 'TEXT', groupName: 'Карта', sort: 30 },
    ],
  });

  // позиции: объект × вид работ, если он хоть раз есть в отчётах; проектный объём — последний известный
  const lastPlan = new Map<string, number | null>();
  for (const s of d.snapshots) {
    for (const o of s.objects) {
      for (const [w, c] of Object.entries(o.works)) {
        if (c.p == null && c.f == null && c.a == null) continue;
        const k = `${o.id}|${w}`;
        if (c.p != null || !lastPlan.has(k)) lastPlan.set(k, c.p);
      }
    }
  }
  const item = new Map<string, number>();
  for (const [k, p] of lastPlan) {
    const [oid, w] = k.split('|');
    const t = wt.get(w);
    if (!t || !site.has(oid)) continue;
    const r = await db.workItem.create({ data: { siteId: site.get(oid)!, workTypeId: t.id, code: w, unit: t.unit, planQty: p } });
    item.set(k, r.id);
  }

  const period = new Map<string, number>();
  for (const s of [...d.snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    const r = await db.reportingPeriod.create({
      data: { directionId, date: day(s.date)!, program: s.program, label: s.sheet.slice(0, 100), status: 'LOCKED' },
    });
    period.set(`${s.program}|${s.date}`, r.id);
  }

  const progress: Prisma.ProgressEntryCreateManyInput[] = [];
  const reports: Prisma.SiteReportCreateManyInput[] = [];
  for (const s of d.snapshots) {
    const periodId = period.get(`${s.program}|${s.date}`)!;
    for (const o of s.objects) {
      const siteId = site.get(o.id);
      if (!siteId) continue;
      reports.push({
        siteId, periodId, workers: num(o.people), machines: num(o.tech), remarksCount: num(o.remarks),
        statusText: text(o.status)?.slice(0, 200), source: 'IMPORT', attrs: attrs({ row: o.row }),
      });
      for (const [w, c] of Object.entries(o.works)) {
        const workItemId = item.get(`${o.id}|${w}`);
        if (!workItemId || (c.p == null && c.f == null && c.a == null)) continue;
        progress.push({
          workItemId, periodId,
          factQty: c.f,
          pct: c.p && c.p > 0 && c.f != null ? Math.min(100, (c.f / c.p) * 100) : null,
          source: 'IMPORT',
          attrs: attrs({ p: c.p, a: c.a }),
        });
      }
    }
  }
  await chunked(reports, 2000, (part) => db.siteReport.createMany({ data: part }));
  await chunked(progress, 2000, (part) => db.progressEntry.createMany({ data: part }));

  return { sites: site.size, workTypes: wt.size, workItems: item.size, periods: period.size, progress: progress.length, reports: reports.length };
}
