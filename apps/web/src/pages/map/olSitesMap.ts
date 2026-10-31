/** OpenLayers: исходная подложка, атрибуция, масштаб и ResizeObserver. */
import 'ol/ol.css';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Circle, Fill, Stroke, Style, Text as MapText } from 'ol/style';
import { filterMapSites, hasMapCoordinates, type MapSite } from '@mvs/shared';

interface Options {
  tiles: string;
  attribution: string;
  color: (row: MapSite) => string;
  onClick: (rows: MapSite[]) => void;
  onHover: (value: { row: MapSite; x: number; y: number } | null) => void;
}
export interface SitesMapController { update(rows: MapSite[]): void; fit(): void; dispose(): void }
export function mountSitesMap(target: HTMLElement, o: Options): SitesMapController {
  const source = new VectorSource<Feature<Point>>({ wrapX: false });
  const cache = new Map<string, Style>();
  const style = (f: Feature<Point>, hovered = false) => {
    const color = o.color(f.get('row') as MapSite), count = f.get('count') as number;
    const key = `${color}|${count}|${hovered}`;
    if (!cache.has(key)) cache.set(key, new Style({
      image: new Circle({ radius: (count > 1 ? 11 : 8) + (hovered ? 2 : 0), fill: new Fill({ color }), stroke: new Stroke({ color: '#ffffff', width: hovered ? 3 : 2 }) }),
      text: count > 1 ? new MapText({ text: String(count), font: '600 11px sans-serif', fill: new Fill({ color: '#172b42' }), stroke: new Stroke({ color: '#ffffff', width: 3 }) }) : undefined,
      zIndex: hovered ? 1 : 0,
    }));
    return cache.get(key)!;
  };
  const vector = new VectorLayer({ source, style: (f) => style(f as Feature<Point>) });
  const map = new OlMap({ target,
    layers: [new TileLayer({ source: new XYZ({ url: o.tiles, attributions: o.attribution, maxZoom: 19 }) }), vector],
    view: new View({ center: fromLonLat([37.62, 55.75]), zoom: 10, maxZoom: 19 }),
    controls: defaultControls({ attributionOptions: { collapsible: false } }).extend([new ScaleLine()]),
  });
  const rowsAt = (pixel: number[]) => filterMapSites(
    map.getFeaturesAtPixel(pixel, { layerFilter: (l) => l === vector, hitTolerance: 4 }).map((f) => f.get('row') as MapSite),
    { directions: [], sections: [], workTypes: [] },
  );
  let hovered: Feature<Point> | null = null;
  const leave = (e?: PointerEvent) => { if (e?.relatedTarget instanceof Element && e.relatedTarget.closest('[data-map-tooltip]')) return;
    hovered?.setStyle(undefined); hovered = null; target.style.cursor = ''; o.onHover(null); };
  map.on('pointermove', (e) => {
    if (e.dragging) { leave(); return; }
    const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f, { layerFilter: (l) => l === vector, hitTolerance: 4 }) as Feature<Point> | undefined;
    if (feature !== hovered) { hovered?.setStyle(undefined); hovered = feature ?? null; hovered?.setStyle(style(hovered, true)); }
    target.style.cursor = feature ? 'pointer' : '';
    o.onHover(feature ? { row: feature.get('row') as MapSite, x: e.pixel[0], y: e.pixel[1] } : null);
  });
  map.on('singleclick', (e) => { const rows = rowsAt(e.pixel); if (rows.length) o.onClick(rows); });
  map.getViewport()?.addEventListener('pointerleave', leave);
  const ro = new ResizeObserver(() => map.updateSize()); ro.observe(target);
  let fitted = false;
  const fit = () => { const extent = source.getExtent(); if (source.getFeatures().length && extent) map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 15 }); };
  return {
    update(rows) {
      leave(); cache.clear(); source.clear();
      const valid = rows.filter(hasMapCoordinates);
      const counts = new Map<string, number>();
      for (const r of valid) { const key = `${r.lat}|${r.lon}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
      source.addFeatures(valid.map((r) => {
        const feature = new Feature({ geometry: new Point(fromLonLat([r.lon!, r.lat!])) });
        feature.set('row', r); feature.set('count', counts.get(`${r.lat}|${r.lon}`)); return feature;
      }));
      if (!fitted && valid.length) { fit(); fitted = true; }
    },
    fit,
    dispose() { ro.disconnect(); map.getViewport()?.removeEventListener('pointerleave', leave); map.setTarget(undefined); map.dispose(); },
  };
}
