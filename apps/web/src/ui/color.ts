/** Простые операции с цветами вида #rrggbb: смешение и контраст по WCAG. */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

/** Смешать цвет a с цветом b: t = 0 — a, t = 1 — b. */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов: от 1 (не различить) до 21. Для текста нужно не меньше 4,5, для крупных значков и линий — 3. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Из нескольких цветов — самый контрастный к фону. */
export function bestOn(bg: string, candidates: string[]) {
  return candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best));
}
