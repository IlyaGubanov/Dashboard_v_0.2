#!/usr/bin/env node
/**
 * Извлекает встроенные данные из HTML-модулей исходного дашборда в JSON для импорта в БД.
 *
 *   node scripts/extract-demo.mjs <папка с mkd.html, networks.html, schools.html, streets.html>
 *
 * Результат: apps/api/prisma/demo/{mkd,networks,schools,streets}.json
 * Благоустройство сокращается: из ячеек отчёта остаются только объёмы (проект / факт / принято),
 * координаты объектов добавляются из геоданных модуля. Офлайн-карта не переносится.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('Укажите папку с HTML-модулями: node scripts/extract-demo.mjs <папка>');
  process.exit(1);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api/prisma/demo');
fs.mkdirSync(out, { recursive: true });

function block(html, id) {
  const open = `<script id="${id}" type="application/json">`;
  const i = html.indexOf(open);
  if (i < 0) throw new Error(`Не найден блок данных «${id}»`);
  const start = i + open.length;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start)));
}
const read = (name) => fs.readFileSync(path.join(src, name), 'utf8');
const write = (name, data) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`${name}: ${(fs.statSync(file).size / 1024).toFixed(0)} КБ`);
};

write('mkd.json', block(read('mkd.html'), 'seed'));
write('networks.json', block(read('networks.html'), 'seed'));
write('schools.json', block(read('schools.html'), 'data'));

const streetsHtml = read('streets.html');
const st = block(streetsHtml, 'data');
const geo = block(streetsHtml, 'geodata');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
write('streets.json', {
  source: st.source,
  unitsNote: st.unitsNote,
  works: st.works,
  catalog: st.catalog.map((c) => ({ ...c, geo: geo.verified?.[c.id] ?? null, geoNote: geo.unverified?.[c.id] ?? null })),
  excluded: st.excluded,
  discrepancies: st.discrepancies,
  snapshots: st.snapshots.map((s) => ({
    sheet: s.sheet,
    date: s.date,
    program: s.program,
    works: s.works,
    objects: s.objects.map((o) => ({
      id: o.id,
      status: o.status == null ? null : String(o.status),
      people: num(o.people),
      tech: num(o.tech),
      remarks: num(o.remarks),
      row: o.row ?? null,
      works: Object.fromEntries(
        Object.entries(o.works ?? {}).map(([k, w]) => [k, { p: num(w.p), f: num(w.f), a: num(w.a) }]),
      ),
    })),
  })),
});
