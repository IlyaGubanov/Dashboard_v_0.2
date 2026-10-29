/**
 * Карта объектов на OpenLayers. Модуль грузится лениво (только при открытии вкладки «Карта»), чтобы OpenLayers
 * не попадал в основной пакет интерфейса.
 */
import 'ol/ol.css';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import { boundingExtent } from 'ol/extent';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import type { SiteKpiRow } from '@mvs/shared';

export interface SitesMapOptions {
  /** шаблон адреса тайлов: https://…/{z}/{x}/{y}.png */
  tiles: string;
  attribution: string;
  color: (r: SiteKpiRow) => string;
  radius: (r: SiteKpiRow) => number;
  onClick: (id: number) => void;
  /** наведение на объект: координаты — в пикселях внутри контейнера карты */
  onHover: (h: { row: SiteKpiRow; x: number; y: number } | null) => void;
}

/** Создаёт карту в контейнере; возвращает функцию, которая её убирает. */
export function mountSitesMap(target: HTMLElement, rows: SiteKpiRow[], o: SitesMapOptions): () => void {
  const features = rows.map((r) => {
    const f = new Feature({ geometry: new Point(fromLonLat([r.lon!, r.lat!])) });
    f.set('row', r);
    return f;
  });

  // стиль кешируется по цвету и размеру: на сотни объектов — единицы разных стилей
  const cache = new Map<string, Style>();
  const style = (f: Feature, hovered = false) => {
    const r = f.get('row') as SiteKpiRow;
    const color = o.color(r), radius = o.radius(r) + (hovered ? 2 : 0);
    const key = `${color}|${radius}|${hovered}`;
    let s = cache.get(key);
    if (!s) {
      s = new Style({
        image: new Circle({ radius, fill: new Fill({ color }), stroke: new Stroke({ color: '#ffffff', width: hovered ? 3 : 2 }) }),
        zIndex: hovered ? 1 : 0,
      });
      cache.set(key, s);
    }
    return s;
  };

  const vector = new VectorLayer({ source: new VectorSource({ features }), style: (f) => style(f as Feature) });
  const map = new OlMap({
    target,
    layers: [new TileLayer({ source: new XYZ({ url: o.tiles, attributions: o.attribution, maxZoom: 19 }) }), vector],
    view: new View({ center: fromLonLat([37.62, 55.75]), zoom: 10, maxZoom: 19 }),
    // подпись источника подложки видна всегда — этого требуют правила OpenStreetMap
    controls: defaultControls({ attributionOptions: { collapsible: false } }).extend([new ScaleLine()]),
  });

  // показать все объекты; один объект — не приближать до уровня дома
  const extent = boundingExtent(features.map((f) => (f.getGeometry() as Point).getCoordinates()));
  map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 15 });

  let hovered: Feature | null = null;
  map.on('pointermove', (e) => {
    if (e.dragging) return;
    const f = (map.forEachFeatureAtPixel(e.pixel, (x) => x, { layerFilter: (l) => l === vector, hitTolerance: 4 }) as Feature | undefined) ?? null;
    if (f !== hovered) {
      hovered?.setStyle(undefined);
      hovered = f;
      f?.setStyle(style(f, true));
    }
    target.style.cursor = f ? 'pointer' : '';
    o.onHover(f ? { row: f.get('row') as SiteKpiRow, x: e.pixel[0], y: e.pixel[1] } : null);
  });
  map.getViewport()?.addEventListener('pointerleave', () => {
    hovered?.setStyle(undefined);
    hovered = null;
    o.onHover(null);
  });
  map.on('singleclick', (e) => {
    const f = map.forEachFeatureAtPixel(e.pixel, (x) => x, { layerFilter: (l) => l === vector, hitTolerance: 4 }) as Feature | undefined;
    if (f) o.onClick((f.get('row') as SiteKpiRow).id);
  });

  // вкладки и боковая панель меняют ширину контейнера — карта должна перерисоваться
  const ro = new ResizeObserver(() => map.updateSize());
  ro.observe(target);

  return () => {
    ro.disconnect();
    map.setTarget(undefined);
    map.dispose();
  };
}
