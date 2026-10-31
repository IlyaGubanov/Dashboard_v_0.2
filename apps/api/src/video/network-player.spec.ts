import { describe, expect, it, vi, afterEach } from 'vitest';
import { NetworkPolicy } from './network-policy';
import { attachLive } from '../../../web/src/video/live-player';
describe('сетевой allowlist', () => {
  it('permits only configured camera destinations and ports', async () => {
    const p = new NetworkPolicy('10.20.0.0/16,192.168.30.0/24');
    expect(await p.resolve('10.20.1.30', 554)).toBe('10.20.1.30');
    await expect(p.resolve('10.21.1.30', 554)).rejects.toThrow();
    await expect(p.resolve('10.20.1.30', 80)).rejects.toThrow();
    await expect(p.resolve('public.example', 554)).rejects.toThrow();
  });
  it.each(['127.0.0.1', '169.254.169.254', '224.1.2.3', '0.0.0.0'])('forbids dangerous range even with broad allowlist: %s', address => {
    expect(new NetworkPolicy('0.0.0.0/0').allows(address)).toBe(false);
  });
});
class FakeVideo extends EventTarget {
  src = ''; muted = false; playsInline = false; error = null; loads = 0; plays = 0;
  canPlayType() { return 'probably'; }
  async play() { this.plays++; }
  load() { this.loads++; }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}
describe('native HLS lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('cleans up events, requests and retry timers on unmount', async () => {
    vi.useFakeTimers();
    const video = new FakeVideo(), states: string[] = [];
    const session = attachLive(video as unknown as HTMLVideoElement, '/media/cam-1/index.m3u8', s => states.push(s));
    video.dispatchEvent(new Event('playing'));
    expect(states.at(-1)).toBe('В эфире');
    session.dispose();
    const length = states.length;
    video.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(120000);
    expect(states).toHaveLength(length);
    expect(video.src).toBe('');
    expect(video.loads).toBeGreaterThan(0);
  });
  it('bounds connection retries and permits a fresh player after failure', async () => {
    vi.useFakeTimers();
    const video = new FakeVideo(), states: string[] = [];
    const session = attachLive(video as unknown as HTMLVideoElement, '/media/cam-1/index.m3u8', s => states.push(s));
    await vi.advanceTimersByTimeAsync(120000);
    expect(states.at(-1)).toBe('Нет связи');
    expect(video.plays).toBe(3);
    session.dispose();
    const next = attachLive(video as unknown as HTMLVideoElement, '/media/cam-2/index.m3u8', s => states.push(s));
    video.dispatchEvent(new Event('playing'));
    expect(states.at(-1)).toBe('В эфире');
    next.dispose();
  });
});
