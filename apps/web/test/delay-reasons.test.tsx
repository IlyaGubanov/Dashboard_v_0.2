import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DelayReasonRow } from '@mvs/shared';
import { DelayReasonField } from '../src/pages/direction/DelayReasonField';

const row: DelayReasonRow = { workItemId: 1, workTypeId: 2, siteId: 3, name: 'Кровля', siteName: 'Школа', periodId: 4, periodDate: '2026-10-21', program: '',
  text: 'Не поставлен материал', version: 1, from: '2026-10-21', updatedBy: 'Сидоров Алексей Петрович', updatedAt: null,
  responsibles: [{ id: 5, fullName: 'Иванов Иван Иванович' }, { id: 6, fullName: 'Петров Пётр Петрович' }], canEdit: false, required: true, delayed: true };
function render(changes: Partial<DelayReasonRow> = {}) {
  return renderToStaticMarkup(<MantineProvider><QueryClientProvider client={new QueryClient()}><DelayReasonField code="schools" row={{ ...row, ...changes }} /></QueryClientProvider></MantineProvider>);
}
describe('поле причины отставания', () => {
  it('показывает текст, все ФИО и обязательность при отставании', () => {
    const html = render();
    expect(html).toContain('Причина отставания от графика');
    expect(html).toContain('Не поставлен материал');
    expect(html).toContain('Иванов Иван Иванович');
    expect(html).toContain('Петров Пётр Петрович');
    expect(html).toContain('Обязательно при отставании');
    expect(html).toMatch(/readonly/i);
  });
  it('сообщает об отсутствии назначенных сотрудников', () => {
    expect(render({ responsibles: [] })).toContain('Ответственные не назначены');
  });
});
