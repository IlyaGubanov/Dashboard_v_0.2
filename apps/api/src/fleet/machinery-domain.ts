import type { MachineryKindDiff, MachineryLine, MachineryStatus } from '@mvs/shared';

/** Названия сравниваются без учёта регистра, лишних пробелов и «ё». */
const norm = (kind: string) => kind.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru').replaceAll('ё', 'е');

/** Сводит машины РЭБ в строки «вид — количество» (по алфавиту). */
export function countByKind(kinds: string[]): MachineryLine[] {
  const out = new Map<string, MachineryLine>();
  for (const kind of kinds) {
    const line = out.get(norm(kind));
    if (line) line.qty++;
    else out.set(norm(kind), { kind: kind.trim(), qty: 1 });
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind, 'ru'));
}

/**
 * Сверка объекта. reported — итог ответственного (null: не вносил), byKind — его разбивка (null: только общее число).
 * Сначала сравниваются итоги; при равных итогах и известной разбивке — виды.
 */
export function reconcile(reported: number | null, byKind: MachineryLine[] | null, fleet: MachineryLine[]): { status: MachineryStatus; kinds: MachineryKindDiff[] } {
  const fleetTotal = fleet.reduce((a, l) => a + l.qty, 0);
  const lines = byKind?.length ? byKind : null;
  const merged = new Map<string, MachineryKindDiff>();
  if (lines) {
    for (const l of lines) merged.set(norm(l.kind), { kind: l.kind, reported: l.qty, fleet: 0 });
    for (const l of fleet) {
      const hit = merged.get(norm(l.kind));
      if (hit) hit.fleet = l.qty;
      else merged.set(norm(l.kind), { kind: l.kind, reported: 0, fleet: l.qty });
    }
  }
  const kinds = [...merged.values()].sort((a, b) => a.kind.localeCompare(b.kind, 'ru'));
  if (!reported && !fleetTotal) return { status: 'none', kinds };
  if (reported == null) return { status: 'onlyFleet', kinds };
  if (!fleetTotal) return { status: 'onlyReport', kinds };
  if (reported !== fleetTotal) return { status: 'diff', kinds };
  return { status: kinds.some((k) => k.reported !== k.fleet) ? 'kinds' : 'match', kinds };
}
