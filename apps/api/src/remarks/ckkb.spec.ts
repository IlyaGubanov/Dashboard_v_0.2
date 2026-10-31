import { describe, expect, it } from 'vitest';
import { remarkSchema } from '../../../../packages/shared/src/remarks';
const base = { siteId: 1, text: 'Проверка нарушения', sourceName: 'ЦККБ' };
describe('типизация нарушений ЦККБ', () => {
  it('позволяет зарегистрировать ЦККБ обычным замечанием без обязательного классификатора', () => {
    expect(remarkSchema.safeParse(base).success).toBe(true);
  });
  it('не позволяет отнести документ к технологиям', () => {
    expect(remarkSchema.safeParse({ ...base, violationGroup: 'TECHNOLOGY', violationType: 'missing_work_log' }).success).toBe(false);
  });
  it('сохраняет обычные замечания других направлений без классификации ЦККБ', () => {
    expect(remarkSchema.safeParse({ siteId: 1, text: 'Замечание школы' }).success).toBe(true);
  });
  it('отклоняет несуществующую календарную дату', () => {
    expect(remarkSchema.safeParse({ siteId: 1, text: 'Замечание', detectedOn: '2026-02-31' }).success).toBe(false);
  });
});
