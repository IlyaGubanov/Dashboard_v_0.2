/**
 * «Мои задачи»: напоминания, которые собираются из текущих данных при каждом запросе.
 *
 *   Ответственный за ввод (и куратор) — объекты без факта в открытой отчётной точке;
 *   исполнитель — незакрытые замечания по его объектам или назначенные ему;
 *   проверяющий (автор замечания, куратор) — замечания «устранено», ждущие проверки;
 *   куратор — открыть точку текущей недели, проверить и закрыть прошлые точки;
 *   «Экономика» — назначенные разборы отклонений, ответственным ПЭО — отклонения без разбора.
 * Администратор и руководство получают задачи только как авторы замечаний: общую картину они видят в сводке.
 */
import { Injectable } from '@nestjs/common';
import type { Direction, MemberRole } from '@prisma/client';
import type { MyTask, MyTasks } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { EconomicsDeviationsService } from '../economics/economics-deviations.service';
import type { AuthUser } from '../common/request';

const DAY = 86_400_000;
const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('.');
/** Сегодня (UTC-полночь календарного дня сервера) и понедельник текущей недели. */
function today() {
  const n = new Date();
  const t = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return { t, monday: t - ((new Date(t).getUTCDay() + 6) % 7) * DAY };
}
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly econ: EconomicsDeviationsService,
  ) {}

  async forUser(user: AuthUser): Promise<MyTasks> {
    const members = await this.prisma.directionMember.findMany({ where: { userId: user.id, direction: { isActive: true } }, include: { direction: true } });
    const items: MyTask[] = [];
    for (const m of members) {
      if (m.role === 'VIEWER') continue;
      items.push(...(await this.entryTasks(user, m.direction, m.role)));
      if (m.role === 'CURATOR') items.push(...(await this.curatorTasks(m.direction)));
    }
    // замечания скрыты у сотрудника — и задачи по ним не показываем
    if (!user.hiddenSections.includes('remarks')) items.push(...(await this.remarkTasks(user, members.map((m) => ({ d: m.direction, role: m.role })))));
    // экономика: разборы отклонений на сотруднике, ответственным ПЭО — отклонения без разбора
    items.push(...(await this.econ.tasks(user)));
    const order = { critical: 0, warning: 1, info: 2 };
    items.sort((a, b) => order[a.level] - order[b.level] || a.direction.shortName.localeCompare(b.direction.shortName, 'ru'));
    return { items, badge: items.filter((i) => i.level !== 'info').length };
  }

  private dirRef(d: Direction) {
    return { code: d.code, shortName: d.shortName };
  }

  /** Объекты без факта в последней открытой отчётной точке. */
  private async entryTasks(user: AuthUser, d: Direction, role: MemberRole): Promise<MyTask[]> {
    if (d.isReadonly || d.periodKind === 'REPORT') return [];
    const p = await this.prisma.reportingPeriod.findFirst({ where: { directionId: d.id, status: 'OPEN', program: '' }, orderBy: { date: 'desc' } });
    if (!p) return [];
    const ed = await this.access.editableSites(user, d.id);
    const sites = await this.prisma.site.findMany({
      where: { directionId: d.id, isArchived: false, workItems: { some: { isArchived: false } }, ...(ed.all ? {} : { id: { in: [...ed.ids] } }) },
      select: { id: true, workItems: { where: { isArchived: false }, select: { progress: { where: { periodId: p.id }, select: { id: true }, take: 1 } } } },
    });
    const empty = sites.filter((s) => !s.workItems.some((i) => i.progress.length)).length;
    if (!empty) return [];
    const { t } = today();
    // день плана недели — срок внесения; через 2 дня после него — просрочено
    const due = d.periodKind === 'WEEK' ? p.date.getTime() + (d.planWeekday - 1) * DAY : p.date.getTime();
    const level = t > due + 2 * DAY ? 'critical' : t >= due ? 'warning' : 'info';
    const label = d.periodKind === 'WEEK' ? `неделю с ${fmt(p.date)}` : fmt(p.date);
    return [
      {
        key: `entry:${d.code}:${p.id}`,
        kind: 'entry',
        direction: this.dirRef(d),
        title: `Внести факт за ${label}`,
        detail: `${role === 'CURATOR' ? 'по направлению не внесено' : 'не внесено'}: ${empty} ${plural(empty, 'объект', 'объекта', 'объектов')} из ${sites.length}`,
        count: empty,
        level,
        tab: 'entry',
      },
    ];
  }

  /** Куратор: открыть точку текущей недели, проверить и закрыть прошлые. */
  private async curatorTasks(d: Direction): Promise<MyTask[]> {
    if (d.isReadonly || d.periodKind !== 'WEEK') return [];
    const out: MyTask[] = [];
    const { monday } = today();
    const current = await this.prisma.reportingPeriod.findFirst({ where: { directionId: d.id, program: '', date: new Date(monday) } });
    if (!current) {
      out.push({
        key: `open:${d.code}:${monday}`,
        kind: 'openPeriod',
        direction: this.dirRef(d),
        title: `Открыть неделю с ${fmt(new Date(monday))}`,
        detail: 'без открытой недели ответственные не смогут внести факт',
        count: 1,
        level: 'warning',
        tab: 'entry',
      });
    }
    const stale = await this.prisma.reportingPeriod.findMany({ where: { directionId: d.id, program: '', status: 'OPEN', date: { lt: new Date(monday) } }, orderBy: { date: 'asc' } });
    if (stale.length) {
      out.push({
        key: `close:${d.code}:${stale.map((s) => s.id).join(',')}`,
        kind: 'closePeriod',
        direction: this.dirRef(d),
        title: `Проверить и закрыть ${stale.length === 1 ? `неделю с ${fmt(stale[0].date)}` : `${stale.length} ${plural(stale.length, 'прошлую неделю', 'прошлые недели', 'прошлых недель')}`}`,
        detail: 'закрытая неделя — данные проверены куратором, в сводке без пометки',
        count: stale.length,
        level: 'info',
        tab: 'entry',
      });
    }
    return out;
  }

  /** Замечания: устранить (исполнителю) и проверить (автору и куратору). */
  private async remarkTasks(user: AuthUser, dirs: { d: Direction; role: MemberRole }[]): Promise<MyTask[]> {
    const out: MyTask[] = [];
    const t = new Date(today().t);
    const seen = new Set<number>();
    for (const { d, role } of dirs) {
      seen.add(d.id);
      if (role === 'VIEWER') continue;
      // устранить: назначенные мне или без исполнителя на моих объектах
      const ed = await this.access.editableSites(user, d.id);
      const mine = role !== 'CURATOR';
      const fix = await this.prisma.remark.findMany({
        where: {
          directionId: d.id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          OR: [{ assigneeId: user.id }, ...(mine ? [{ assigneeId: null, siteId: { in: ed.all ? undefined : [...ed.ids] } }] : [])],
        },
        select: { dueDate: true },
      });
      if (fix.length) {
        const overdue = fix.filter((r) => r.dueDate && r.dueDate < t).length;
        out.push({
          key: `fix:${d.code}`,
          kind: 'remarksFix',
          direction: this.dirRef(d),
          title: `Устранить ${plural(fix.length, 'замечание', 'замечания', 'замечаний')}: ${fix.length}`,
          detail: overdue ? `из них просрочено: ${overdue}` : null,
          count: fix.length,
          level: overdue ? 'critical' : 'warning',
          tab: 'remarks',
          view: 'mine',
        });
      }
      out.push(...(await this.checkTask(user, d, role === 'CURATOR')));
    }
    // автор замечаний в направлениях, где он не участник (администратор, руководство)
    const authored = await this.prisma.remark.findMany({ where: { authorId: user.id, status: 'RESOLVED', directionId: { notIn: [...seen] } }, distinct: ['directionId'], select: { direction: true } });
    for (const a of authored) out.push(...(await this.checkTask(user, a.direction, false)));
    return out;
  }

  private async checkTask(user: AuthUser, d: Direction, curator: boolean): Promise<MyTask[]> {
    const n = await this.prisma.remark.count({ where: { directionId: d.id, status: 'RESOLVED', ...(curator ? {} : { authorId: user.id }) } });
    if (!n) return [];
    return [
      {
        key: `check:${d.code}`,
        kind: 'remarksCheck',
        direction: this.dirRef(d),
        title: `Проверить устранение: ${n} ${plural(n, 'замечание', 'замечания', 'замечаний')}`,
        detail: curator ? 'исполнители отметили «устранено»' : 'по выставленным вами замечаниям',
        count: n,
        level: 'warning',
        tab: 'remarks',
        view: 'check',
      },
    ];
  }
}
