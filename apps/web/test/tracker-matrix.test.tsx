import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackersView } from '@mvs/shared';
import { TrackersTab } from '../src/pages/direction/TrackersTab';

function render(layout: 'MATRIX' | 'CARD', valueType: string, values: (string | number | boolean | null)[]) {
  const client = new QueryClient();
  const data: TrackersView = { trackers: [{
    code: 'test', name: 'Надстройка', layout,
    stages: [{ code: 'stage', name: 'Этап', valueType, options: [
      { value: 'done', label: 'Принято', done: true, color: 'blue' },
      { value: 'review', label: 'На проверке', color: 'violet' },
    ] }],
    items: [{ code: 'a', name: 'Позиция', category: null }],
    rows: values.map((value, n) => ({
      siteId: n + 1, siteName: 'Объект ' + (n + 1), item: { code: 'a', name: 'Позиция', category: null },
      qty: null, unit: null, planDate: n === 1 ? '2099-01-01' : '2000-01-01', dueDate: null, attrs: null, values: { stage: value },
    })),
  }] };
  client.setQueryData(['dir', 'test', 'trackers'], data);
  return renderToStaticMarkup(<MantineProvider><QueryClientProvider client={client}>
    <TrackersTab code="test" onOpenSite={() => {}} />
  </QueryClientProvider></MantineProvider>);
}
describe('светофор надстроек', () => {
  it.each(['MATRIX', 'CARD'] as const)('%s: завершение зелёное, будущий ноль нейтрален, просрочка предупреждает', (layout) => {
    const html = render(layout, 'PERCENT', [100, 0, 80, null]);
    expect(html).toContain('data-risk="done"');
    expect(html).toContain('data-risk="wait"');
    expect(html).toContain('data-risk="warn"');
    expect(html).toContain('data-risk="na"');
    expect(html).not.toContain('--seq-');
  });
  it('итоговый статус зелёный, собственные названия и цвета статусов сохранены', () => {
    const html = render('CARD', 'STATUS', ['done', 'review']);
    expect(html).toContain('data-risk="done"');
    expect(html).toContain('Принято');
    expect(html).toContain('На проверке');
    expect(html).toContain('--mantine-color-violet-6');
    expect(html).not.toContain('Этап: review');
  });
  it('значение даты не выдаётся за завершение или отставание', () => {
    const html = render('CARD', 'DATE', ['2026-10-01']);
    expect(html).toContain('data-risk="na"');
    expect(html).not.toContain('data-risk="warn"');
  });
});
