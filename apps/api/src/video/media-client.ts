import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
export function validServiceToken(token: unknown) {
  const expected = process.env.VIDEO_SERVICE_TOKEN ?? '';
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(expected) && Buffer.byteLength(token) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
export interface MediaPath { name: string; ready: boolean; tracks?: string[]; tracks2?: { codec: string }[] }
@Injectable()
export class MediaClient {
  private readonly base = (process.env.VIDEO_MEDIAMTX_URL ?? 'http://mediamtx:9997').replace(/\/$/, '');
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    try {
      const res = await fetch(this.base + path, {
        method, headers: { Authorization: 'Bearer ' + (process.env.VIDEO_SERVICE_TOKEN ?? ''), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!res.ok) throw new Error();
      return (res.status === 204 ? undefined : await res.json()) as T;
    } catch { throw new ServiceUnavailableException('Медиасервис недоступен. Настройки сохранены; синхронизация будет повторена.'); }
  }
  async configs(): Promise<{ name: string; source: string }[]> {
    const result: { name: string; source: string }[] = [];
    for (let page = 0; ; page++) {
      const data = await this.request<{ items: { name: string; source: string }[]; pageCount: number }>(`/v3/config/paths/list?itemsPerPage=100&page=${page}`);
      result.push(...data.items);
      if (page + 1 >= data.pageCount) return result;
    }
  }
  async put(name: string, source: string, exists: boolean) {
    await this.request(`/v3/config/paths/${exists ? 'replace' : 'add'}/${name}`, 'POST', {
      source, rtspTransport: 'tcp', sourceOnDemand: true, sourceOnDemandStartTimeout: '12s', sourceOnDemandCloseAfter: '10s', record: false,
    });
  }
  async remove(name: string) { await this.request('/v3/config/paths/delete/' + name, 'DELETE'); }
  async runtime(name: string) { return this.request<MediaPath>('/v3/paths/get/' + name); }
}
