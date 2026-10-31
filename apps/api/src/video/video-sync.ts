import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaClient } from './media-client';
import { NetworkPolicy } from './network-policy';
import { dahuaUrl, eligible, SecretBox } from './video-domain';
import { createHash } from 'node:crypto';
export const SYNC_ERROR = 'Не удалось применить подключение. Проверьте медиасервис, ключ шифрования и разрешённые сети.';
@Injectable()
export class VideoSync implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  // v1.21.3 redacts credentials in Control API responses. Never compare source strings from list/get.
  private readonly applied = new Map<string, string>();
  constructor(private readonly db: PrismaService, private readonly media: MediaClient) {}
  onModuleInit() {
    if (!process.env.VIDEO_ENCRYPTION_KEY || !process.env.VIDEO_SERVICE_TOKEN) return;
    this.timer = setInterval(() => { void this.run(); }, 20000);
    this.timer.unref();
    void this.run();
  }
  onModuleDestroy() { clearInterval(this.timer); }
  run() {
    if (!this.running) this.running = this.reconcile().catch(() => undefined).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async reconcile() {
    const cameras = await this.db.videoCamera.findMany({ include: { recorder: { include: { site: true } } } });
    try {
      const current = new Map((await this.media.configs()).filter(p => /^cam-[1-9]\d*$/.test(p.name)).map(p => [p.name, p.source]));
      for (const camera of cameras) {
        const name = 'cam-' + camera.id;
        try {
          const r = camera.recorder;
          if (!eligible(camera, r) || r.site.isArchived) {
            if (current.has(name)) await this.media.remove(name);
            this.applied.delete(name);
          } else {
            const host = await new NetworkPolicy().resolve(r.host, r.port);
            const password = new SecretBox(process.env.VIDEO_ENCRYPTION_KEY ?? '').decrypt(r.passwordEncrypted);
            const source = dahuaUrl({ ...r, host, password }, camera.channel, camera.stream);
            const fingerprint = createHash('sha256').update(source).digest('hex');
            if (!current.has(name) || this.applied.get(name) !== fingerprint) await this.media.put(name, source, current.has(name));
            this.applied.set(name, fingerprint);
          }
          await this.db.videoCamera.updateMany({ where: { id: camera.id, version: camera.version, recorder: { version: camera.recorder.version } }, data: { syncState: 'SYNCED', syncError: null } });
          current.delete(name);
        } catch {
          await this.db.videoCamera.updateMany({ where: { id: camera.id, version: camera.version }, data: { syncState: 'ERROR', syncError: SYNC_ERROR } });
          current.delete(name);
        }
      }
      // Remove only our orphaned paths; a test publisher or unrelated path is never touched.
      for (const name of current.keys()) { await this.media.remove(name); this.applied.delete(name); }
    } catch {
      await this.db.videoCamera.updateMany({ data: { syncState: 'ERROR', syncError: SYNC_ERROR } });
    }
  }
}
