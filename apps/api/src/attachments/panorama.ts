import { BadRequestException, HttpException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { readFile, unlink } from 'node:fs/promises';

const MAX_PIXELS = 80_000_000;
let processing = false;
const waiting: (() => void)[] = [];

async function acquire() {
  if (!processing) { processing = true; return; }
  if (waiting.length >= 4) throw new ServiceUnavailableException('Обработка панорам занята. Повторите загрузку через минуту.');
  await new Promise<void>(resolve => waiting.push(resolve));
}

/** Один тяжёлый декодер на процесс; производные строятся последовательно из сохранённого JPEG. */
export async function preparePanorama(path: string) {
  await acquire();
  const saved = `${path}.panorama.jpg`;
  try {
    const image = sharp(path, { limitInputPixels: MAX_PIXELS, failOn: 'warning', sequentialRead: true });
    const m = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(m.format ?? '') || (m.pages ?? 1) > 1 || !m.width || !m.height || m.width < 1024 || m.width !== 2 * m.height) {
      throw new BadRequestException('Нужна статичная сферическая панорама JPEG, PNG или WebP с соотношением 2:1, шириной от 1024 px.');
    }
    // libvips не сообщает pages для некоторых APNG; acTL всегда обозначает анимацию.
    if (m.format === 'png') {
      const png = await readFile(path);
      for (let offset = 8; offset + 12 <= png.length;) {
        const end = offset + png.readUInt32BE(offset) + 12;
        if (end > png.length) throw new BadRequestException('Панорамное изображение повреждено.');
        const type = png.toString('ascii', offset + 4, offset + 8);
        if (type === 'acTL') throw new BadRequestException('Анимированное изображение нельзя загрузить как панораму.');
        if (type === 'IEND') break;
        offset = end;
      }
    }
    const info = await image.resize({ width: 8192, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toFile(saved);
    await sharp(saved).resize({ width: 4096, withoutEnlargement: true }).webp({ quality: 88 }).toFile(`${saved}.viewer.webp`);
    await sharp(saved).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 76 }).toFile(`${saved}.preview.webp`);
    return { path: saved, size: info.size };
  } catch (error) {
    await Promise.all([saved, `${saved}.viewer.webp`, `${saved}.preview.webp`].map(file => unlink(file).catch(() => undefined)));
    if (error instanceof HttpException) throw error;
    const e = error as NodeJS.ErrnoException;
    if (/pixel limit/i.test(e.message)) throw new BadRequestException('Панорама превышает допустимые 80 млн пикселей. Сохраните изображение меньшего разрешения.');
    if (e.code || /unable to open|unable to write|write failed|permission denied|no space|is a directory/i.test(e.message)) throw new InternalServerErrorException('Не удалось сохранить панораму на сервере. Повторите загрузку позже.');
    throw new BadRequestException('Не удалось обработать панораму: изображение повреждено или имеет неподдерживаемый формат.');
  } finally {
    const next = waiting.shift();
    if (next) next(); else processing = false;
  }
}
