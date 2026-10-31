import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function dahuaUrl(r: { host: string; port: number; username: string; password: string }, channel: number, stream: number) {
  return `rtsp://${encodeURIComponent(r.username)}:${encodeURIComponent(r.password)}@${r.host}:${r.port}/cam/realmonitor?channel=${channel}&subtype=${stream}`;
}
export function mediaResource(uri: string): { cameraId: number; path: string } | null {
  const m = /^\/media\/(cam-([1-9]\d{0,9}))\/([A-Za-z0-9_-]+\.(?:m3u8|mp4|m4s|ts))(?:\?[^\r\n]*)?$/.exec(uri);
  return m ? { cameraId: Number(m[2]), path: `${m[1]}/${m[3]}` } : null;
}
export function eligible(c: { enabled: boolean; isArchived: boolean }, r: { enabled: boolean; isArchived: boolean }) {
  return c.enabled && !c.isArchived && r.enabled && !r.isArchived;
}
export function redactRecorder<T extends Record<string, unknown>>(value: T) {
  const { passwordEncrypted: _cipher, password: _plain, ...safe } = value;
  return safe;
}
export function canUseVideo(globalRole: string, memberRole: string | null, view: boolean, manage: boolean, action: 'view' | 'manage') {
  if (globalRole === 'ADMIN') return true;
  if (!view || (globalRole !== 'MANAGEMENT' && !memberRole)) return false;
  return action === 'view' || (manage && (globalRole === 'MANAGEMENT' || memberRole === 'CURATOR'));
}
export class SecretBox {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== key) throw new Error('VIDEO_ENCRYPTION_KEY: требуется ключ из 32 случайных байт в base64');
  }
  encrypt(value: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
  }
  decrypt(value: string) {
    try {
      const [version, nonce, tag, data, extra] = value.split('.');
      if (version !== 'v1' || extra || !data) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new Error('Не удалось расшифровать пароль регистратора. Проверьте ключ VIDEO_ENCRYPTION_KEY'); }
  }
}
