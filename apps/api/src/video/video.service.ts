import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createConnection } from 'node:net';
import type { CameraInput, RecorderInput, VideoAdmin, VideoCatalog, VideoCheck } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/request';
import { eligible, mediaResource, redactRecorder, SecretBox } from './video-domain';
import { NetworkPolicy } from './network-policy';
import { VideoSync } from './video-sync';
import { MediaClient } from './media-client';

const included = { recorder: { include: { site: true } } } satisfies Prisma.VideoCameraInclude;
type Camera = Prisma.VideoCameraGetPayload<{ include: typeof included }>;
const message = {
  READY: 'Изображение доступно. Прямой эфир.',
  NO_SIGNAL: 'Нет связи. Проверьте сеть, учётную запись просмотра и номер канала.',
  INCOMPATIBLE: 'Несовместимый формат. Настройте дополнительный поток камеры на обычный H.264. Основной поток записи менять не нужно.',
  DISABLED: 'Камера или регистратор отключены либо архивированы.',
  SYNC_ERROR: 'Подключение ещё не применено. Проверьте медиасервис и дождитесь повторной синхронизации.',
};
function cameraDto(c: Camera) {
  return { id: c.id, recorderId: c.recorderId, siteId: c.recorder.siteId, name: c.name, channel: c.channel, stream: c.stream as 0 | 1,
    sort: c.sort, enabled: c.enabled, isArchived: c.isArchived, version: c.version,
    available: eligible(c, c.recorder) && !c.recorder.site.isArchived, syncState: c.syncState, syncError: c.syncError,
    lastCheck: c.lastCheck, lastCheckAt: c.lastCheckAt?.toISOString() ?? null };
}
@Injectable()
export class VideoService {
  constructor(private readonly db: PrismaService, private readonly access: AccessService, private readonly audit: AuditService,
    private readonly sync: VideoSync, private readonly media: MediaClient) {}
  async catalog(user: AuthUser, admin = false): Promise<VideoAdmin | VideoCatalog> {
    const siteIds = await this.access.videoSiteIds(user, admin ? 'manage' : 'view');
    const [sites, cameras, recorders] = await Promise.all([
      this.db.site.findMany({ where: { id: { in: siteIds } }, include: { direction: { select: { name: true, code: true } } }, orderBy: { name: 'asc' } }),
      this.db.videoCamera.findMany({ where: { recorder: { siteId: { in: siteIds } }, ...(admin ? {} : { isArchived: false, recorder: { siteId: { in: siteIds }, isArchived: false } }) }, include: included, orderBy: [{ sort: 'asc' }, { id: 'asc' }] }),
      admin ? this.db.videoRecorder.findMany({ where: { siteId: { in: siteIds } }, include: { _count: { select: { cameras: true } } }, orderBy: { name: 'asc' } }) : [],
    ]);
    const result = { sites: sites.map(s => ({ id: s.id, name: s.shortName ?? s.name, directionId: s.directionId, directionName: s.direction.name, directionCode: s.direction.code })), cameras: cameras.map(cameraDto) };
    return admin ? { ...result, recorders: recorders.map(r => ({ ...redactRecorder(r), profile: 'DAHUA' as const, cameraCount: r._count.cameras,
      lastCheckAt: r.lastCheckAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })) } : result;
  }
  async saveRecorder(user: AuthUser, input: RecorderInput, id?: number) {
    const before = id ? await this.db.videoRecorder.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundException('Регистратор не найден');
    if (before) await this.access.assertVideo(user, before.siteId, 'manage');
    await this.access.assertVideo(user, input.siteId, 'manage');
    if (before?.isArchived) throw new BadRequestException('Сначала восстановите регистратор');
    if (!before && !input.password) throw new BadRequestException('Введите пароль учётной записи просмотра');
    if (before && input.version !== before.version) throw new ConflictException('Регистратор уже изменён. Обновите список.');
    await new NetworkPolicy().resolve(input.host, input.port);
    let passwordEncrypted: string | undefined;
    if (input.password) {
      try { passwordEncrypted = new SecretBox(process.env.VIDEO_ENCRYPTION_KEY ?? '').encrypt(input.password); }
      catch { throw new ServiceUnavailableException('На сервере не настроен ключ шифрования видеонаблюдения'); }
    }
    const { password: _password, version: _version, ...fields } = input;
    try {
      const row = await this.db.$transaction(async tx => {
        const data = { ...fields, ...(passwordEncrypted ? { passwordEncrypted } : {}), updatedById: user.id };
        const saved = before
          ? await tx.videoRecorder.update({ where: { id, version: input.version }, data: { ...data, version: { increment: 1 } } })
          : await tx.videoRecorder.create({ data: { ...data, passwordEncrypted: passwordEncrypted!, createdById: user.id } });
        await tx.videoCamera.updateMany({ where: { recorderId: saved.id }, data: { syncState: 'PENDING', syncError: null, lastCheck: null, lastCheckAt: null } });
        await this.audit.write({ userId: user.id, action: before ? 'UPDATE' : 'CREATE', entity: 'video_recorder', entityId: saved.id, siteId: saved.siteId,
          before: before ? redactRecorder(before) : null, after: redactRecorder(saved) }, tx);
        return saved;
      });
      void this.sync.run();
      return { id: row.id, version: row.version, syncState: 'PENDING' };
    } catch (e) { this.persistenceError(e); }
  }
  async saveCamera(user: AuthUser, input: CameraInput, id?: number) {
    const before = id ? await this.db.videoCamera.findUnique({ where: { id }, include: included }) : null;
    if (id && !before) throw new NotFoundException('Камера не найдена');
    if (before) await this.access.assertVideo(user, before.recorder.siteId, 'manage');
    const recorder = await this.db.videoRecorder.findUnique({ where: { id: input.recorderId } });
    if (!recorder) throw new NotFoundException('Регистратор не найден');
    await this.access.assertVideo(user, recorder.siteId, 'manage');
    if (recorder.isArchived || before?.isArchived) throw new BadRequestException('Сначала восстановите оборудование');
    if (before && input.version !== before.version) throw new ConflictException('Камера уже изменена. Обновите список.');
    const { version: _version, ...fields } = input;
    try {
      const row = await this.db.$transaction(async tx => {
        const data = { ...fields, activeChannel: input.channel, updatedById: user.id, syncState: 'PENDING', syncError: null, lastCheck: null, lastCheckAt: null };
        const saved = before ? await tx.videoCamera.update({ where: { id, version: input.version }, data: { ...data, version: { increment: 1 } } })
          : await tx.videoCamera.create({ data: { ...data, createdById: user.id } });
        const { recorder: _rec, ...safeBefore } = before ?? {};
        await this.audit.write({ userId: user.id, action: before ? 'UPDATE' : 'CREATE', entity: 'video_camera', entityId: saved.id, siteId: recorder.siteId, before: safeBefore, after: saved }, tx);
        return saved;
      });
      void this.sync.run();
      return { id: row.id, version: row.version, syncState: 'PENDING' };
    } catch (e) { this.persistenceError(e); }
  }
  async archive(user: AuthUser, kind: 'recorder' | 'camera', id: number, version: number, isArchived: boolean) {
    const camera = kind === 'camera' ? await this.db.videoCamera.findUnique({ where: { id }, include: included }) : null;
    const recorder = kind === 'recorder' ? await this.db.videoRecorder.findUnique({ where: { id } }) : camera?.recorder;
    if (!recorder || (kind === 'camera' && !camera)) throw new NotFoundException('Оборудование не найдено');
    await this.access.assertVideo(user, recorder.siteId, 'manage');
    const row = camera ?? recorder;
    if (row.version !== version) throw new ConflictException('Запись уже изменена. Обновите список.');
    try {
      await this.db.$transaction(async tx => {
        if (kind === 'camera') await tx.videoCamera.update({ where: { id, version }, data: { isArchived, activeChannel: isArchived ? null : camera!.channel, version: { increment: 1 }, updatedById: user.id, syncState: 'PENDING' } });
        else {
          await tx.videoRecorder.update({ where: { id, version }, data: { isArchived, version: { increment: 1 }, updatedById: user.id } });
          await tx.videoCamera.updateMany({ where: { recorderId: id }, data: { syncState: 'PENDING', syncError: null } });
        }
        await this.audit.write({ userId: user.id, action: 'UPDATE', entity: 'video_' + kind, entityId: id, siteId: recorder.siteId,
          before: { isArchived: row.isArchived }, after: { isArchived }, comment: isArchived ? 'Архивирование' : 'Восстановление' }, tx);
      });
      void this.sync.run();
      return { syncState: 'PENDING' };
    } catch (e) { this.persistenceError(e); }
  }
  private persistenceError(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Канал регистратора уже занят неархивной камерой. Выберите другой канал или архивируйте существующую запись.');
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new ConflictException('Запись уже изменена. Обновите список.');
    throw new ServiceUnavailableException('Не удалось сохранить оборудование. Повторите после обновления списка.');
  }
  async authorizeMedia(user: AuthUser, uri: string) {
    const resource = mediaResource(uri);
    if (!resource) throw new ForbiddenException('Недопустимый видеоресурс');
    const c = await this.db.videoCamera.findUnique({ where: { id: resource.cameraId }, include: included });
    if (!c) throw new ForbiddenException('Нет доступа');
    await this.access.assertVideo(user, c.recorder.siteId, 'view');
    if (!eligible(c, c.recorder) || c.recorder.site.isArchived) throw new ForbiddenException('Камера отключена');
    if (c.syncState !== 'SYNCED') throw new ForbiddenException('Подключение не синхронизировано');
  }
  async checkCamera(user: AuthUser, id: number): Promise<VideoCheck> {
    const c = await this.db.videoCamera.findUnique({ where: { id }, include: included });
    if (!c) throw new NotFoundException('Камера не найдена');
    await this.access.assertVideo(user, c.recorder.siteId, 'view');
    const checkedAt = new Date().toISOString();
    const result = (status: VideoCheck['status']): VideoCheck => ({ status, message: message[status], checkedAt });
    if (!eligible(c, c.recorder) || c.recorder.site.isArchived) return result('DISABLED');
    const lease = await this.db.videoCamera.updateMany({ where: { id, OR: [{ lastCheckAt: null }, { lastCheckAt: { lt: new Date(Date.now() - 30000) } }] }, data: { lastCheckAt: new Date() } });
    if (!lease.count) {
      const status = c.lastCheck as VideoCheck['status'] | null;
      return { ...result(status && status in message ? status : 'NO_SIGNAL'), checkedAt: c.lastCheckAt?.toISOString() ?? checkedAt };
    }
    let status: VideoCheck['status'] = 'NO_SIGNAL';
    try {
      await this.sync.run();
      const fresh = await this.db.videoCamera.findUniqueOrThrow({ where: { id } });
      if (fresh.syncState !== 'SYNCED') return result('SYNC_ERROR');
      const url = (process.env.VIDEO_HLS_URL ?? 'http://mediamtx:8888') + '/cam-' + id + '/index.m3u8';
      const response = await fetch(url, { headers: { Authorization: 'Bearer ' + (process.env.VIDEO_CDN_TOKEN ?? '') }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      await response.body?.cancel();
      if (response.ok) {
        const runtime = await this.media.runtime('cam-' + id);
        const tracks = runtime.tracks2?.map(t => t.codec) ?? runtime.tracks ?? [];
        status = tracks.some(t => /H265|HEVC/i.test(t)) || !tracks.some(t => /H264/i.test(t)) ? 'INCOMPATIBLE' : 'READY';
      }
    } catch { status = 'NO_SIGNAL'; }
    await this.db.videoCamera.update({ where: { id }, data: { lastCheck: status } });
    return result(status);
  }
  async checkRecorder(user: AuthUser, id: number) {
    const r = await this.db.videoRecorder.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Регистратор не найден');
    await this.access.assertVideo(user, r.siteId, 'manage');
    if (!r.enabled || r.isArchived) throw new BadRequestException('Регистратор отключён или архивирован');
    const lease = await this.db.videoRecorder.updateMany({ where: { id, OR: [{ lastCheckAt: null }, { lastCheckAt: { lt: new Date(Date.now() - 30000) } }] }, data: { lastCheckAt: new Date() } });
    if (!lease.count) return { status: r.lastCheck ?? 'CHECKING', message: 'Проверять регистратор можно раз в 30 секунд. Показан последний результат.' };
    const host = await new NetworkPolicy().resolve(r.host, r.port);
    const ok = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host, port: r.port });
      const finish = (v: boolean) => { socket.destroy(); resolve(v); };
      socket.setTimeout(3000, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    });
    await this.db.videoRecorder.update({ where: { id }, data: { lastCheck: ok ? 'PORT_OPEN' : 'NO_SIGNAL' } });
    return { status: ok ? 'PORT_OPEN' : 'NO_SIGNAL', message: ok ? 'RTSP-порт доступен. Проверка пароля и изображения выполняется отдельно для выбранной камеры.' : message.NO_SIGNAL };
  }
  async grants(userId: number) {
    return (await this.db.videoGrant.findMany({ where: { userId } })).map(g => ({ siteId: g.siteId, manage: g.canManage }));
  }
  async saveGrants(admin: AuthUser, userId: number, grants: { siteId: number; manage: boolean }[]) {
    const target = await this.db.user.findUnique({ where: { id: userId }, include: { memberships: true } });
    if (!target) throw new NotFoundException('Сотрудник не найден');
    const sites = await this.db.site.findMany({ where: { id: { in: grants.map(g => g.siteId) }, isArchived: false }, select: { id: true, directionId: true } });
    if (sites.length !== grants.length) throw new BadRequestException('Выберите действующие объекты');
    for (const grant of grants) {
      const site = sites.find(s => s.id === grant.siteId)!;
      const role = target.memberships.find(m => m.directionId === site.directionId)?.role;
      if (target.globalRole === 'USER' && (!role || (grant.manage && role !== 'CURATOR'))) throw new BadRequestException('Для просмотра нужна роль в направлении; управление доступно кураторам и руководству');
    }
    await this.db.$transaction(async tx => {
      const before = await tx.videoGrant.findMany({ where: { userId } });
      await tx.videoGrant.deleteMany({ where: { userId } });
      if (grants.length) await tx.videoGrant.createMany({ data: grants.map(g => ({ userId, siteId: g.siteId, canManage: g.manage })) });
      await this.audit.write({ userId: admin.id, action: 'UPDATE', entity: 'video_grant', entityId: userId, before, after: grants }, tx);
    });
    return { saved: true };
  }
}
