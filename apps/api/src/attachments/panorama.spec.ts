import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { preparePanorama } from './panorama';

describe('ограничение обработки панорам', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'mvs-pano-queue-')); });
  afterAll(async () => {
    if (root && resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('mvs-pano-queue-')) await rm(root, { recursive: true, force: true });
  });
  it('ограничивает очередь и продолжает принимать загрузки после её освобождения', async () => {
    const original = join(root, 'source.jpg');
    await sharp({ create: { width: 1024, height: 512, channels: 3, background: '#426886' } }).jpeg().toFile(original);
    const inputs = await Promise.all(Array.from({ length: 7 }, async (_, i) => { const path = join(root, `${i}.jpg`); await copyFile(original, path); return path; }));
    const results = await Promise.allSettled(inputs.map(preparePanorama));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(2);
    for (const result of rejected) expect(result.reason.getStatus()).toBe(503);
    await expect(preparePanorama(original)).resolves.toMatchObject({ path: `${original}.panorama.jpg` });
  });
  it('сохраняет защиту от чрезмерного числа пикселей и отличает ошибку размера от формата', async () => {
    const path = join(root, 'too-large.jpg');
    await sharp({ create: { width: 12800, height: 6400, channels: 3, background: '#426886' } }).jpeg().toFile(path);
    await expect(preparePanorama(path)).rejects.toThrow('80 млн пикселей');
  });
  it('не выдаёт ошибку формата при отказе записи на сервере', async () => {
    const path = join(root, 'write-error.jpg');
    await sharp({ create: { width: 1024, height: 512, channels: 3, background: '#426886' } }).jpeg().toFile(path);
    await mkdir(`${path}.panorama.jpg`);
    try { await preparePanorama(path); throw new Error('Ожидалась ошибка записи'); }
    catch (error) { expect((error as { getStatus(): number }).getStatus()).toBe(500); }
  });
});
