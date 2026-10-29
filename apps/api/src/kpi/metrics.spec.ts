/** Каталог метрик для конструктора (shared) и их реализация (metrics.ts) не должны расходиться. БД не нужна. */
import { describe, expect, it } from 'vitest';
import { METRIC_CATALOG } from '@mvs/shared';
import { METRICS } from './metrics';

describe('каталог метрик', () => {
  it('у каждой метрики каталога есть реализация, и наоборот', () => {
    expect(METRIC_CATALOG.map((m) => m.key).sort()).toEqual(Object.keys(METRICS).sort());
  });
});
