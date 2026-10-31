import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { VideoService } from './video.service';
import { VideoSync } from './video-sync';
import { MediaClient } from './media-client';
import { recorderSchema, cameraSchema } from '@mvs/shared';
import type { AuthUser } from '../common/request';
const testUrl = process.env.VIDEO_TEST_DATABASE_URL;
if (testUrl && !/\/video_unit(?:\?.*)?$/.test(testUrl)) throw new Error('Интеграционные тесты требуют отдельную базу video_unit без QA-камер');
describe.skipIf(!testUrl)('видео: real MySQL and HTTP media contract', () => {
  const db = new PrismaService({ datasourceUrl: testUrl });
  const sources = new Map<string, string>();
  const generations = new Map<string, number>();
  let unavailable = false;
  const server = createServer(async (req, res) => {
    if (unavailable) { res.writeHead(503).end(); return; }
    const url = new URL(req.url!, 'http://localhost'), name = url.pathname.split('/').at(-1)!;
    if (url.pathname === '/v3/config/paths/list') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ items: [...sources].map(([name]) => ({ name, source: 'rtsp://***:***@redacted' })), pageCount: 1 })); return; }
    if (url.pathname.includes('/config/paths/') && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      sources.set(name, JSON.parse(body).source); generations.set(name, (generations.get(name) ?? 0) + 1); res.end('{}'); return;
    }
    if (url.pathname.includes('/config/paths/delete/') && req.method === 'DELETE') { sources.delete(name); res.end('{}'); return; }
    res.writeHead(405).end();
  });
  let service: VideoService, sync: VideoSync, admin: AuthUser, reader: AuthUser, siteId: number, otherSite: number, directionId: number, recorderId: number, cameraId: number;
  const prefix = 'video-spec-' + Date.now();
  beforeAll(async () => {
    process.env.VIDEO_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    process.env.VIDEO_SERVICE_TOKEN = 's'.repeat(48);
    process.env.VIDEO_ALLOWED_NETWORKS = '10.20.0.0/16';
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.VIDEO_MEDIAMTX_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const direction = await db.direction.create({ data: { code: prefix.slice(0, 32), name: prefix, shortName: 'Тест', periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } });
    directionId = direction.id;
    siteId = (await db.site.create({ data: { directionId, code: 'one', name: 'Школа А' } })).id;
    otherSite = (await db.site.create({ data: { directionId, code: 'two', name: 'Школа Б' } })).id;
    const a = await db.user.create({ data: { fullName: prefix + '-admin', globalRole: 'ADMIN' } });
    const u = await db.user.create({ data: { fullName: prefix + '-reader' } });
    admin = { id: a.id, globalRole: 'ADMIN', hiddenSections: [], deniedFeatures: [] } as unknown as AuthUser;
    reader = { id: u.id, globalRole: 'USER', hiddenSections: [], deniedFeatures: [] } as unknown as AuthUser;
    await db.directionMember.create({ data: { userId: u.id, directionId, role: 'EDITOR', scope: 'ALL' } });
    const access = new AccessService(db), media = new MediaClient();
    sync = new VideoSync(db, media);
    service = new VideoService(db, access, new AuditService(db), sync, media);
  });
  afterAll(async () => {
    await sync?.run();
    await db.auditLog.deleteMany({ where: { userId: { in: [admin?.id, reader?.id].filter(Boolean) } } });
    await db.videoCamera.deleteMany({ where: { recorder: { siteId: { in: [siteId, otherSite].filter(Boolean) } } } });
    await db.videoRecorder.deleteMany({ where: { siteId: { in: [siteId, otherSite].filter(Boolean) } } });
    await db.direction.delete({ where: { id: directionId } });
    await db.user.deleteMany({ where: { id: { in: [admin?.id, reader?.id].filter(Boolean) } } });
    await db.$disconnect();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it('denies existing employees by default and isolates object grants for view and management', async () => {
    expect((await service.catalog(reader)).sites).toEqual([]);
    await service.saveGrants(admin, reader.id, [{ siteId, manage: false }]);
    expect((await service.catalog(reader)).sites.map(s => s.id)).toEqual([siteId]);
    expect((await service.catalog(reader, true)).sites).toEqual([]);
    await expect(service.saveRecorder(reader, recorderSchema.parse({ siteId, name: 'R', host: '10.20.1.1', username: 'v', password: 'secret' }))).rejects.toThrow();
    await expect(service.saveGrants(admin, reader.id, [{ siteId, manage: true }])).rejects.toThrow();
  });
  it('creates a camera with encrypted credentials, never serializes them, and protects all HLS files', async () => {
    const r = await service.saveRecorder(admin, recorderSchema.parse({ siteId, name: 'R', host: '10.20.1.1', username: 'v@', password: 'SECRET-plain' }));
    recorderId = r!.id;
    const c = await service.saveCamera(admin, cameraSchema.parse({ recorderId, name: 'Вход', channel: 4 }));
    cameraId = c!.id;
    await sync.run(); await sync.run();
    const catalog = await service.catalog(admin, true);
    expect(JSON.stringify(catalog)).not.toMatch(/SECRET|passwordEncrypted|rtsp:\/\//);
    const audits = await db.auditLog.findMany({ where: { entity: { in: ['video_recorder', 'video_camera'] }, userId: admin.id } });
    expect(JSON.stringify(audits, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toMatch(/SECRET|passwordEncrypted|rtsp:\/\//);
    await expect(service.authorizeMedia(reader, '/media/cam-' + cameraId + '/index.m3u8')).resolves.toBeUndefined();
    await expect(service.authorizeMedia(reader, '/media/cam-' + cameraId + '/seg12.mp4')).resolves.toBeUndefined();
    const other = await service.saveRecorder(admin, recorderSchema.parse({ siteId: otherSite, name: 'R2', host: '10.20.1.2', username: 'v', password: 'other' }));
    const otherCamera = await service.saveCamera(admin, cameraSchema.parse({ recorderId: other!.id, name: 'Закрытая', channel: 1 }));
    await sync.run(); await sync.run();
    await expect(service.authorizeMedia(reader, '/media/cam-' + otherCamera!.id + '/index.m3u8')).rejects.toThrow();
    await expect(service.authorizeMedia(reader, '/media/cam-' + otherCamera!.id + '/seg12.mp4')).rejects.toThrow();
    await service.saveGrants(admin, reader.id, []);
    await expect(service.authorizeMedia(reader, '/media/cam-' + cameraId + '/seg12.mp4')).rejects.toThrow();
    await service.saveGrants(admin, reader.id, [{ siteId, manage: false }]);
  });
  it('replaces only a changed path and restores paths after media restart; failed sync is visible', async () => {
    const previousGenerations = new Map(generations);
    await sync.run();
    expect(generations).toEqual(previousGenerations);
    const before = new Map(sources);
    let c = await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } });
    await service.saveCamera(admin, cameraSchema.parse({ ...c, name: c.name, recorderId, channel: 5 }), cameraId);
    await sync.run(); await sync.run();
    expect((await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } })).syncState).toBe('SYNCED');
    expect(sources.get('cam-' + cameraId)).toContain('channel=5');
    for (const [name, source] of before) if (name !== 'cam-' + cameraId) expect(sources.get(name)).toBe(source);
    sources.clear();
    const restarted = new VideoSync(db, new MediaClient());
    await restarted.run();
    expect(sources.size).toBe(2);
    unavailable = true; await restarted.run();
    expect((await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } })).syncState).toBe('ERROR');
    await expect(service.authorizeMedia(reader, '/media/cam-' + cameraId + '/index.m3u8')).rejects.toThrow();
    unavailable = false; await restarted.run();
    expect((await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } })).syncState).toBe('SYNCED');
  });
  it('preserves child states on recorder archive and rejects occupied-channel restore atomically', async () => {
    let c = await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } });
    await service.saveCamera(admin, cameraSchema.parse({ ...c, enabled: false }), cameraId);
    let r = await db.videoRecorder.findUniqueOrThrow({ where: { id: recorderId } });
    await service.archive(admin, 'recorder', recorderId, r.version, true);
    c = await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } });
    expect(c.enabled).toBe(false); expect(c.isArchived).toBe(false);
    await service.archive(admin, 'camera', cameraId, c.version, true);
    r = await db.videoRecorder.findUniqueOrThrow({ where: { id: recorderId } });
    await service.archive(admin, 'recorder', recorderId, r.version, false);
    c = await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } });
    expect(c.enabled).toBe(false); expect(c.isArchived).toBe(true);
    await service.saveCamera(admin, cameraSchema.parse({ recorderId, name: 'Новая на канале', channel: c.channel }));
    await expect(service.archive(admin, 'camera', cameraId, c.version, false)).rejects.toThrow(/занят/);
    expect((await db.videoCamera.findUniqueOrThrow({ where: { id: cameraId } })).isArchived).toBe(true);
    await expect(service.saveCamera(admin, cameraSchema.parse({ recorderId, name: 'Дубликат', channel: c.channel }))).rejects.toThrow(/занят/);
  });
});
