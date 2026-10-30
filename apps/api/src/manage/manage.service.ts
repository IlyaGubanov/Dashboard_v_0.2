/**
 * Управление направлением: объекты, позиции, ответственные на объектах, справочники (разделы, виды работ, организации),
 * ввод надстроек (закупки, испытания, МГЭ, документация).
 *
 * Права: структуру (объекты, позиции, справочники, назначения) меняют куратор направления и администратор;
 * надстройки по объекту вносят все, кто может вносить данные по этому объекту.
 * Ничего не удаляется насовсем, если на это есть ссылки: объекты и позиции — в архив, справочники — в архив.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, type FieldDef, type AssignmentRole } from '@prisma/client';
import type { ManageRefs, SiteData, SiteEdit, TrackerSaveData, WorkItemData } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';

const num = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : s === null ? null : undefined);
/** Код новой записи: короткий, уникальный, не зависит от названия. */
const newCode = (prefix: string) => `${prefix}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

@Injectable()
export class ManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  private async dir(user: AuthUser, code: string, manage = true) {
    const d = await this.prisma.direction.findUnique({ where: { code } });
    if (!d) throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    if (manage) await this.access.assertManageDirection(user, d.id);
    return d;
  }

  private async site(directionId: number, siteId: number) {
    const s = await this.prisma.site.findUnique({ where: { id: siteId } });
    if (!s || s.directionId !== directionId) throw new NotFoundException('Объект не найден');
    return s;
  }

  /** Ссылка на запись этого же направления (раздел, организация, вид работ). */
  private async own(model: 'section' | 'organization' | 'workType', directionId: number, id: number | null | undefined, label: string) {
    if (id == null) return;
    const row = await (this.prisma[model] as unknown as { findUnique: (a: object) => Promise<{ directionId: number } | null> }).findUnique({ where: { id } });
    if (!row || row.directionId !== directionId) throw new BadRequestException({ message: `${label}: не из этого направления`, fields: { [label]: 'Неверное значение' } });
  }

  /** Проверка доп. полей по их описанию; возвращает очищенные значения. */
  private checkAttrs(defs: FieldDef[], attrs: Record<string, unknown> | undefined, prev: Record<string, unknown>) {
    if (!attrs) return prev;
    const out: Record<string, unknown> = { ...prev };
    const errors: Record<string, string> = {};
    for (const f of defs) {
      if (!(f.code in attrs)) continue;
      const v = attrs[f.code];
      const err = (m: string) => (errors[`attrs.${f.code}`] = m);
      if (v === null || v === '' || v === undefined) {
        if (f.required) err('Обязательное поле');
        delete out[f.code];
        continue;
      }
      const opts = ((f.options ?? []) as { value: string }[]).map((o) => o.value);
      switch (f.type) {
        case 'NUMBER':
        case 'MONEY':
        case 'PERCENT':
          if (typeof v !== 'number' || !Number.isFinite(v)) err('Нужно число');
          else if (f.type === 'PERCENT' && (v < 0 || v > 100)) err('От 0 до 100');
          else out[f.code] = v;
          break;
        case 'BOOL':
          if (typeof v !== 'boolean') err('Да или нет');
          else out[f.code] = v;
          break;
        case 'DATE':
          if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) err('Дата ГГГГ-ММ-ДД');
          else out[f.code] = v;
          break;
        case 'SELECT':
          if (typeof v !== 'string' || (opts.length && !opts.includes(v))) err('Выберите из списка');
          else out[f.code] = v;
          break;
        case 'MULTISELECT':
          if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || (opts.length && !opts.includes(x)))) err('Выберите из списка');
          else out[f.code] = v;
          break;
        case 'URL':
          if (typeof v !== 'string' || !/^https?:\/\/\S+$/.test(v)) err('Ссылка вида https://…');
          else out[f.code] = v;
          break;
        case 'USER':
        case 'ORGANIZATION':
          if (!Number.isInteger(v)) err('Выберите из списка');
          else out[f.code] = v;
          break;
        default:
          if (typeof v !== 'string' || v.length > 5000) err('Текст до 5000 символов');
          else out[f.code] = v.trim();
      }
    }
    for (const k of Object.keys(attrs)) if (!defs.some((f) => f.code === k)) errors[`attrs.${k}`] = 'Такого поля нет в направлении';
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Проверьте доп. поля', fields: errors });
    return out;
  }

  async refs(user: AuthUser, code: string): Promise<ManageRefs> {
    const d = await this.dir(user, code, false);
    const canManage = await this.access.canManageDirection(user, d.id);
    const [sections, types, orgs, statuses, fields, users, sites] = await Promise.all([
      this.prisma.section.findMany({ where: { directionId: d.id }, orderBy: { sort: 'asc' }, include: { _count: { select: { sites: { where: { isArchived: false } } } } } }),
      this.prisma.workType.findMany({ where: { directionId: d.id }, orderBy: { sort: 'asc' }, include: { group: true, _count: { select: { workItems: { where: { isArchived: false } } } } } }),
      this.prisma.organization.findMany({
        where: { directionId: d.id },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { sitesContractor: true, sitesDesigner: true } } },
      }),
      this.prisma.statusDef.findMany({ where: { directionId: d.id }, orderBy: { sort: 'asc' } }),
      this.prisma.fieldDef.findMany({ where: { directionId: d.id, entity: 'SITE', isArchived: false }, orderBy: { sort: 'asc' } }),
      this.prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, position: true, canLogin: true } }),
      this.prisma.site.findMany({
        where: { directionId: d.id },
        orderBy: [{ isArchived: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
        include: {
          section: { select: { name: true } },
          _count: { select: { workItems: { where: { isArchived: false } } } },
          assignments: { where: { role: 'CURATOR' }, include: { user: { select: { fullName: true } } } },
        },
      }),
    ]);
    return {
      canManage,
      sections: sections.map((s) => ({ id: s.id, name: s.name, note: s.note, isArchived: s.isArchived, sites: s._count.sites })),
      workTypes: types.map((t) => ({
        id: t.id, name: t.name, group: t.group?.name ?? null, unit: t.unit, weight: num(t.weight),
        planStart: day(t.planStart), planEnd: day(t.planEnd), isArchived: t.isArchived, items: t._count.workItems,
      })),
      organizations: orgs.map((o) => ({ id: o.id, name: o.name, kind: o.kind, inn: o.inn, note: o.note, sites: o._count.sitesContractor + o._count.sitesDesigner })),
      statuses: statuses.map((s) => ({ code: s.code, name: s.name, entity: s.entity })),
      fields: fields.map((f) => ({
        code: f.code, label: f.label, type: f.type, unit: f.unit, group: f.groupName, required: f.required,
        options: (f.options ?? null) as { value: string; label: string }[] | null,
      })),
      users,
      sites: sites.map((s) => ({
        id: s.id, name: s.shortName ?? s.name, section: s.section?.name ?? null, isArchived: s.isArchived, items: s._count.workItems,
        curators: s.assignments.map((a) => a.user.fullName),
      })),
    };
  }

  async getSite(user: AuthUser, code: string, siteId: number): Promise<SiteEdit> {
    const d = await this.dir(user, code);
    await this.site(d.id, siteId);
    const s = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: {
        status: true,
        assignments: { include: { user: { select: { fullName: true } } } },
        workItems: { orderBy: [{ isArchived: 'asc' }, { sort: 'asc' }, { id: 'asc' }], include: { _count: { select: { progress: true } } } },
      },
    });
    return {
      id: s.id, code: s.code, version: s.version, isArchived: s.isArchived, name: s.name, shortName: s.shortName, address: s.address,
      okrug: s.okrug, district: s.district, sectionId: s.sectionId, statusCode: s.status?.code ?? null,
      planStart: day(s.planStart), planEnd: day(s.planEnd), contractorId: s.contractorId, designerId: s.designerId,
      limitAmount: num(s.limitAmount), lat: num(s.lat), lon: num(s.lon), note: s.note,
      attrs: Object.fromEntries(Object.entries((s.attrs ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'exampleFields')),
      assignments: s.assignments.map((a) => ({ userId: a.userId, role: a.role, fullName: a.user.fullName })),
      items: s.workItems.map((w) => ({
        id: w.id, workTypeId: w.workTypeId, label: w.label, unit: w.unit, planQty: num(w.planQty), planCost: num(w.planCost),
        planStart: day(w.planStart), planEnd: day(w.planEnd), responsibleId: w.responsibleId, contractorId: w.contractorId,
        note: w.note, isArchived: w.isArchived, hasProgress: w._count.progress > 0,
      })),
    };
  }

  private async siteData(d: { id: number }, body: SiteData, prevAttrs: Record<string, unknown>) {
    await this.own('section', d.id, body.sectionId, 'sectionId');
    await this.own('organization', d.id, body.contractorId, 'contractorId');
    await this.own('organization', d.id, body.designerId, 'designerId');
    let statusId: number | null | undefined = undefined;
    if (body.statusCode !== undefined) {
      if (body.statusCode === null) statusId = null;
      else {
        const st = await this.prisma.statusDef.findFirst({ where: { directionId: d.id, entity: 'SITE', code: body.statusCode } });
        if (!st) throw new BadRequestException({ message: 'Неизвестный статус', fields: { statusCode: 'Неизвестный статус' } });
        statusId = st.id;
      }
    }
    const defs = await this.prisma.fieldDef.findMany({ where: { directionId: d.id, entity: 'SITE', isArchived: false } });
    const attrs = this.checkAttrs(defs, body.attrs, prevAttrs);
    return {
      name: body.name,
      shortName: body.shortName ?? null,
      address: body.address ?? null,
      okrug: body.okrug ?? null,
      district: body.district ?? null,
      sectionId: body.sectionId ?? null,
      ...(statusId !== undefined ? { statusId } : {}),
      planStart: toDate(body.planStart) ?? null,
      planEnd: toDate(body.planEnd) ?? null,
      contractorId: body.contractorId ?? null,
      designerId: body.designerId ?? null,
      limitAmount: body.limitAmount ?? null,
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      note: body.note ?? null,
      attrs: Object.keys(attrs).length ? (attrs as Prisma.InputJsonValue) : Prisma.DbNull,
    };
  }

  async createSite(user: AuthUser, code: string, body: SiteData, ip: string | null) {
    const d = await this.dir(user, code);
    const data = await this.siteData(d, body, {});
    const max = await this.prisma.site.aggregate({ where: { directionId: d.id }, _max: { num: true, sort: true } });
    const s = await this.prisma.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: { ...data, directionId: d.id, code: newCode('s'), num: (max._max.num ?? 0) + 1, sort: (max._max.sort ?? 0) + 10, createdById: user.id, updatedById: user.id },
      });
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'site', entityId: created.id, directionId: d.id, siteId: created.id, after: data, comment: `новый объект «${created.name}»`, ip }, tx);
      return created;
    });
    this.kpi.invalidate(d.id);
    return { id: s.id };
  }

  async updateSite(user: AuthUser, code: string, siteId: number, body: SiteData, ip: string | null) {
    const d = await this.dir(user, code);
    const prev = await this.site(d.id, siteId);
    if (body.version == null) throw new BadRequestException('Не передана версия объекта');
    const data = await this.siteData(d, body, (prev.attrs ?? {}) as Record<string, unknown>);
    await this.prisma.$transaction(async (tx) => {
      // обновится, только если версию никто не поменял
      const r = await tx.site.updateMany({ where: { id: siteId, version: body.version }, data: { ...data, version: { increment: 1 }, updatedById: user.id } });
      if (!r.count) throw new ConflictException('Объект изменил другой пользователь. Откройте его заново и повторите правку.');
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'site', entityId: siteId, directionId: d.id, siteId, before: prev, after: data, comment: `объект «${data.name}»`, ip }, tx);
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async archiveSite(user: AuthUser, code: string, siteId: number, archived: boolean, ip: string | null) {
    const d = await this.dir(user, code);
    const s = await this.site(d.id, siteId);
    await this.prisma.$transaction(async (tx) => {
      await tx.site.update({ where: { id: siteId }, data: { isArchived: archived, version: { increment: 1 }, updatedById: user.id } });
      await this.audit.write(
        { userId: user.id, action: archived ? 'DELETE' : 'UPDATE', entity: 'site', entityId: siteId, directionId: d.id, siteId, comment: `${archived ? 'в архив' : 'из архива'}: «${s.name}»`, ip },
        tx,
      );
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async setAssignments(user: AuthUser, code: string, siteId: number, items: { userId: number; role: AssignmentRole }[], ip: string | null) {
    const d = await this.dir(user, code);
    await this.site(d.id, siteId);
    const key = (a: { userId: number; role: string }) => `${a.userId}|${a.role}`;
    if (new Set(items.map(key)).size !== items.length) throw new BadRequestException('Повтор: один человек в одной роли дважды');
    const users = await this.prisma.user.count({ where: { id: { in: items.map((a) => a.userId) }, isActive: true } });
    if (users !== new Set(items.map((a) => a.userId)).size) throw new BadRequestException('Пользователь не найден или заблокирован');
    const before = await this.prisma.siteAssignment.findMany({ where: { siteId }, select: { userId: true, role: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.siteAssignment.deleteMany({ where: { siteId } });
      if (items.length) await tx.siteAssignment.createMany({ data: items.map((a) => ({ siteId, userId: a.userId, role: a.role })) });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'site_assignment', entityId: siteId, directionId: d.id, siteId, before: { assignments: before }, after: { assignments: items }, comment: 'ответственные по объекту', ip }, tx);
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  private async itemData(directionId: number, body: WorkItemData) {
    await this.own('workType', directionId, body.workTypeId, 'workTypeId');
    await this.own('organization', directionId, body.contractorId, 'contractorId');
    if (body.responsibleId && !(await this.prisma.user.findFirst({ where: { id: body.responsibleId, isActive: true } }))) {
      throw new BadRequestException({ message: 'Ответственный не найден', fields: { responsibleId: 'Не найден' } });
    }
    return {
      workTypeId: body.workTypeId,
      label: body.label ?? null,
      unit: body.unit ?? null,
      planQty: body.planQty ?? null,
      planCost: body.planCost ?? null,
      planStart: toDate(body.planStart) ?? null,
      planEnd: toDate(body.planEnd) ?? null,
      responsibleId: body.responsibleId ?? null,
      contractorId: body.contractorId ?? null,
      note: body.note ?? null,
    };
  }

  async createItem(user: AuthUser, code: string, siteId: number, body: WorkItemData, ip: string | null) {
    const d = await this.dir(user, code);
    const s = await this.site(d.id, siteId);
    const data = await this.itemData(d.id, body);
    const max = await this.prisma.workItem.aggregate({ where: { siteId }, _max: { sort: true } });
    const it = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workItem.create({ data: { ...data, siteId, code: newCode('i'), sort: (max._max.sort ?? 0) + 1 } });
      await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'work_item', entityId: created.id, directionId: d.id, siteId, after: data, comment: `новая позиция на «${s.shortName ?? s.name}»`, ip }, tx);
      return created;
    });
    this.kpi.invalidate(d.id);
    return { id: it.id };
  }

  async updateItem(user: AuthUser, code: string, itemId: number, body: WorkItemData, ip: string | null) {
    const d = await this.dir(user, code);
    const prev = await this.prisma.workItem.findUnique({ where: { id: itemId }, include: { site: true } });
    if (!prev || prev.site.directionId !== d.id) throw new NotFoundException('Позиция не найдена');
    const data = await this.itemData(d.id, body);
    await this.prisma.$transaction(async (tx) => {
      await tx.workItem.update({ where: { id: itemId }, data });
      const { site: _s, ...before } = prev;
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'work_item', entityId: itemId, directionId: d.id, siteId: prev.siteId, before, after: data, comment: 'позиция работ', ip }, tx);
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async archiveItem(user: AuthUser, code: string, itemId: number, archived: boolean, ip: string | null) {
    const d = await this.dir(user, code);
    const it = await this.prisma.workItem.findUnique({ where: { id: itemId }, include: { site: true, _count: { select: { progress: true } } } });
    if (!it || it.site.directionId !== d.id) throw new NotFoundException('Позиция не найдена');
    await this.prisma.$transaction(async (tx) => {
      // позицию без факта, созданную по ошибке, удаляем; с фактом — только в архив (история сохраняется)
      if (archived && it._count.progress === 0 && !it.isExample) await tx.workItem.delete({ where: { id: itemId } });
      else await tx.workItem.update({ where: { id: itemId }, data: { isArchived: archived } });
      await this.audit.write({ userId: user.id, action: archived ? 'DELETE' : 'UPDATE', entity: 'work_item', entityId: itemId, directionId: d.id, siteId: it.siteId, comment: archived ? 'позиция убрана' : 'позиция возвращена', ip }, tx);
    });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- справочники

  async saveSection(user: AuthUser, code: string, id: number | null, body: { name: string; note?: string | null; sort?: number }, ip: string | null) {
    const d = await this.dir(user, code);
    if (id) await this.own('section', d.id, id, 'section');
    try {
      const row = id
        ? await this.prisma.section.update({ where: { id }, data: { name: body.name, note: body.note ?? null, ...(body.sort != null ? { sort: body.sort } : {}) } })
        : await this.prisma.section.create({ data: { directionId: d.id, code: newCode('sec'), name: body.name, note: body.note ?? null, sort: body.sort ?? 1000 } });
      await this.audit.write({ userId: user.id, action: id ? 'UPDATE' : 'CREATE', entity: 'section', entityId: row.id, directionId: d.id, after: body, comment: `раздел «${body.name}»`, ip });
      this.kpi.invalidate(d.id);
      return { id: row.id };
    } catch (e) {
      throw this.unique(e, 'Такой раздел уже есть');
    }
  }

  async archiveSection(user: AuthUser, code: string, id: number, archived: boolean, ip: string | null) {
    const d = await this.dir(user, code);
    await this.own('section', d.id, id, 'section');
    await this.prisma.section.update({ where: { id }, data: { isArchived: archived } });
    await this.audit.write({ userId: user.id, action: archived ? 'DELETE' : 'UPDATE', entity: 'section', entityId: id, directionId: d.id, comment: archived ? 'раздел в архив' : 'раздел из архива', ip });
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async saveWorkType(
    user: AuthUser,
    code: string,
    id: number | null,
    body: { name: string; group?: string | null; unit?: string | null; weight?: number | null; planStart?: string | null; planEnd?: string | null; sort?: number },
    ip: string | null,
  ) {
    const d = await this.dir(user, code);
    if (id) await this.own('workType', d.id, id, 'workType');
    const groupId = body.group
      ? (await this.prisma.workGroup.upsert({ where: { directionId_name: { directionId: d.id, name: body.group } }, create: { directionId: d.id, name: body.group, sort: 1000 }, update: {} })).id
      : null;
    const data = {
      name: body.name, groupId, unit: body.unit ?? null, weight: body.weight ?? null,
      planStart: toDate(body.planStart) ?? null, planEnd: toDate(body.planEnd) ?? null, ...(body.sort != null ? { sort: body.sort } : {}),
    };
    const row = id
      ? await this.prisma.workType.update({ where: { id }, data })
      : await this.prisma.workType.create({ data: { ...data, directionId: d.id, code: newCode('w'), sort: body.sort ?? 1000 } });
    await this.audit.write({ userId: user.id, action: id ? 'UPDATE' : 'CREATE', entity: 'work_type', entityId: row.id, directionId: d.id, after: body, comment: `вид работ «${body.name}»`, ip });
    this.kpi.invalidate(d.id);
    return { id: row.id };
  }

  async archiveWorkType(user: AuthUser, code: string, id: number, archived: boolean, ip: string | null) {
    const d = await this.dir(user, code);
    await this.own('workType', d.id, id, 'workType');
    await this.prisma.workType.update({ where: { id }, data: { isArchived: archived } });
    await this.audit.write({ userId: user.id, action: archived ? 'DELETE' : 'UPDATE', entity: 'work_type', entityId: id, directionId: d.id, comment: archived ? 'вид работ в архив' : 'вид работ из архива', ip });
    return { ok: true };
  }

  async saveOrganization(
    user: AuthUser,
    code: string,
    id: number | null,
    body: { name: string; kind: Prisma.OrganizationCreateInput['kind']; inn?: string | null; note?: string | null },
    ip: string | null,
  ) {
    const d = await this.dir(user, code);
    if (id) await this.own('organization', d.id, id, 'organization');
    try {
      const data = { name: body.name, kind: body.kind, inn: body.inn ?? null, note: body.note ?? null };
      const row = id
        ? await this.prisma.organization.update({ where: { id }, data })
        : await this.prisma.organization.create({ data: { ...data, directionId: d.id } });
      this.kpi.invalidate(d.id);
      await this.audit.write({ userId: user.id, action: id ? 'UPDATE' : 'CREATE', entity: 'organization', entityId: row.id, directionId: d.id, after: data, comment: `организация «${body.name}»`, ip });
      return { id: row.id };
    } catch (e) {
      throw this.unique(e, 'Такая организация с этой ролью уже есть');
    }
  }

  private unique(e: unknown, message: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return new ConflictException({ message, fields: { name: message } });
    return e;
  }

  // ---------------------------------------------------------------- надстройки

  /** Внести строки надстройки по объекту (закупки, испытания, МГЭ, документация). */
  async saveTracker(user: AuthUser, code: string, siteId: number, trackerCode: string, body: TrackerSaveData, ip: string | null) {
    const d = await this.dir(user, code, false);
    if (d.isReadonly) throw new ForbiddenException('Данные направления приходят отчётами');
    await this.site(d.id, siteId);
    await this.access.assertEditSite(user, siteId);
    const t = await this.prisma.tracker.findUnique({
      where: { directionId_code: { directionId: d.id, code: trackerCode } },
      include: { stages: true, items: true },
    });
    if (!t) throw new NotFoundException('Надстройка не найдена');
    const stage = new Map(t.stages.map((s) => [s.code, s]));
    const item = new Map(t.items.map((i) => [i.code, i]));

    // проверка значений по типу этапа
    const errors: Record<string, string> = {};
    for (const [i, r] of body.rows.entries()) {
      if (!item.has(r.itemCode)) errors[`rows.${i}.itemCode`] = 'Нет такой строки';
      for (const [k, v] of Object.entries(r.values)) {
        const s = stage.get(k);
        const key = `rows.${i}.values.${k}`;
        if (!s) errors[key] = 'Нет такого этапа';
        else if (v == null || v === '') continue;
        else if (s.valueType === 'PERCENT' && (typeof v !== 'number' || v < 0 || v > 100)) errors[key] = 'От 0 до 100';
        else if (s.valueType === 'NUMBER' && typeof v !== 'number') errors[key] = 'Нужно число';
        else if (s.valueType === 'BOOL' && typeof v !== 'boolean') errors[key] = 'Да или нет';
        else if (s.valueType === 'DATE' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) errors[key] = 'Дата ГГГГ-ММ-ДД';
        else if (s.valueType === 'STATUS' && !((s.options ?? []) as { value: string }[]).some((o) => o.value === v)) errors[key] = 'Выберите из списка';
      }
    }
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Проверьте значения', fields: errors });

    let changed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of body.rows) {
        const it = item.get(r.itemCode)!;
        const row = await tx.trackerRow.upsert({
          where: { siteId_itemId: { siteId, itemId: it.id } },
          create: { siteId, itemId: it.id, qty: r.qty ?? null, unit: r.unit ?? null, planDate: toDate(r.planDate) ?? null, dueDate: toDate(r.dueDate) ?? null },
          update: {
            ...(r.qty !== undefined ? { qty: r.qty } : {}),
            ...(r.unit !== undefined ? { unit: r.unit } : {}),
            ...(r.planDate !== undefined ? { planDate: toDate(r.planDate) } : {}),
            ...(r.dueDate !== undefined ? { dueDate: toDate(r.dueDate) } : {}),
            isExample: false,
          },
          include: { values: true },
        });
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r.values)) {
          const s = stage.get(k)!;
          const old = row.values.find((x) => x.stageId === s.id);
          const oldV = old ? (old.valueText ?? (old.valueNum != null ? Number(old.valueNum) : (old.valueBool ?? day(old.valueDate)))) : null;
          const newV = v === '' ? null : v;
          if (oldV === newV) continue;
          before[k] = oldV;
          after[k] = newV;
          const data = {
            valueNum: typeof newV === 'number' ? newV : null,
            valueText: typeof newV === 'string' && s.valueType !== 'DATE' ? newV : null,
            valueBool: typeof newV === 'boolean' ? newV : null,
            valueDate: s.valueType === 'DATE' && typeof newV === 'string' ? toDate(newV)! : null,
            updatedById: user.id,
          };
          await tx.trackerValue.upsert({ where: { rowId_stageId: { rowId: row.id, stageId: s.id } }, create: { rowId: row.id, stageId: s.id, ...data }, update: data });
        }
        if (Object.keys(after).length) {
          changed++;
          await this.audit.write(
            { userId: user.id, action: 'UPDATE', entity: 'tracker_row', entityId: row.id, directionId: d.id, siteId, before, after, comment: `${t.name} · ${it.name}`, ip },
            tx,
          );
        }
      }
    });
    this.kpi.invalidate(d.id);
    return { changed };
  }
}
