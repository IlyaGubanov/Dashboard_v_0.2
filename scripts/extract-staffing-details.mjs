/**
 * Должности по группам и приём/увольнение по дням из «Численность ТРЕСТА.xlsx» — только агрегаты, без ФИО и комментариев.
 *   node scripts/extract-staffing-details.mjs <исходный.xlsx> apps/api/src/staffing/source.json
 * Дописывает в source.json: positions — в срез 2026-10 (факт «По должностям 26.10.2026», план = факт + «вакансии»),
 * movements — дни из листа «Приемыувольнения». Итоги сверяются с контрольными строками листов, при расхождении — ошибка.
 */
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const [xlsxPath, target] = process.argv.slice(2);
if (!xlsxPath || !target) throw new Error('Укажите исходный .xlsx и путь к source.json');
const zip = unzipSync(fs.readFileSync(xlsxPath));
const text = name => strFromU8(zip[name]);
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
const rels = text('xl/_rels/workbook.xml.rels');
const sheets = Object.fromEntries([...text('xl/workbook.xml').matchAll(/<sheet [^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g)]
  .map(m => [decode(m[1]), 'xl/' + rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]*)"`))[1].replace(/^\/?xl\//, '')]));
/** Лист → { 'A1': значение }: строки — из общей таблицы, числа — числами. */
function sheet(name) {
  if (!sheets[name]) throw new Error(`Нет листа «${name}»`);
  const cells = {};
  for (const c of text(sheets[name]).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/);
    if (v) cells[c[1]] = /t="s"/.test(c[2]) ? shared[+v[1]] : /t="str"/.test(c[2]) ? decode(v[1]) : Number(v[1]);
  }
  return cells;
}
const col = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const serial = n => new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Блоки сводки → группы диаграммы (как срез 26.10.2026). */
function groupOf(name) {
  const s = clean(name).replace(/\s*\(Рук\.[^)]*\)/, '');
  const rsu = s.match(/^РСУ-(\d)/);
  if (rsu) return `РСУ-${rsu[1]}`;
  if (/^ГУП МВС/.test(s)) return 'ГУП МВС (СМУ+РСУ+ТЛС)';
  if (/^Ремонтно-эксплуатационная база|^РЭБ$/.test(s)) return 'РЭБ (без ТЛС)';
  if (/^РСУ СР\+УСР/.test(s)) return 'РСУ СР+УСР от Учредителя';
  if (/административно-управленческого/.test(s)) return 'АУП';
  if (/^Управление гражданского строительства$/.test(s)) return 'Управление гражданского строительства';
  if (/^Управление обеспечения и эксплуатации производственной базы$|^Производственная база$/.test(s)) return 'Управление обеспечения и эксплуатации производственной базы';
  throw new Error(`Неизвестный блок: «${name}»`);
}
/** Название должности без разряда, участка и лишних пробелов — для сопоставления факта и вакансий. */
const baseTitle = s => clean(String(s).replace(/\/[^/]*\/?/g, ' ').replace(/\s*\d+\s*-?\s*(?:го\s+)?разряд\w*/gi, ' ').replace(/\s*\d+\s*категори\w*/gi, m => m)).replace(/\s+,/g, ',');
const key = s => baseTitle(s).toLocaleLowerCase('ru').replace(/ё/g, 'е');

// 1. Факт по должностям на 26.10.2026: строка группы (B — название, C — итог), затем должности (A — номер).
const posSheet = sheet('По должностям 26.10.2026');
const fact = new Map(); // группа → Map(ключ → { title, actual })
const totals = new Map();
let group = null;
for (let r = 2; r <= 400; r++) {
  const a = posSheet[`A${r}`], b = posSheet[`B${r}`], c = posSheet[`C${r}`];
  if (b == null) continue;
  if (/^Общий итог/.test(clean(b))) { totals.set('__all', c); break; }
  if (a == null) { group = groupOf(b); totals.set(group, c); fact.set(group, new Map()); continue; }
  const k = key(b), items = fact.get(group);
  const item = items.get(k) ?? { title: baseTitle(b), actual: 0 };
  item.actual += c ?? 0;
  items.set(k, item);
}
for (const [g, items] of fact) {
  const sum = [...items.values()].reduce((s, p) => s + p.actual, 0);
  if (sum !== totals.get(g)) throw new Error(`«По должностям 26.10.2026»: сумма должностей ${g} = ${sum}, итог группы ${totals.get(g)}`);
}

// 2. Вакансии: блок управления (C — код РСУ или «Управление по специализированным работам от Учредителя»);
//    участки, отделы, группы — промежуточные итоги, остальное — должности. ТЛС внутри РЭБ относится к ГУП МВС, как в сводке.
//    (\b в JS не работает с кириллицей, поэтому граница слова — пробел или конец строки.)
const vacSheet = sheet('вакансии');
const vacancies = new Map(); // группа → Map(ключ → { title, count })
const blockTotals = new Map(), blockSums = new Map();
const subtotal = /^(Участок|Служба|Гараж|Цех|Отдел|Склад|Группа|Ремонтно-эксплуатационный отдел)(?=\s|$)/i;
function addVacancy(g, title, count) {
  if (!vacancies.has(g)) vacancies.set(g, new Map());
  const items = vacancies.get(g), k = key(title);
  const item = items.get(k) ?? { title: baseTitle(title), count: 0 };
  item.count = Math.round((item.count + count) * 100) / 100;
  items.set(k, item);
}
let vacGroup = null;
for (let r = 3; r <= 400; r++) {
  const a = vacSheet[`A${r}`], b = vacSheet[`B${r}`], code = vacSheet[`C${r}`];
  if (a == null) continue;
  const block = code != null && /РСУ|РЭБ/.test(String(code)) ? groupOf(String(code).replace(/\s*\(.*$/, ''))
    : /^Управление по специализированным работам от Учредителя$/.test(clean(a)) ? 'РСУ СР+УСР от Учредителя' : null;
  if (block) { vacGroup = block; blockTotals.set(block, b ?? null); blockSums.set(block, 0); continue; }
  if (!vacGroup || typeof b !== 'number' || subtotal.test(clean(a))) continue;
  blockSums.set(vacGroup, Math.round((blockSums.get(vacGroup) + b) * 100) / 100);
  // в листе название службы бывает обрезано: «Транспортно-логи…»
  const tls = vacGroup === 'РЭБ (без ТЛС)' && /Транспортно-лог/i.test(a);
  addVacancy(tls ? 'ГУП МВС (СМУ+РСУ+ТЛС)' : vacGroup, String(a).replace(/\s*Транспортно-лог\S*(\s+служба)?\/?\s*$/i, ''), b);
}
// Итог блока в листе может расходиться с суммой его участков (РСУ-3: 95,5 против 82,5) — переносим должности, расхождение показываем в отчёте.
const warnings = [];
for (const [g, total] of blockTotals) {
  if (blockSums.get(g) !== total) warnings.push(`«вакансии», ${g}: сумма должностей ${blockSums.get(g)}, итог блока ${total}`);
}

// 3. Должности среза: факт + вакансии. План известен только у групп, по которым есть вакансии.
const positions = [];
const report = [];
for (const [g, items] of fact) {
  const vac = vacancies.get(g);
  const keys = new Set([...items.keys(), ...(vac ? vac.keys() : [])]);
  let n = 0;
  for (const k of [...keys].sort((x, y) => (items.get(y)?.actual ?? 0) - (items.get(x)?.actual ?? 0) || x.localeCompare(y, 'ru'))) {
    const f = items.get(k), v = vac?.get(k);
    const actual = f?.actual ?? 0;
    positions.push({ id: `pos-${[...fact.keys()].indexOf(g) + 1}-${++n}`, group: g, title: f?.title ?? v.title, planned: vac ? Math.round((actual + (v?.count ?? 0)) * 100) / 100 : null, actual });
  }
  report.push({ group: g, positions: n, actual: totals.get(g), vacancies: vac ? Math.round([...vac.values()].reduce((s, x) => s + x.count, 0) * 100) / 100 : null, vacancyBlock: blockTotals.get(g) ?? null });
}

// 4. Приём и увольнение: строка 1 — даты (каждая пара столбцов «Приём / Увольнение»), строки групп до «ИТОГО».
const mov = sheet('Приемыувольнения');
const dates = [];
for (let i = 2; typeof mov[`${col(i)}1`] === 'number'; i += 2) dates.push({ i, date: serial(mov[`${col(i)}1`]) });
const sumCol = col(dates.at(-1).i + 2); // «ИТОГО за период»: приём, следом увольнение, затем численность на текущий день
const days = dates.map(d => ({ date: d.date, note: '', rows: [] }));
for (let r = 3; r <= 40; r++) {
  const name = mov[`A${r}`];
  if (name == null || /^ИТОГО/.test(clean(name))) break;
  const g = groupOf(name);
  let hired = 0, dismissed = 0;
  dates.forEach((d, k) => {
    const h = mov[`${col(d.i)}${r}`] ?? 0, x = mov[`${col(d.i + 1)}${r}`] ?? 0;
    hired += h; dismissed += x;
    days[k].rows.push({ group: g, hired: h, dismissed: x });
  });
  const start = mov[`B${r}`], endCol = col(dates.at(-1).i + 4);
  if (hired !== mov[`${sumCol}${r}`] || dismissed !== mov[`${col(dates.at(-1).i + 3)}${r}`]) throw new Error(`«Приемыувольнения», ${g}: суммы по дням не совпали с итогом`);
  if (start + hired - dismissed !== mov[`${endCol}${r}`]) throw new Error(`«Приемыувольнения», ${g}: ${start} + ${hired} − ${dismissed} ≠ ${mov[`${endCol}${r}`]}`);
}

const src = JSON.parse(fs.readFileSync(target, 'utf8'));
const october = src.periods.find(p => p.month === '2026-10');
if (!october) throw new Error('В source.json нет среза 2026-10 — сначала scripts/extract-staffing.py');
october.positions = positions;
src.movements = days;
fs.writeFileSync(target, JSON.stringify(src, null, 2));
console.log(JSON.stringify({ positions: positions.length, warnings, groups: report, movements: { from: days[0].date, to: days.at(-1).date, days: days.length, hired: days.reduce((s, d) => s + d.rows.reduce((t, r) => t + r.hired, 0), 0), dismissed: days.reduce((s, d) => s + d.rows.reduce((t, r) => t + r.dismissed, 0), 0) } }, null, 1));
