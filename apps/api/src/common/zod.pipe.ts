import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Проверка тела запроса общей zod-схемой из @mvs/shared. Ошибки — по полям, на русском. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw new BadRequestException({
      message: 'Проверьте заполнение полей',
      fields: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message])),
    });
  }
}
