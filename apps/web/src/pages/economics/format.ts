/** Форматы раздела «Экономика»: суммы без НДС в рублях, в таблицах — без копеек. */
import type { EconBudget, EconDirectionRef } from '@mvs/shared';
import { staffingCsvCell } from '@mvs/shared';

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const rub = (v: number | null | undefined) => (v == null ? '—' : `${nf0.format(v)} ₽`);
export const qty = (v: number | null | undefined) => (v == null ? '—' : nf2.format(v));
export const share = (part: number | null | undefined, whole: number | null | undefined) => (part == null || !whole ? '—' : `${nf2.format(Math.round((part / whole) * 1000) / 10)} %`);
/** Значение поля NumberInput → число или null. */
export const numOrNull = (v: string | number) => (v === '' || v == null ? null : Number(v));
export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Не удалось сохранить');

/** Код центра затрат для шаблона загрузки — по нему строки Excel сопоставляются с центрами затрат. */
export const budgetCode = (b: Pick<EconBudget, 'id'>) => `ЦЗ-${b.id}`;
export const budgetFullTitle = (b: EconBudget, dirs: EconDirectionRef[]) => `${dirs.find((d) => d.id === b.directionId)?.shortName ?? ''} · ${b.title}`;

export function downloadCsv(name: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(staffingCsvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Последние 24 месяца и месяцы, по которым уже есть данные, — для выбора отчётного месяца. */
export function monthChoices(known: string[], now = new Date()): string[] {
  const set = new Set(known);
  for (let i = 0; i < 24; i++) set.add(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return [...set].sort().reverse();
}

/** Цвет статьи — из палитры долей темы (--cat-1…10), по порядку статьи в справочнике: один и тот же на всех графиках. */
export function articleColor(articles: { id: number }[], id: number) {
  const i = articles.findIndex((a) => a.id === id);
  return `var(--cat-${(Math.max(0, i) % 10) + 1})`;
}
export const STATUS_VAR = { good: 'var(--status-good)', warning: 'var(--status-warning)', critical: 'var(--status-critical)', none: 'var(--status-none)' } as const;
/** Отклонение со знаком: «+3,2 %» (экономия) / «−5,0 %» (перерасход). */
export const signedPct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0.0005 ? '+' : v < -0.0005 ? '−' : ''}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Math.abs(v * 100))} %`);
