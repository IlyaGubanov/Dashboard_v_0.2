/**
 * МКД: адреса → site, позиции → work_item, отчётные недели → reporting_period,
 * снимки snaps[позиция][неделя] → progress_entry. Люди → пользователи без входа,
 * куратор / ответственный за ввод адреса → site_assignment.
 */
import type { Prisma } from '@prisma/client';
import { assign, attrs, chunked, day, member, mergeSettings, moment, num, Orgs, People, text, type Tx } from './lib';

interface MkdData {
  meta: { title: string; subtitle: string; source: string; docContract: number; docRows: Record<string, number> };
  sections: { id: string; name: string; note?: string }[];
  people: { id: string; name: string; role?: string; phone?: string; email?: string; ex?: boolean }[];
  orgs: { id: string; name: string; ex?: boolean }[];
  workTypes: { id: string; name: string; full?: string; group?: string; unit?: string }[];
  objects: { id: string; addr: string; sectionId?: string; curatorId?: string; entryId?: string; note?: string; archived?: boolean; ex?: string[] }[];
  items: {
    id: string; objId: string; typeId: string; n?: number; srcRow?: number; contract?: number; inwork?: number | null;
    approx?: number | null; start?: string; end?: string; respId?: string; orgId?: string; note?: string; archived?: boolean; ex?: string[];
  }[];
  weeks: string[];
  snaps: Record<string, Record<string, { st?: string; pct?: number; ks?: number; paid?: number; by?: string; at?: string; ex?: boolean }>>;
  log: { t: string; u: string; a: string; d: string }[];
}

export async function importMkd(db: Tx, directionId: number, d: MkdData) {
  await mergeSettings(db, directionId, {
    subtitle: d.meta.subtitle, source: d.meta.source, docContract: d.meta.docContract, docRows: d.meta.docRows,
  });

  const sec = new Map<string, number>();
  for (const [i, s] of d.sections.entries()) {
    const r = await db.section.create({ data: { directionId, code: s.id, name: s.name, note: text(s.note), sort: i * 10 } });
    sec.set(s.id, r.id);
  }

  const groups = new Map<string, number>();
  for (const g of [...new Set(d.workTypes.map((w) => w.group || 'Прочее'))]) {
    groups.set(g, (await db.workGroup.create({ data: { directionId, name: g, sort: groups.size * 10 } })).id);
  }
  const wt = new Map<string, number>();
  for (const [i, w] of d.workTypes.entries()) {
    const r = await db.workType.create({
      data: {
        directionId,
        groupId: groups.get(w.group || 'Прочее'),
        code: w.id,
        name: w.name,
        fullName: text(w.full),
        unit: text(w.unit),
        sort: i * 10,
      },
    });
    wt.set(w.id, r.id);
  }

  // люди: кураторы → кураторы направления, инженеры ПТО → ответственные за ввод по своим адресам
  const people = new People(db);
  const person = new Map<string, number>();
  for (const p of d.people) {
    const id = (await people.get(p.name, { position: p.role, phone: p.phone, email: p.email }))!;
    person.set(p.id, id);
    if (/куратор/i.test(p.role ?? '')) await member(db, directionId, id, 'CURATOR');
    else if (/ввод данных/i.test(p.role ?? '')) await member(db, directionId, id, 'EDITOR', 'SITES');
  }
  const orgs = new Orgs(db, directionId);
  const org = new Map<string, number>();
  for (const o of d.orgs) org.set(o.id, (await orgs.get(o.name, 'CONTRACTOR', !!o.ex))!);

  const site = new Map<string, number>();
  for (const [i, o] of d.objects.entries()) {
    const r = await db.site.create({
      data: {
        directionId,
        sectionId: o.sectionId ? sec.get(o.sectionId) : undefined,
        code: o.id,
        num: i + 1,
        name: o.addr,
        shortName: o.addr,
        address: o.addr,
        note: text(o.note),
        sort: i * 10,
        isArchived: !!o.archived,
        isExample: !!o.ex?.length,
        attrs: attrs({ exampleFields: o.ex }),
      },
    });
    site.set(o.id, r.id);
    await assign(db, r.id, o.curatorId ? person.get(o.curatorId)! : null, 'CURATOR');
    await assign(db, r.id, o.entryId ? person.get(o.entryId)! : null, 'ENTRY');
  }

  const item = new Map<string, number>();
  for (const [i, it] of d.items.entries()) {
    const r = await db.workItem.create({
      data: {
        siteId: site.get(it.objId)!,
        workTypeId: wt.get(it.typeId)!,
        code: it.id,
        num: it.n ?? null,
        planCost: num(it.contract),
        planStart: day(it.start),
        planEnd: day(it.end),
        responsibleId: it.respId ? person.get(it.respId) : undefined,
        contractorId: it.orgId ? org.get(it.orgId) : undefined,
        note: text(it.note),
        sort: i,
        isArchived: !!it.archived,
        isExample: !!it.ex?.length,
        // inwork — сумма «в работе» для расчёта остатка, approx — прогноз КС-2
        attrs: attrs({ srcRow: it.srcRow, inwork: num(it.inwork), approx: num(it.approx), exampleFields: it.ex }),
      },
    });
    item.set(it.id, r.id);
  }

  // недели: прошлые закрыты куратором, последняя открыта для ввода
  const curator = person.get(d.people.find((p) => /куратор направления/i.test(p.role ?? ''))?.id ?? '') ?? null;
  const period = new Map<string, number>();
  for (const [i, w] of d.weeks.entries()) {
    const last = i === d.weeks.length - 1;
    const r = await db.reportingPeriod.create({
      data: {
        directionId,
        date: day(w)!,
        status: last ? 'OPEN' : 'CLOSED',
        closedById: last ? null : curator,
        closedAt: last ? null : moment(`${w}T18:00`),
      },
    });
    period.set(w, r.id);
  }

  const status = new Map(
    (await db.statusDef.findMany({ where: { directionId, entity: 'WORK_ITEM' } })).map((s) => [s.code, s.id]),
  );
  const rows: Prisma.ProgressEntryCreateManyInput[] = [];
  for (const [iid, weeks] of Object.entries(d.snaps)) {
    for (const [w, s] of Object.entries(weeks)) {
      const by = s.by ? person.get(s.by) ?? null : null;
      rows.push({
        workItemId: item.get(iid)!,
        periodId: period.get(w)!,
        statusId: status.get(s.st ?? 'plan') ?? null,
        pct: num(s.pct),
        ksAmount: num(s.ks),
        paidAmount: num(s.paid),
        source: 'MIGRATION',
        isExample: !!s.ex,
        enteredById: by,
        updatedById: by,
        enteredAt: moment(s.at),
      });
    }
  }
  await chunked(rows, 2000, (part) => db.progressEntry.createMany({ data: part }));

  for (const l of d.log ?? []) {
    await db.auditLog.create({
      data: { at: moment(l.t), action: 'IMPORT', entity: 'direction', entityId: String(directionId), directionId, comment: `${l.u}: ${l.a}. ${l.d}`.slice(0, 1000) },
    });
  }
  return { sections: sec.size, workTypes: wt.size, sites: site.size, workItems: item.size, periods: period.size, progress: rows.length };
}
