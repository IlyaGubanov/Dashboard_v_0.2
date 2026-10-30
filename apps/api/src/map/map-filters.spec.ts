import { describe, expect, it } from 'vitest';
import { filterMapSites, hasMapCoordinates, mapEntityKey, normalizeMapFilters, type MapSite, type ObjectsMap } from '../../../../packages/shared/src/map';

const site = (directionCode: string, id: number, sectionId: number, workTypeIds: number[]): MapSite => ({
  directionCode, id, name: 'Одинаковое название', section: { id: sectionId, name: 'Раздел' }, workTypeIds,
  lat: null, lon: null, people: null, tech: null, responsibles: [],
});
const data: ObjectsMap = {
  directions: [{ id: 1, code: 'a', name: 'А', color: '#123456' }, { id: 2, code: 'b', name: 'Б', color: null }],
  workTypes: [{ id: 1, directionCode: 'a', name: 'Работа' }, { id: 1, directionCode: 'b', name: 'Работа' }],
  sites: [site('a', 1, 1, [1]), site('b', 1, 1, [1]), site('a', 2, 2, [])],
};
const all = { directions: [], sections: [], workTypes: [] };

describe('выборка единой карты', () => {
  it('не теряет объекты без координат и не объединяет ID разных направлений', () => {
    expect(filterMapSites(data.sites, all).map((s) => [s.directionCode, s.id])).toEqual([['a', 1], ['b', 1], ['a', 2]]);
  });
  it('различает одноимённые разделы и одинаковые ID разных направлений', () => {
    expect(filterMapSites(data.sites, { ...all, sections: [mapEntityKey('b', 1)] }).map((s) => s.directionCode)).toEqual(['b']);
  });
  it('отбирает по реальным позициям работ, а не названию объекта', () => {
    expect(filterMapSites(data.sites, { ...all, workTypes: [mapEntityKey('a', 1)] }).map((s) => s.id)).toEqual([1]);
  });
  it('применяет фильтры совместно и поддерживает пустой результат', () => {
    expect(filterMapSites(data.sites, { directions: ['a'], sections: [mapEntityKey('a', 2)], workTypes: [mapEntityKey('a', 1)] })).toEqual([]);
  });
  it('сброс фильтров возвращает все объекты без дублей', () => {
    expect(filterMapSites([...data.sites, data.sites[0]], all)).toHaveLength(3);
  });
  it('после смены направления убирает несовместимые разделы и работы', () => {
    expect(normalizeMapFilters(data, { directions: ['b'], sections: [mapEntityKey('a', 1)], workTypes: [mapEntityKey('a', 1)] }))
      .toEqual({ directions: ['b'], sections: [], workTypes: [] });
  });
  it.each([[0, 0], [55.75, 37.62], [-85.05112878, -180], [85.05112878, 180]])('принимает координаты %s, %s, включая ноль', (lat, lon) => {
    expect(hasMapCoordinates({ lat, lon })).toBe(true);
  });
  it.each([[null, 37], [55, null], [NaN, 37], [Infinity, 37], [91, 37], [55, -181], [86, 37], [-86, 37], [90, 37], [-90, 37]])('исключает координаты вне проекции %s, %s', (lat, lon) => {
    expect(hasMapCoordinates({ lat, lon })).toBe(false);
  });
});
