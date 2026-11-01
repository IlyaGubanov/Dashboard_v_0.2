import { describe, expect, it } from 'vitest';
import { delayReasonSettingsSchema, delayReasonSaveSchema, delayResponsibleIds, canEditDelayReason } from '@mvs/shared';

describe('причины отставания: назначения и доступ', () => {
  const settings = () => delayReasonSettingsSchema.parse({ defaultResponsibleIds: [10, 11], workTypes: [{ workTypeId: 7, responsibleIds: [12] }] });
  it('назначение вида работ заменяет общих ответственных', () => {
    expect(delayResponsibleIds(settings(), 7, [13])).toEqual([12]);
    expect(delayResponsibleIds(settings(), 8, [13])).toEqual([10, 11]);
  });
  it('без настроек использует ответственных позиции и объекта без дублей', () => {
    expect(delayResponsibleIds(delayReasonSettingsSchema.parse({}), 7, [13, 13, 14])).toEqual([13, 14]);
    expect(delayResponsibleIds({ ...settings(), useSiteResponsibles: false, defaultResponsibleIds: [], workTypes: [] }, 7, [13])).toEqual([]);
  });
  it('явное пустое назначение не наследует других сотрудников', () => {
    expect(delayResponsibleIds({ ...settings(), workTypes: [{ workTypeId: 7, responsibleIds: [] }] }, 7, [13])).toEqual([]);
  });
  it('разрешает назначенному сотруднику только открытую точку', () => {
    expect(canEditDelayReason(settings(), 'VIEWER', 12, [12], 'OPEN')).toBe(true);
    expect(canEditDelayReason(settings(), 'EDITOR', 13, [12], 'OPEN')).toBe(false);
    expect(canEditDelayReason(settings(), 'VIEWER', 12, [12], 'CLOSED')).toBe(false);
    expect(canEditDelayReason(settings(), 'CURATOR', 13, [12], 'LOCKED')).toBe(false);
    expect(canEditDelayReason(settings(), 'ADMIN', 13, [], 'LOCKED')).toBe(true);
  });
  it('администратор может отключить правку куратором', () => {
    expect(canEditDelayReason(settings(), 'CURATOR', 13, [], 'CLOSED')).toBe(true);
    expect(canEditDelayReason({ ...settings(), allowCuratorEdit: false }, 'CURATOR', 13, [], 'OPEN')).toBe(false);
  });
  it('отклоняет дубли назначений и слишком длинную причину, обрезает пробелы', () => {
    expect(delayReasonSettingsSchema.safeParse({ defaultResponsibleIds: [1, 1] }).success).toBe(false);
    expect(delayReasonSettingsSchema.safeParse({ workTypes: [{ workTypeId: 7, responsibleIds: [] }, { workTypeId: 7, responsibleIds: [] }] }).success).toBe(false);
    expect(delayReasonSaveSchema.safeParse({ text: 'x'.repeat(2001), version: 0 }).success).toBe(false);
    expect(delayReasonSaveSchema.parse({ text: '  Нет материалов  ', version: 0 }).text).toBe('Нет материалов');
  });
});
