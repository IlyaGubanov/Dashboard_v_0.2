/** Read-only данные карты. Персональные сведения имеют ту же область доступа, что и паспорт объекта. */
export interface MapSite {
  id: number;
  directionCode: string;
  name: string;
  section: { id: number; name: string } | null;
  workTypeIds: number[];
  lat: number | null;
  lon: number | null;
  people: number | null;
  tech: number | null;
  responsibles: { id: number; fullName: string; position: string | null; phone: string | null }[];
}
export interface ObjectsMap {
  directions: { id: number; code: string; name: string; color: string | null }[];
  workTypes: { id: number; directionCode: string; name: string }[];
  sites: MapSite[];
}
export interface MapFilters { directions: string[]; sections: string[]; workTypes: string[] }
export const mapEntityKey = (code: string, id: number) => JSON.stringify([code, id]);
export function hasMapCoordinates(s: { lat: number | null; lon: number | null }): boolean {
  // Предел подложки EPSG:3857: недоступные в этой проекции точки остаются в списке.
  return s.lat != null && s.lon != null && Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 85.05112878 && Math.abs(s.lon) <= 180;
}
export function filterMapSites(sites: MapSite[], filters: MapFilters): MapSite[] {
  const dirs = new Set(filters.directions), sections = new Set(filters.sections), works = new Set(filters.workTypes), seen = new Set<string>();
  return sites.filter((s) => {
    const key = mapEntityKey(s.directionCode, s.id);
    if (seen.has(key) || (dirs.size && !dirs.has(s.directionCode)) ||
      (sections.size && (!s.section || !sections.has(mapEntityKey(s.directionCode, s.section.id)))) ||
      (works.size && !s.workTypeIds.some((id) => works.has(mapEntityKey(s.directionCode, id))))) return false;
    seen.add(key);
    return true;
  });
}
/** Устаревший выбор не блокирует карту после изменения справочников или доступных направлений. */
export function normalizeMapFilters(data: ObjectsMap, filters: MapFilters): MapFilters {
  const allowed = new Set(data.directions.map((d) => d.code));
  const directions = [...new Set(filters.directions.filter((d) => allowed.has(d)))];
  const selected = new Set(directions.length ? directions : allowed);
  const sections = new Set(data.sites.filter((s) => selected.has(s.directionCode) && s.section).map((s) => mapEntityKey(s.directionCode, s.section!.id)));
  const works = new Set(data.workTypes.filter((w) => selected.has(w.directionCode)).map((w) => mapEntityKey(w.directionCode, w.id)));
  return { directions, sections: [...new Set(filters.sections.filter((s) => sections.has(s)))], workTypes: [...new Set(filters.workTypes.filter((w) => works.has(w)))] };
}
