/** Единые форматы чисел и дат интерфейса. */
import type { KpiTile } from '@mvs/shared';

const nf = (digits: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const nf0 = nf(0), nf1 = nf(1);

/** Доля 0…1 → «83,6 %». */
export const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${nf(digits).format(v * 100)} %`);

/** Доля-отклонение → «−6,1 п.п.» (со знаком). */
export function pp(v: number | null | undefined, digits = 1) {
  if (v == null) return '—';
  const x = v * 100;
  const s = nf(digits).format(Math.abs(x));
  return `${x > 0.05 ? '+' : x < -0.05 ? '−' : ''}${s} п.п.`;
}

export const int = (v: number | null | undefined) => (v == null ? '—' : nf0.format(v));

/** Рубли → «1,73 млрд ₽» / «193,5 млн ₽». */
export function money(v: number | null | undefined) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf(2).format(v / 1e9)} млрд ₽`;
  if (a >= 1e6) return `${nf1.format(v / 1e6)} млн ₽`;
  if (a >= 1e3) return `${nf0.format(v / 1e3)} тыс. ₽`;
  return `${nf0.format(v)} ₽`;
}

export function date(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** «нед. 44 · 26.10.2026» — для отчётных недель. */
export function weekLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `нед. ${week} · ${date(iso)}`;
}

export function tileValue(t: KpiTile) {
  if (t.value == null) return '—';
  switch (t.format) {
    case 'money':
      return money(t.value);
    case 'days':
      return `${int(t.value)} дн.`;
    case 'qty':
      return `${int(t.value)}${t.unit ? ` ${t.unit}` : ''}`;
    case 'percent':
      return pct(t.value / 100);
    default:
      return t.of != null ? `${int(t.value)} из ${int(t.of)}` : int(t.value);
  }
}
