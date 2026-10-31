import { afterEach, expect, it, vi } from 'vitest';
import { attachLive } from '../../../web/src/video/live-player';
const support = vi.hoisted(() => ({ value: true }));
vi.mock('hls.js', () => ({ default: class {
  static isSupported() { return support.value; }
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
  static ErrorTypes = { MEDIA_ERROR: 'media' };
  on() {} attachMedia(video: { src: string }) { video.src = 'blob:mock-hls'; } loadSource() {} destroy() {}
} }));
afterEach(() => { support.value = true; vi.unstubAllGlobals(); vi.useRealTimers(); });
it('native error and rejected play promise cooperate instead of aborting fallback', async () => {
  let rejectPlay!: (error: Error) => void, finishProbe!: (response: Response) => void;
  class Video extends EventTarget {
    src = ''; muted = false; playsInline = false; error = { code: 4 };
    canPlayType() { return 'maybe'; }
    play() { return new Promise<void>((_resolve, reject) => { rejectPlay = reject; }); }
    removeAttribute() { this.src = ''; } load() {}
  }
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finishProbe = resolve; }));
  const video = new Video(), states: string[] = [];
  const player = attachLive(video as unknown as HTMLVideoElement, '/media/cam-1/index.m3u8', s => states.push(s));
  video.dispatchEvent(new Event('error'));
  rejectPlay(new Error('native demux failure'));
  await Promise.resolve(); await Promise.resolve();
  finishProbe(new Response('#EXTM3U', { status: 200 }));
  await vi.dynamicImportSettled();
  expect(video.src).toBe('blob:mock-hls');
  expect(states.at(-1)).toBe('Подключение');
  player.dispose();
});
it('native network failure is retried as connection failure even without MediaSource support', async () => {
  support.value = false;
  class Video extends EventTarget {
    src = ''; muted = false; playsInline = false; error = { code: 2 };
    canPlayType() { return 'probably'; }
    async play() {}
    removeAttribute() { this.src = ''; } load() {}
  }
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  const video = new Video(), states: string[] = [];
  const player = attachLive(video as unknown as HTMLVideoElement, '/media/cam-1/index.m3u8', s => states.push(s));
  video.dispatchEvent(new Event('error'));
  await vi.dynamicImportSettled();
  expect(states.at(-1)).toBe('Подключение');
  expect(states).not.toContain('Несовместимый формат');
  player.dispose();
});
