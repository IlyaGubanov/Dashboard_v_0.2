import type { OverviewTileConfig } from '@mvs/shared';

/**
 * Плитки в порядке из конструктора («Плитки обзора»): скрытые убраны, своя подпись и цвет применены.
 * Плитки, которых нет в настройке (например, новый показатель), — в конце в обычном порядке.
 */
export function arrangeTiles<T extends { key: string; label: string }>(tiles: T[], cfg: OverviewTileConfig[] = []) {
  const byKey = new Map(cfg.map((c, i) => [c.key, { ...c, i }]));
  return tiles
    .map((t, i) => ({ t, c: byKey.get(t.key), i }))
    .filter((x) => !x.c?.hidden)
    .sort((a, b) => (a.c?.i ?? 100 + a.i) - (b.c?.i ?? 100 + b.i))
    .map(({ t, c }) => ({ ...t, label: c?.label || t.label, color: c?.color ?? null }));
}
