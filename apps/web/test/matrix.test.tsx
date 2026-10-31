import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkGrid } from '@mvs/shared';
import { MatrixTab } from '../src/pages/direction/MatrixTab';

function render(items: object[]) {
  const client = new QueryClient();
  client.setQueryData(['dir', 'test', 'grid', ''], {
    asOf: '2026-10-21', planDate: '2026-10-21', workTypes: [{ id: 1, code: 'work', name: 'Работа', group: null, unit: 'м' }],
    sites: [{ id: 1, name: 'Объект', section: null, risk: 'ok', fact: 0.9, plan: 1, start: null, end: null, items }],
  } as WorkGrid);
  return renderToStaticMarkup(<MantineProvider><QueryClientProvider client={client}>
    <MatrixTab code="test" onOpenSite={() => {}} />
  </QueryClientProvider></MantineProvider>);
}
const work = (changes = {}) => ({
  id: 1, workTypeId: 1, name: 'Работа', start: null, end: null, fact: 0.8, plan: 1,
  excluded: false, overdue: false, status: null, factQty: 80, planQty: 100, unit: 'м', risk: 'crit', ...changes,
});
describe('основная матрица', () => {
  it('критичная позиция определяет цвет; средний процент сохранён', () => {
    const html = render([work(), work({ id: 2, fact: 1, risk: 'done' })]);
    expect(html).toContain('data-risk="crit"');
    expect(html).toContain('>90<');
    expect(html).toContain('Критично');
    expect(html).not.toContain('Шкала выполнения');
  });
  it('исключённая критичная позиция не меняет цвет и процент', () => {
    const html = render([work({ excluded: true }), work({ id: 2, fact: 1, risk: 'done' })]);
    expect(html).toContain('data-risk="done"');
    expect(html).toContain('>100<');
    expect(html).not.toContain('data-risk="crit"');
  });
  it('неполные данные не выдаются за благополучную ячейку', () => {
    expect(render([work({ risk: 'done', fact: 1 }), work({ id: 2, risk: 'na', fact: 0 })])).toContain('data-risk="na"');
  });
  it('старый ответ API без состояния нейтрален', () => {
    expect(render([work({ risk: undefined })])).toContain('data-risk="na"');
  });
});
