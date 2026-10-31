/**
 * Конструктор направлений (только администратор): создать направление (с нуля или по образцу), настроить формулу,
 * период, деньги, пороги; статусы; доп. поля; надстройки; набор показателей сводки; пороги сводки.
 *
 * Правило сохранности данных: то, на что уже есть ссылки (статус у записей факта, этап с внесёнными значениями),
 * удалить нельзя — сервер отвечает 409 и объясняет, что мешает. Доп. поля и строки надстроек уходят в архив.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { DirectionData, DirectionDef, fieldsSchema, kpisSchema, OverviewTileConfig, statusesSchema, trackerDefSchema } from '@mvs/shared';
import { METRIC_CATALOG } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';

type Statuses = z.output<typeof statusesSchema>;
type Fields = z.output<typeof fieldsSchema>;
type TrackerDef = z.output<typeof trackerDefSchema>;
type Kpis = z.output<typeof kpisSchema>;
type Settings = { factLabel?: string | null; kpis?: Kpis; [k: string]: unknown };

const json = (v: unknown) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

@Injectable()
export class DirectionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly kpi: KpiService,
  ) {}

  private async byCode(code: string) {
    if (code === 'reb') throw new NotFoundException('РЭБ управляется в самостоятельном разделе');
    const d = await this.prisma.direction.findUnique({ where: { code } });
    if (!d) throw new NotFoundException('Направление не найдено');
    return d;
  }

  private async log(user: AuthUser, directionId: number, entity: string, comment: string, before?: unknown, after?: unknown, ip?: string | null) {
    await this.audit.write({ userId: user.id, action: 'UPDATE', entity, entityId: directionId, directionId, comment, before, after, ip });
  }

  async list() {
    const rows = await this.prisma.direction.findMany({ where: {code: {not: 'reb'}},
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { sites: { where: { isArchived: false } }, members: true, trackers: true, fieldDefs: { where: { isArchived: false } } } } },
    });
    return rows.map((d) => ({
      code: d.code, name: d.name, shortName: d.shortName, icon: d.icon, color: d.color, isActive: d.isActive, isReadonly: d.isReadonly,
      periodKind: d.periodKind, progressMethod: d.progressMethod, sites: d._count.sites, members: d._count.members,
      trackers: d._count.trackers, fields: d._count.fieldDefs,
    }));
  }

  async get(code: string): Promise<DirectionDef> {
    const d = await this.prisma.direction.findUniqueOrThrow({
      where: { code },
      include: {
        statusDefs: { orderBy: { sort: 'asc' }, include: { _count: { select: { progressItems: true, sites: true } } } },
        fieldDefs: { orderBy: [{ isArchived: 'asc' }, { sort: 'asc' }] },
        trackers: {
          orderBy: { sort: 'asc' },
          include: { stages: { orderBy: { sort: 'asc' } }, items: { orderBy: [{ isArchived: 'asc' }, { sort: 'asc' }], include: { _count: { select: { rows: true } } } } },
        },
        _count: { select: { sites: { where: { isArchived: false } }, periods: true, members: true } },
      },
    }).catch(() => {
      throw new NotFoundException('Направление не найдено');
    });
    const s = (d.settings ?? {}) as Settings;
    const units = await this.prisma.workItem.findMany({ where: { site: { directionId: d.id }, unit: { not: null } }, distinct: ['unit'], select: { unit: true } });
    return {
      id: d.id, code: d.code, name: d.name, shortName: d.shortName, description: d.description,
      icon: (d.icon ?? 'folder') as DirectionDef['icon'], color: d.color ?? '#2f6fd6', sort: d.sort, isActive: d.isActive, isReadonly: d.isReadonly,
      periodKind: d.periodKind, planWeekday: d.planWeekday, progressMethod: d.progressMethod, planMethod: d.planMethod,
      moneySource: d.moneySource, moneyLabel: d.moneyLabel, thrWarn: Number(d.thrWarn), thrCrit: Number(d.thrCrit), siteUnit: d.siteUnit,
      factLabel: s.factLabel ?? null,
      counts: { sites: d._count.sites, periods: d._count.periods, members: d._count.members },
      statuses: d.statusDefs.map((x) => ({
        entity: x.entity, code: x.code, name: x.name, shortName: x.shortName, color: x.color, countsAsDone: x.countsAsDone,
        excludeFromCalc: x.excludeFromCalc, isFinal: x.isFinal, used: x._count.progressItems + x._count.sites,
      })),
      fields: d.fieldDefs.map((f) => ({
        entity: f.entity, code: f.code, label: f.label, type: f.type, options: f.options as DirectionDef['fields'][number]['options'], unit: f.unit,
        required: f.required, groupName: f.groupName, hint: f.hint, showInList: f.showInList, isArchived: f.isArchived,
      })),
      trackers: d.trackers.map((t) => ({
        code: t.code, name: t.name, layout: t.layout, description: t.description, isActive: t.isActive,
        rows: t.items.reduce((a, i) => a + i._count.rows, 0),
        stages: t.stages.map((st) => ({ code: st.code, name: st.name, valueType: st.valueType, options: st.options as DirectionDef['trackers'][number]['stages'][number]['options'], inProgress: st.inProgress })),
        items: t.items.map((i) => ({ code: i.code, name: i.name, category: i.category, unit: i.unit, isArchived: i.isArchived })),
      })),
      kpis: (s.kpis ?? []) as DirectionDef['kpis'],
      overviewTiles: (s.overviewTiles ?? []) as DirectionDef['overviewTiles'],
      units: units.map((u) => u.unit!).sort(),
    };
  }

  private columns(b: DirectionData) {
    return {
      name: b.name, shortName: b.shortName, description: b.description ?? null, icon: b.icon, color: b.color, sort: b.sort,
      isActive: b.isActive, isReadonly: b.isReadonly, periodKind: b.periodKind, planWeekday: b.planWeekday,
      progressMethod: b.progressMethod, planMethod: b.planMethod, moneySource: b.moneySource, moneyLabel: b.moneyLabel ?? null,
      thrWarn: b.thrWarn, thrCrit: b.thrCrit, siteUnit: b.siteUnit,
    };
  }

  async create(user: AuthUser, b: DirectionData, ip: string | null) {
    if(b.code==='reb')throw new BadRequestException('РЭБ — самостоятельный раздел');
    if (await this.prisma.direction.findUnique({ where: { code: b.code } })) {
      throw new ConflictException({ message: 'Направление с таким кодом уже есть', fields: { code: 'Код занят' } });
    }
    const src = b.copyFrom
      ? await this.prisma.direction.findUnique({
          where: { code: b.copyFrom },
          include: {
            statusDefs: true,
            fieldDefs: { where: { isArchived: false } },
            trackers: { include: { stages: true, items: { where: { isArchived: false } } } },
            workGroups: true,
            workTypes: { where: { isArchived: false } },
          },
        })
      : null;
    if (b.copyFrom && !src) throw new BadRequestException({ message: 'Образец не найден', fields: { copyFrom: 'Не найден' } });
    const srcSettings = (src?.settings ?? {}) as Settings;

    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.direction.create({
        data: { code: b.code, ...this.columns(b), settings: { factLabel: b.factLabel ?? null, kpis: (srcSettings.kpis ?? []) as Prisma.InputJsonValue } },
      });
      if (src) {
        // по образцу копируется устройство направления, но не объекты, факт и люди
        for (const s of src.statusDefs) {
          const { id: _i, directionId: _d, ...rest } = s;
          await tx.statusDef.create({ data: { ...rest, directionId: created.id } });
        }
        for (const f of src.fieldDefs) {
          const { id: _i, directionId: _d, options, ...rest } = f;
          await tx.fieldDef.create({ data: { ...rest, options: json(options), directionId: created.id } });
        }
        const groups = new Map<number, number>();
        for (const g of src.workGroups) groups.set(g.id, (await tx.workGroup.create({ data: { directionId: created.id, name: g.name, sort: g.sort } })).id);
        for (const w of src.workTypes) {
          const { id: _i, directionId: _d, groupId, ...rest } = w;
          await tx.workType.create({ data: { ...rest, directionId: created.id, groupId: groupId ? groups.get(groupId) : null } });
        }
        for (const t of src.trackers) {
          await tx.tracker.create({
            data: {
              directionId: created.id, code: t.code, name: t.name, layout: t.layout, description: t.description, sort: t.sort, isActive: t.isActive,
              stages: { create: t.stages.map(({ id: _i, trackerId: _t, options, ...st }) => ({ ...st, options: json(options) })) },
              items: { create: t.items.map(({ id: _i, trackerId: _t, attrs, ...it }) => ({ ...it, attrs: json(attrs) })) },
            },
          });
        }
      } else {
        // с нуля — минимальный набор статусов позиций, чтобы сразу можно было вносить факт
        await tx.statusDef.createMany({
          data: [
            { directionId: created.id, entity: 'WORK_ITEM', code: 'plan', name: 'Не начато', color: '#9aa4b2', sort: 1 },
            { directionId: created.id, entity: 'WORK_ITEM', code: 'work', name: 'В работе', color: '#2f6fd6', sort: 2 },
            { directionId: created.id, entity: 'WORK_ITEM', code: 'done', name: 'Выполнено', color: '#0f9d76', countsAsDone: true, isFinal: true, sort: 3 },
          ],
        });
      }
      await this.audit.write(
        { userId: user.id, action: 'CREATE', entity: 'direction', entityId: created.id, directionId: created.id, after: b, comment: `новое направление «${b.name}»${src ? ` по образцу «${src.name}»` : ''}`, ip },
        tx,
      );
      return created;
    });
    return { code: d.code };
  }

  async update(user: AuthUser, code: string, b: DirectionData, ip: string | null) {
    const d = await this.byCode(code);
    const s = (d.settings ?? {}) as Settings;
    await this.prisma.direction.update({
      where: { id: d.id },
      data: { ...this.columns(b), settings: { ...s, factLabel: b.factLabel ?? null } as Prisma.InputJsonValue },
    });
    await this.log(user, d.id, 'direction', `настройки направления «${b.name}»`, d, b, ip);
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  /** Статусы: правка по коду; удалить можно только неиспользуемый. */
  async saveStatuses(user: AuthUser, code: string, b: Statuses, ip: string | null) {
    const d = await this.byCode(code);
    const codes = b.items.map((i) => i.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('Коды статусов повторяются');
    const existing = await this.prisma.statusDef.findMany({
      where: { directionId: d.id, entity: b.entity },
      include: { _count: { select: { progressItems: true, sites: true } } },
    });
    const removed = existing.filter((e) => !codes.includes(e.code));
    const busy = removed.filter((e) => e._count.progressItems + e._count.sites > 0);
    if (busy.length) {
      throw new ConflictException(`Нельзя удалить статусы, которые уже используются: ${busy.map((x) => `«${x.name}» (${x._count.progressItems + x._count.sites})`).join(', ')}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.statusDef.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      for (const [i, s] of b.items.entries()) {
        const data = { ...s, sort: (i + 1) * 10 };
        await tx.statusDef.upsert({
          where: { directionId_entity_code: { directionId: d.id, entity: b.entity, code: s.code } },
          create: { directionId: d.id, entity: b.entity, ...data },
          update: data,
        });
      }
    });
    await this.log(user, d.id, 'status_def', `статусы (${b.entity === 'SITE' ? 'объекта' : 'позиции'})`, existing.map((e) => e.code), codes, ip);
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  /** Доп. поля: правка по коду; убранные — в архив (значения в объектах сохраняются). */
  async saveFields(user: AuthUser, code: string, b: Fields, ip: string | null) {
    const d = await this.byCode(code);
    const codes = b.items.map((i) => i.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('Коды полей повторяются');
    await this.prisma.$transaction(async (tx) => {
      await tx.fieldDef.updateMany({ where: { directionId: d.id, entity: b.entity, code: { notIn: codes } }, data: { isArchived: true } });
      for (const [i, f] of b.items.entries()) {
        const data = { ...f, options: json(f.options), sort: (i + 1) * 10, isArchived: false };
        await tx.fieldDef.upsert({
          where: { directionId_entity_code: { directionId: d.id, entity: b.entity, code: f.code } },
          create: { directionId: d.id, entity: b.entity, ...data },
          update: data,
        });
      }
    });
    await this.log(user, d.id, 'field_def', 'доп. поля', undefined, codes, ip);
    return { ok: true };
  }

  /** Надстройка: создать или изменить. Этап с внесёнными значениями удалить нельзя; строки — в архив. */
  async saveTracker(user: AuthUser, code: string, trackerCode: string, b: TrackerDef, ip: string | null) {
    const d = await this.byCode(code);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(trackerCode)) throw new BadRequestException('Неверный код надстройки');
    const stageCodes = b.stages.map((s) => s.code);
    const itemCodes = b.items.map((s) => s.code);
    if (new Set(stageCodes).size !== stageCodes.length || new Set(itemCodes).size !== itemCodes.length) throw new BadRequestException('Коды этапов или строк повторяются');
    const t = await this.prisma.tracker.findUnique({
      where: { directionId_code: { directionId: d.id, code: trackerCode } },
      include: { stages: { include: { _count: { select: { values: true } } } } },
    });
    const removedStages = t?.stages.filter((s) => !stageCodes.includes(s.code)) ?? [];
    const busy = removedStages.filter((s) => s._count.values > 0);
    if (busy.length) throw new ConflictException(`Нельзя удалить этапы с внесёнными значениями: ${busy.map((s) => `«${s.name}»`).join(', ')}`);

    await this.prisma.$transaction(async (tx) => {
      const tracker = t
        ? await tx.tracker.update({ where: { id: t.id }, data: { name: b.name, layout: b.layout, description: b.description ?? null, isActive: b.isActive } })
        : await tx.tracker.create({
            data: { directionId: d.id, code: trackerCode, name: b.name, layout: b.layout, description: b.description ?? null, isActive: b.isActive, sort: 1000 },
          });
      await tx.trackerStage.deleteMany({ where: { id: { in: removedStages.map((s) => s.id) } } });
      for (const [i, s] of b.stages.entries()) {
        const data = { name: s.name, valueType: s.valueType, options: json(s.options), inProgress: s.inProgress, sort: (i + 1) * 10 };
        await tx.trackerStage.upsert({
          where: { trackerId_code: { trackerId: tracker.id, code: s.code } },
          create: { trackerId: tracker.id, code: s.code, ...data },
          update: data,
        });
      }
      await tx.trackerItem.updateMany({ where: { trackerId: tracker.id, code: { notIn: itemCodes } }, data: { isArchived: true } });
      for (const [i, it] of b.items.entries()) {
        const data = { name: it.name, category: it.category ?? null, unit: it.unit ?? null, sort: (i + 1) * 10, isArchived: false };
        await tx.trackerItem.upsert({
          where: { trackerId_code: { trackerId: tracker.id, code: it.code } },
          create: { trackerId: tracker.id, code: it.code, ...data },
          update: data,
        });
      }
    });
    await this.log(user, d.id, 'tracker', `надстройка «${b.name}»`, undefined, { stages: stageCodes, items: itemCodes.length }, ip);
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  /** Набор доп. показателей сводки; параметры проверяются по справочникам направления. */
  async saveKpis(user: AuthUser, code: string, items: Kpis, ip: string | null) {
    const d = await this.byCode(code);
    const [statuses, trackers] = await Promise.all([
      this.prisma.statusDef.findMany({ where: { directionId: d.id }, select: { code: true } }),
      this.prisma.tracker.findMany({ where: { directionId: d.id }, include: { stages: { select: { code: true } } } }),
    ]);
    const errors: Record<string, string> = {};
    items.forEach((k, i) => {
      const spec = METRIC_CATALOG.find((m) => m.key === k.metric)!;
      for (const p of spec.params) {
        const v = k.params?.[p.name];
        const key = `${i}.params.${p.name}`;
        if (v == null || (Array.isArray(v) && !v.length) || v === '') {
          errors[key] = `Укажите «${p.label}»`;
          continue;
        }
        if (p.kind === 'statusCodes' && (!Array.isArray(v) || v.some((c) => !statuses.some((s) => s.code === c)))) errors[key] = 'Неизвестный статус';
        if (p.kind === 'tracker' && !trackers.some((t) => t.code === v)) errors[key] = 'Нет такой надстройки';
        if (p.kind === 'stage') {
          const t = trackers.find((x) => x.code === k.params?.tracker);
          if (!t?.stages.some((s) => s.code === v)) errors[key] = 'Нет такого этапа';
        }
      }
    });
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Проверьте параметры показателей', fields: errors });
    const s = (d.settings ?? {}) as Settings;
    await this.prisma.direction.update({ where: { id: d.id }, data: { settings: { ...s, kpis: items } as Prisma.InputJsonValue } });
    await this.log(user, d.id, 'direction', 'показатели сводки', s.kpis, items, ip);
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async saveTiles(user: AuthUser, code: string, tiles: OverviewTileConfig[], ip: string | null) {
    const d = await this.byCode(code);
    const s = (d.settings ?? {}) as Settings;
    await this.prisma.direction.update({ where: { id: d.id }, data: { settings: { ...s, overviewTiles: tiles } as unknown as Prisma.InputJsonValue } });
    await this.log(user, d.id, 'direction', 'плитки обзора', s.overviewTiles, tiles, ip);
    return { ok: true };
  }

  async getOverviewThresholds() {
    const s = await this.prisma.appSetting.findUnique({ where: { key: 'overview.thresholds' } });
    return (s?.value ?? { warn: -2, crit: -10 }) as { warn: number; crit: number };
  }

  async setOverviewThresholds(user: AuthUser, t: { warn: number; crit: number }, ip: string | null) {
    const before = await this.getOverviewThresholds();
    await this.prisma.appSetting.upsert({ where: { key: 'overview.thresholds' }, create: { key: 'overview.thresholds', value: t }, update: { value: t } });
    await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'app_setting', entityId: 'overview.thresholds', before, after: t, ip });
    for (const d of await this.prisma.direction.findMany({ select: { id: true } })) this.kpi.invalidate(d.id);
    return { ok: true };
  }
}
