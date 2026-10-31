/**
 * Замечания по объектам с жизненным циклом и лентой событий.
 *
 * Кто что может:
 *   выставить замечание — куратор, администратор, руководство и все, кто вносит данные по объекту;
 *   исполнитель (вносит данные по объекту или назначен исполнителем) — взять в работу, отметить «устранено»;
 *   проверяющий (куратор, администратор, автор замечания) — принять, вернуть на доработку, снять, открыть снова,
 *   править текст, срок, важность и исполнителя, пока замечание не закрыто.
 * Ничего не удаляется: ошибочное замечание снимается с комментарием.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Remark, RemarkStatus } from '@prisma/client';
import {
  REMARK_ACTIVE,
  REMARK_SEVERITY_LABELS,
  REMARK_STATUS_LABELS,
  remarkSchema,
  type Attachment,
  type RemarkAction,
  type RemarkActionData,
  type RemarkCard,
  type RemarkData,
  type RemarkList,
  type RemarkRow,
} from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { toAttachment } from '../attachments/attachments.service';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const ATTACH_HOURS = 24;
const CATEGORIES = ['Качество работ', 'Охрана труда и ТБ', 'Документация', 'Уборка и складирование', 'Сроки'];

/** Переходы: из каких статусов, в какой, кто выполняет. */
const FLOW: Record<Exclude<RemarkAction, 'comment'>, { from: RemarkStatus[]; to: RemarkStatus; by: 'performer' | 'checker' }> = {
  start: { from: ['OPEN'], to: 'IN_PROGRESS', by: 'performer' },
  resolve: { from: ['OPEN', 'IN_PROGRESS'], to: 'RESOLVED', by: 'performer' },
  verify: { from: ['RESOLVED'], to: 'VERIFIED', by: 'checker' },
  return: { from: ['RESOLVED'], to: 'OPEN', by: 'checker' },
  reject: { from: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], to: 'REJECTED', by: 'checker' },
  reopen: { from: ['VERIFIED', 'REJECTED'], to: 'OPEN', by: 'checker' },
};

const include = {
  responsible: { select: { id: true, fullName: true } },
  site: { select: { id: true, name: true, shortName: true } },
  workItem: { select: { id: true, label: true, workType: { select: { name: true } } } },
  author: { select: { id: true, fullName: true } },
  assignee: { select: { id: true, fullName: true } },
} satisfies Prisma.RemarkInclude;
type RemarkFull = Prisma.RemarkGetPayload<{ include: typeof include }>;

@Injectable()
export class RemarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly kpi: KpiService,
  ) {}

  private async dir(user: AuthUser, code: string) {
    const d = await this.prisma.direction.findUnique({ where: { code } });
    if (!d) throw new NotFoundException('Направление не найдено');
    await this.access.assertViewDirection(user, d.id);
    this.access.assertSection(user, 'remarks');
    return d;
  }

  private async remark(directionId: number, id: number) {
    const r = await this.prisma.remark.findUnique({ where: { id }, include });
    if (!r || r.directionId !== directionId) throw new NotFoundException('Замечание не найдено');
    return r;
  }

  /** Может выставлять замечания: на все объекты направления (all) или на перечисленные. */
  private async creatable(user: AuthUser, directionId: number) {
    if (user.globalRole !== 'USER') return { all: true, ids: new Set<number>() };
    const e = await this.access.editableSites(user, directionId);
    return { all: e.all, ids: e.ids };
  }

  private async roles(user: AuthUser, r: Remark) {
    const manager = await this.access.canManageDirection(user, r.directionId);
    const checker = manager || r.authorId === user.id;
    const performer = manager || r.assigneeId === user.id || (await this.access.canEditSite(user, r.siteId));
    return { checker, performer };
  }

  private async actions(user: AuthUser, r: Remark): Promise<{ actions: RemarkAction[]; canEdit: boolean }> {
    const { checker, performer } = await this.roles(user, r);
    const actions = (Object.keys(FLOW) as (keyof typeof FLOW)[]).filter((a) => FLOW[a].from.includes(r.status) && (FLOW[a].by === 'checker' ? checker : performer));
    const all: RemarkAction[] = checker || performer ? [...actions, 'comment'] : actions;
    return { actions: all, canEdit: checker && !['VERIFIED', 'REJECTED'].includes(r.status) };
  }

  private row(r: RemarkFull, photos: number): RemarkRow {
    const overdue = REMARK_ACTIVE.includes(r.status) && r.dueDate != null && r.dueDate < today();
    return {
      sourceName: r.sourceName, sourceRef: r.sourceRef, detectedOn: day(r.detectedOn), typeName: r.typeName, location: r.location, responsible: r.responsible, violationGroup: r.violationGroup, violationType: r.violationType,
      id: r.id,
      num: r.num,
      site: { id: r.site.id, name: r.site.shortName ?? r.site.name },
      workItem: r.workItem ? { id: r.workItem.id, name: r.workItem.label ?? r.workItem.workType.name } : null,
      text: r.text,
      category: r.category,
      severity: r.severity,
      status: r.status,
      dueDate: day(r.dueDate),
      overdue,
      author: r.author,
      assignee: r.assignee,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      photos,
      isExample: r.isExample,
    };
  }

  /** Число файлов у замечаний (вложения висят на событиях ленты). */
  private async photoCounts(remarkIds: number[]) {
    if (!remarkIds.length) return new Map<number, number>();
    const events = await this.prisma.remarkEvent.findMany({ where: { remarkId: { in: remarkIds } }, select: { id: true, remarkId: true } });
    const byEvent = new Map(events.map((e) => [e.id, e.remarkId]));
    const files = await this.prisma.attachment.groupBy({
      by: ['entityId'],
      where: { entity: 'remark_event', entityId: { in: events.map((e) => e.id) }, isArchived: false },
      _count: true,
    });
    const out = new Map<number, number>();
    for (const f of files) {
      const rid = byEvent.get(f.entityId)!;
      out.set(rid, (out.get(rid) ?? 0) + f._count);
    }
    return out;
  }

  async list(user: AuthUser, code: string): Promise<RemarkList> {
    const d = await this.dir(user, code);
    const rows = await this.prisma.remark.findMany({ where: { directionId: d.id }, include, orderBy: { num: 'desc' } });
    const photos = await this.photoCounts(rows.map((r) => r.id));
    const can = await this.creatable(user, d.id);
    const sites = await this.prisma.site.findMany({
      where: { directionId: d.id, isArchived: false, ...(can.all ? {} : { id: { in: [...can.ids] } }) },
      select: { id: true, name: true, shortName: true },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    const people = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ memberships: { some: { directionId: d.id } } }, { siteAssignments: { some: { site: { directionId: d.id } } } }],
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    const used = rows.map((r) => r.category).filter((c): c is string => !!c);
    return {
      rows: rows.map((r) => this.row(r, photos.get(r.id) ?? 0)),
      canCreate: this.access.has(user, 'remarksCreate') && (can.all || can.ids.size > 0),
      sites: sites.map((s) => ({ id: s.id, name: s.shortName ?? s.name })),
      people,
      categories: [...new Set([...CATEGORIES, ...used])],
    };
  }

  async card(user: AuthUser, code: string, id: number): Promise<RemarkCard> {
    const d = await this.dir(user, code);
    const r = await this.remark(d.id, id);
    const events = await this.prisma.remarkEvent.findMany({ where: { remarkId: r.id }, orderBy: { id: 'asc' }, include: { author: { select: { fullName: true } } } });
    const files = await this.prisma.attachment.findMany({
      where: { entity: 'remark_event', entityId: { in: events.map((e) => e.id) }, isArchived: false },
      include: { uploadedBy: { select: { fullName: true } } },
      orderBy: { id: 'asc' },
    });
    const manager = await this.access.canManageDirection(user, d.id);
    const byEvent = new Map<number, Attachment[]>();
    for (const f of files) byEvent.set(f.entityId, [...(byEvent.get(f.entityId) ?? []), toAttachment(f, manager || f.uploadedById === user.id)]);
    const resolvedBy = r.resolvedById ? await this.prisma.user.findUnique({ where: { id: r.resolvedById }, select: { fullName: true } }) : null;
    const now = Date.now();
    return {
      ...this.row(r, files.length),
      version: r.version,
      resolvedBy: resolvedBy?.fullName ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind as RemarkCard['events'][number]['kind'],
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        text: e.text,
        author: e.author?.fullName ?? null,
        createdAt: e.createdAt.toISOString(),
        files: byEvent.get(e.id) ?? [],
        canAttach: e.authorId === user.id && now - e.createdAt.getTime() < ATTACH_HOURS * 3600_000,
      })),
      ...(await this.actions(user, r)),
    };
  }

  /** Проверка ссылок: позиция с того же объекта, исполнитель существует. */
  private checkClassification(b: RemarkData, previous?: Pick<Remark, 'sourceName' | 'violationGroup' | 'violationType'>) {
    const parsed = remarkSchema.safeParse({ ...b,
      sourceName: b.sourceName !== undefined ? b.sourceName : previous?.sourceName,
      violationGroup: b.violationGroup !== undefined ? b.violationGroup : previous?.violationGroup,
      violationType: b.violationType !== undefined ? b.violationType : previous?.violationType,
    });
    if (!parsed.success) throw new BadRequestException({ message: 'Проверьте поля нарушения', fields: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])) });
  }

  /** Проверка ссылок: позиция с того же объекта, исполнитель существует. */
  private async checkRefs(siteId: number, b: RemarkData) {
    if (b.responsibleId) {
      const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { directionId: true } });
      const person = await this.prisma.user.findFirst({ where: { id: b.responsibleId, isActive: true, OR: [{ memberships: { some: { directionId: site.directionId } } }, { siteAssignments: { some: { site: { directionId: site.directionId } } } }] }, select: { id: true } });
      if (!person) throw new BadRequestException({ message: 'Ответственный не назначен в направление', fields: { responsibleId: 'Выберите сотрудника направления' } });
    }
    if (b.workItemId) {
      const it = await this.prisma.workItem.findUnique({ where: { id: b.workItemId }, select: { siteId: true } });
      if (!it || it.siteId !== siteId) throw new BadRequestException({ message: 'Позиция не с этого объекта', fields: { workItemId: 'Не с этого объекта' } });
    }
    if (b.assigneeId) {
      const u = await this.prisma.user.findUnique({ where: { id: b.assigneeId }, select: { isActive: true } });
      if (!u?.isActive) throw new BadRequestException({ message: 'Исполнитель не найден', fields: { assigneeId: 'Не найден' } });
    }
  }

  private async names(b: { assigneeId?: number | null }) {
    const a = b.assigneeId ? await this.prisma.user.findUnique({ where: { id: b.assigneeId }, select: { fullName: true } }) : null;
    return a?.fullName ?? null;
  }

  async create(user: AuthUser, code: string, b: RemarkData, ip: string | null) {
    const d = await this.dir(user, code);
    this.access.assertFeature(user, 'remarksCreate');
    const site = await this.prisma.site.findUnique({ where: { id: b.siteId }, select: { id: true, directionId: true, isArchived: true } });
    if (!site || site.directionId !== d.id || site.isArchived) throw new BadRequestException({ message: 'Объект не найден', fields: { siteId: 'Не найден' } });
    const can = await this.creatable(user, d.id);
    if (!can.all && !can.ids.has(site.id)) throw new ForbiddenException('Нет прав выставлять замечания по этому объекту');
    await this.checkRefs(site.id, b);
    this.checkClassification(b);
    const assignee = await this.names(b);

    const res = await this.prisma.$transaction(async (tx) => {
      // номер в направлении — следующий после наибольшего. Строка направления блокируется до конца транзакции,
      // поэтому одновременные замечания получают номера по очереди
      await tx.$queryRaw`SELECT id FROM direction WHERE id = ${d.id} FOR UPDATE`;
      const max = await tx.remark.aggregate({ where: { directionId: d.id }, _max: { num: true } });
      const r = await tx.remark.create({
        data: {
          directionId: d.id,
          num: (max._max.num ?? 0) + 1,
          siteId: site.id,
          workItemId: b.workItemId ?? null,
          text: b.text,
          sourceName: b.sourceName || null, sourceRef: b.sourceRef || null, detectedOn: toDate(b.detectedOn), typeName: b.typeName || null, location: b.location || null, responsibleId: b.responsibleId ?? null,
          violationGroup: b.violationGroup ?? null, violationType: b.violationType ?? null,
          category: b.category ?? null,
          severity: b.severity,
          dueDate: toDate(b.dueDate),
          assigneeId: b.assigneeId ?? null,
          authorId: user.id,
        },
      });
      const ev = await tx.remarkEvent.create({ data: { remarkId: r.id, kind: 'CREATE', toStatus: 'OPEN', authorId: user.id } });
      await this.audit.write(
        {
          userId: user.id, action: 'CREATE', entity: 'remark', entityId: r.id, directionId: d.id, siteId: site.id, ip,
          comment: `замечание № ${r.num}`,
          after: { text: b.text, category: b.category, severity: REMARK_SEVERITY_LABELS[b.severity], dueDate: b.dueDate, assignee, sourceName: b.sourceName, sourceRef: b.sourceRef, detectedOn: b.detectedOn, typeName: b.typeName, location: b.location, responsibleId: b.responsibleId, violationGroup: b.violationGroup, violationType: b.violationType },
        },
        tx,
      );
      return { id: r.id, num: r.num, eventId: ev.id };
    });
    this.kpi.invalidate(d.id);
    return res;
  }

  async update(user: AuthUser, code: string, id: number, b: RemarkData, ip: string | null) {
    const d = await this.dir(user, code);
    const r = await this.remark(d.id, id);
    if (!(await this.actions(user, r)).canEdit) throw new ForbiddenException('Править замечание может автор или куратор, пока оно не закрыто');
    if (b.siteId !== r.siteId) throw new BadRequestException({ message: 'Объект замечания не меняется', fields: { siteId: 'Не меняется' } });
    await this.checkRefs(r.siteId, b);
    this.checkClassification(b, r);
    const n = await this.prisma.remark.updateMany({
      where: { id, version: b.version ?? r.version },
      data: {
        workItemId: b.workItemId ?? null,
        text: b.text,
        sourceName: b.sourceName !== undefined ? b.sourceName || null : r.sourceName,
        sourceRef: b.sourceRef !== undefined ? b.sourceRef || null : r.sourceRef,
        detectedOn: b.detectedOn !== undefined ? toDate(b.detectedOn) : r.detectedOn,
        typeName: b.typeName !== undefined ? b.typeName || null : r.typeName,
        location: b.location !== undefined ? b.location || null : r.location,
        responsibleId: b.responsibleId !== undefined ? b.responsibleId : r.responsibleId,
        violationGroup: b.violationGroup !== undefined ? b.violationGroup : r.violationGroup,
        violationType: b.violationType !== undefined ? b.violationType : r.violationType,
        category: b.category ?? null,
        severity: b.severity,
        dueDate: toDate(b.dueDate),
        assigneeId: b.assigneeId ?? null,
        version: { increment: 1 },
      },
    });
    if (!n.count) throw new ConflictException('Замечание уже изменил другой пользователь — обновите карточку');
    const itemName = (w: { label: string | null; workType: { name: string } } | null) => (w ? (w.label ?? w.workType.name) : null);
    const item = b.workItemId ? await this.prisma.workItem.findUnique({ where: { id: b.workItemId }, select: { label: true, workType: { select: { name: true } } } }) : null;
    const before = { text: r.text, category: r.category, severity: REMARK_SEVERITY_LABELS[r.severity], dueDate: day(r.dueDate), assignee: r.assignee?.fullName ?? null, workItem: itemName(r.workItem), sourceName:r.sourceName,sourceRef:r.sourceRef,detectedOn:day(r.detectedOn),typeName:r.typeName,location:r.location,responsibleId:r.responsibleId,violationGroup:r.violationGroup,violationType:r.violationType };
    const after = { text: b.text, category: b.category ?? null, severity: REMARK_SEVERITY_LABELS[b.severity], dueDate: b.dueDate ?? null, assignee: await this.names(b), workItem: itemName(item), sourceName:b.sourceName!==undefined?b.sourceName||null:r.sourceName,sourceRef:b.sourceRef!==undefined?b.sourceRef||null:r.sourceRef,detectedOn:b.detectedOn!==undefined?b.detectedOn||null:day(r.detectedOn),typeName:b.typeName!==undefined?b.typeName||null:r.typeName,location:b.location!==undefined?b.location||null:r.location,responsibleId:b.responsibleId!==undefined?b.responsibleId:r.responsibleId,violationGroup:b.violationGroup!==undefined?b.violationGroup:r.violationGroup,violationType:b.violationType!==undefined?b.violationType:r.violationType };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => (before[k] ?? null) !== (after[k] ?? null));
    if (changed.length) {
      const what: Record<string, string> = { text: 'текст', category: 'категория', severity: 'важность', dueDate: 'срок', assignee: 'исполнитель', workItem: 'позиция', sourceName:'источник',sourceRef:'документ',detectedOn:'дата выявления',typeName:'тип',location:'место',responsibleId:'ответственный',violationGroup:'группа ЦККБ',violationType:'тип ЦККБ' };
      await this.prisma.remarkEvent.create({ data: { remarkId: id, kind: 'EDIT', authorId: user.id, text: `Изменено: ${changed.map((k) => what[k]).join(', ')}` } });
      await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'remark', entityId: id, directionId: d.id, siteId: r.siteId, ip, comment: `замечание № ${r.num}`, before, after });
    }
    this.kpi.invalidate(d.id);
    return { ok: true };
  }

  async act(user: AuthUser, code: string, id: number, b: RemarkActionData, ip: string | null) {
    const d = await this.dir(user, code);
    const r = await this.remark(d.id, id);
    if (r.status !== b.fromStatus) throw new ConflictException(`Замечание уже изменили: сейчас «${REMARK_STATUS_LABELS[r.status]}». Обновите карточку`);
    const { actions } = await this.actions(user, r);
    if (!actions.includes(b.action)) throw new ForbiddenException('Это действие вам недоступно');

    const eventId = await this.prisma.$transaction(async (tx) => {
      if (b.action === 'comment') {
        const ev = await tx.remarkEvent.create({ data: { remarkId: id, kind: 'COMMENT', text: b.text ?? null, authorId: user.id } });
        await tx.remark.update({ where: { id }, data: { updatedAt: new Date() } });
        return ev.id;
      }
      const f = FLOW[b.action];
      const closing = f.to === 'VERIFIED' || f.to === 'REJECTED';
      const n = await tx.remark.updateMany({
        where: { id, status: r.status },
        data: {
          status: f.to,
          version: { increment: 1 },
          ...(closing ? { resolvedById: user.id, resolvedAt: new Date() } : f.to === 'OPEN' ? { resolvedById: null, resolvedAt: null } : {}),
        },
      });
      if (!n.count) throw new ConflictException('Замечание уже изменили — обновите карточку');
      const ev = await tx.remarkEvent.create({ data: { remarkId: id, kind: 'STATUS', fromStatus: r.status, toStatus: f.to, text: b.text || null, authorId: user.id } });
      await this.audit.write(
        {
          userId: user.id, action: 'UPDATE', entity: 'remark', entityId: id, directionId: d.id, siteId: r.siteId, ip,
          comment: `замечание № ${r.num}${b.text ? `: ${b.text.slice(0, 200)}` : ''}`,
          before: { remarkStatus: REMARK_STATUS_LABELS[r.status] },
          after: { remarkStatus: REMARK_STATUS_LABELS[f.to] },
        },
        tx,
      );
      return ev.id;
    });
    this.kpi.invalidate(d.id);
    return { eventId };
  }
}
