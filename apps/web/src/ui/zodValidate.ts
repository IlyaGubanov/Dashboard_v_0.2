import type { ZodType } from 'zod';

/** Проверка формы Mantine общей zod-схемой из @mvs/shared: { поле: сообщение }. */
export function zodValidate<T>(schema: ZodType) {
  return (values: T) => {
    const r = schema.safeParse(values);
    if (r.success) return {};
    const errors: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = i.path.join('.');
      if (!errors[k]) errors[k] = i.message;
    }
    return errors;
  };
}
