import { describe, expect, it } from 'vitest';
import { countByKind, reconcile } from './machinery-domain';

const line = (kind: string, qty: number) => ({ kind, qty });

describe('сверка техники ответственного и РЭБ', () => {
  it('совпадение: те же виды и количество, регистр и «ё» не важны', () => {
    expect(reconcile(3, [line('Самосвал', 2), line('Тягач с тралом', 1)], [line('самосвал', 2), line('тягач  с тралом', 1)]).status).toBe('match');
    expect(reconcile(1, [line('Самосвал', 1)], [line('САМОСВАЛ', 1)]).kinds).toEqual([{ kind: 'Самосвал', reported: 1, fleet: 1 }]);
  });

  it('разное количество важнее различий в видах', () => {
    const r = reconcile(8, [line('Экскаватор', 8)], [line('Экскаватор', 5), line('Самосвал', 1)]);
    expect(r.status).toBe('diff');
    expect(r.kinds).toEqual([
      { kind: 'Самосвал', reported: 0, fleet: 1 },
      { kind: 'Экскаватор', reported: 8, fleet: 5 },
    ]);
  });

  it('итоги равны, виды разные', () => {
    expect(reconcile(2, [line('Экскаватор', 2)], [line('Экскаватор', 1), line('Автокран', 1)]).status).toBe('kinds');
  });

  it('данные только с одной стороны и их отсутствие', () => {
    expect(reconcile(4, null, []).status).toBe('onlyReport');
    expect(reconcile(null, null, [line('Каток', 1)]).status).toBe('onlyFleet');
    expect(reconcile(null, null, []).status).toBe('none');
    expect(reconcile(0, null, []).status).toBe('none');
  });

  it('ответственный внёс ноль, а в РЭБ техника есть — это расхождение', () => {
    expect(reconcile(0, null, [line('Каток', 1)]).status).toBe('diff');
  });

  it('только общее число: сверяется итог, разбивка не сравнивается', () => {
    const r = reconcile(2, null, [line('Экскаватор', 1), line('Автокран', 1)]);
    expect(r).toEqual({ status: 'match', kinds: [] });
  });

  it('countByKind считает машины и объединяет одинаковые названия', () => {
    expect(countByKind(['Каток', 'самосвал', 'Самосвал '])).toEqual([line('Каток', 1), line('самосвал', 2)]);
  });
});
