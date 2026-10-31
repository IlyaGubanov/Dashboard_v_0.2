import type Hls from 'hls.js';
export type LiveState = 'Подключение' | 'В эфире' | 'Нет связи' | 'Нет доступа' | 'Несовместимый формат';
export interface PlayerSession { dispose(): void }
/** Owns all events, timers and the HLS instance. Dispose on every camera change/unmount. */
export function attachLive(video: HTMLVideoElement, url: string, state: (s: LiveState) => void): PlayerSession {
  let closed = false, retries = 0, generation = 0, forceHls = false, usingNative = false, nativeHandling = false;
  let hls: Hls | undefined, probe: AbortController | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    generation++; usingNative = false; probe?.abort(); probe = undefined;
    clearTimeout(deadline); clearTimeout(retryTimer); hls?.destroy(); hls = undefined;
    video.removeAttribute('src'); video.load();
  };
  const fail = (reason: LiveState) => {
    if (closed) return;
    clear();
    if (reason === 'Нет связи' && retries++ < 2) {
      state('Подключение'); retryTimer = setTimeout(() => { void start(); }, 1000 * 2 ** retries);
    } else state(reason);
  };
  const playing = () => { if (!closed) { clearTimeout(deadline); state('В эфире'); } };
  const waiting = () => {
    if (closed || (!usingNative && !hls)) return;
    state('Подключение'); clearTimeout(deadline); deadline = setTimeout(() => fail('Нет связи'), 18000);
  };
  const nativeError = async () => {
    if (closed || !usingNative || nativeHandling) return;
    nativeHandling = true;
    const epoch = generation;
    probe = new AbortController();
    const timer = setTimeout(() => probe?.abort(), 5000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: probe.signal });
      await response.body?.cancel();
      if (closed || generation !== epoch) return;
      if (response.status === 401 || response.status === 403) { fail('Нет доступа'); return; }
      if (!response.ok) { fail('Нет связи'); return; }
      if (video.error?.code !== 3 && video.error?.code !== 4) { fail('Нет связи'); return; }
    } catch { if (!closed && generation === epoch) fail('Нет связи'); return; }
    finally { clearTimeout(timer); }
    // Some Chromium builds advertise native HLS but cannot demux this fMP4 stream.
    // Fall back once before declaring codec incompatibility; Safari without MSE fails cleanly below.
    if (!closed && generation === epoch) { forceHls = true; clear(); void start(); }
  };
  video.addEventListener('playing', playing); video.addEventListener('waiting', waiting);
  video.addEventListener('stalled', waiting); video.addEventListener('error', nativeError);
  video.muted = true; video.playsInline = true;
  async function start() {
    if (closed) return;
    const epoch = ++generation;
    nativeHandling = false; state('Подключение');
    deadline = setTimeout(() => fail('Нет связи'), 18000);
    if (!forceHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      usingNative = true; video.src = url;
      void video.play().catch(() => { if (!closed && generation === epoch) void nativeError(); }); return;
    }
    try {
      const { default: HlsClass } = await import('hls.js');
      if (closed || generation !== epoch) return;
      if (!HlsClass.isSupported()) { fail('Несовместимый формат'); return; }
      hls = new HlsClass({ enableWorker: false, lowLatencyMode: false, maxBufferLength: 12, backBufferLength: 0,
        manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 });
      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (closed || generation !== epoch) return;
        if (data.response?.code === 401 || data.response?.code === 403) { fail('Нет доступа'); return; }
        if (data.fatal) fail(data.type === HlsClass.ErrorTypes.MEDIA_ERROR ? 'Несовместимый формат' : 'Нет связи');
      });
      hls.on(HlsClass.Events.MANIFEST_PARSED, () => { void video.play().catch(() => { if (!closed && generation === epoch) fail('Нет связи'); }); });
      hls.attachMedia(video); hls.loadSource(url);
    } catch { if (!closed && generation === epoch) fail('Нет связи'); }
  }
  void start();
  return { dispose() {
    closed = true;
    video.removeEventListener('playing', playing); video.removeEventListener('waiting', waiting);
    video.removeEventListener('stalled', waiting); video.removeEventListener('error', nativeError); clear();
  } };
}
