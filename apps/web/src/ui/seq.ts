/** Последовательная шкала величины 0…1 → ступень синей гаммы и цвет текста на ней (theme.css: --seq-*, --seq-ink-*). */
export function seq(v: number) {
  const step = Math.max(0, Math.min(6, Math.round(v * 6)));
  return { background: `var(--seq-${step})`, color: `var(--seq-ink-${step})` };
}

export const SEQ_STEPS = [0, 1, 2, 3, 4, 5, 6];
