import { describe, expect, it } from 'vitest';
import { recorderSchema, cameraSchema } from '../../../../packages/shared/src/video';
import { SecretBox, dahuaUrl, mediaResource, eligible, redactRecorder, canUseVideo } from './video-domain';
describe('оборудование', () => {
  const recorder = { siteId: 1, name: 'Школа 1', host: '10.20.1.10', username: 'viewer', password: 'a@:#/ %ю' };
  it('defaults to Dahua RTSP and extra stream', () => {
    expect(recorderSchema.parse(recorder)).toMatchObject({ port: 554, profile: 'DAHUA', enabled: true });
    expect(cameraSchema.parse({ recorderId: 1, name: 'Вход', channel: 3 })).toMatchObject({ stream: 1, enabled: true, sort: 0 });
  });
  it.each(['http://10.1.1.1', '10.0.0.1/path', '127.0.0.1:554', 'host@evil', 'a b', ''])('rejects host %s', (host) => expect(recorderSchema.safeParse({ ...recorder, host }).success).toBe(false));
  it.each([0, 17, 1.5])('rejects channel %s', (channel) => expect(cameraSchema.safeParse({ recorderId: 1, name: 'Вход', channel }).success).toBe(false));
  it('encodes reserved characters without changing RTSP structure', () => {
    const url = new URL(dahuaUrl({ host: '10.1.2.3', port: 554, username: 'v@:/ю', password: 'a#?:@ /%' }, 12, 1));
    expect(url.hostname).toBe('10.1.2.3');
    expect(decodeURIComponent(url.username)).toBe('v@:/ю');
    expect(decodeURIComponent(url.password)).toBe('a#?:@ /%');
    expect(url.search).toBe('?channel=12&subtype=1');
  });
  it('excludes credentials from DTO and audit', () => expect(JSON.stringify(redactRecorder({ id: 1, name: 'R', passwordEncrypted: 'cipher', password: 'plain', username: 'v' }))).not.toMatch(/cipher|plain|passwordEncrypted/));
  it('parent archive suspends children without modifying their own states', () => {
    expect(eligible({ enabled: true, isArchived: false }, { enabled: true, isArchived: true })).toBe(false);
    expect(eligible({ enabled: true, isArchived: false }, { enabled: true, isArchived: false })).toBe(true);
    expect(eligible({ enabled: false, isArchived: false }, { enabled: true, isArchived: false })).toBe(false);
    expect(eligible({ enabled: true, isArchived: true }, { enabled: true, isArchived: false })).toBe(false);
  });
});
describe('защита видео', () => {
  it('requires an explicit object grant independently of production entry scope', () => {
    expect(canUseVideo('USER', 'EDITOR', false, false, 'view')).toBe(false);
    expect(canUseVideo('USER', 'EDITOR', true, false, 'view')).toBe(true);
    expect(canUseVideo('USER', 'VIEWER', true, true, 'manage')).toBe(false);
    expect(canUseVideo('USER', 'CURATOR', true, false, 'manage')).toBe(false);
    expect(canUseVideo('USER', 'CURATOR', true, true, 'manage')).toBe(true);
    expect(canUseVideo('USER', null, true, true, 'view')).toBe(false);
    expect(canUseVideo('MANAGEMENT', null, true, false, 'view')).toBe(true);
    expect(canUseVideo('MANAGEMENT', null, true, true, 'manage')).toBe(true);
    expect(canUseVideo('ADMIN', null, false, false, 'manage')).toBe(true);
  });
  it.each(['index.m3u8', 'main_stream.m3u8', 'init.mp4', 'seg12.mp4', 'seg12.m4s', 'seg12.ts'])('protects resource %s', (asset) => expect(mediaResource(`/media/cam-31/${asset}`)).toEqual({ cameraId: 31, path: `cam-31/${asset}` }));
  it.each(['/media/cam-1/../cam-2/index.m3u8', '/media/cam-1/%2e%2e/index.m3u8', '/media/cam-01/index.m3u8', '/media/cam-1/index.html', '/media/cam-1/secret.key', '/media/cam-1//index.m3u8'])('rejects path %s', (path) => expect(mediaResource(path)).toBeNull());
  it('uses randomized authenticated encryption', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const a = box.encrypt('secret@пароль');
    expect(a).not.toContain('secret');
    expect(box.encrypt('secret@пароль')).not.toBe(a);
    expect(box.decrypt(a)).toBe('secret@пароль');
    expect(() => new SecretBox(Buffer.alloc(32, 8).toString('base64')).decrypt(a)).toThrow();
    expect(() => box.decrypt(a.slice(0, -5))).toThrow();
    expect(() => new SecretBox('weak')).toThrow();
  });
});
