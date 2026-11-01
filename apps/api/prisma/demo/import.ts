/**
 * Загрузка демо-данных исходного дашборда в БД.
 *
 *   npm run db:demo                      — загрузить в пустые направления (заполненные пропускаются)
 *   npm run db:demo -- --force           — перезагрузить: удалить данные направления и загрузить заново
 *   npm run db:demo -- --clear           — удалить данные направлений (когда появятся реальные)
 *   npm run db:demo -- --only=mkd,schools
 *   npm run db:demo -- --remarks         — только добавить демо-замечания (МКД, Сети), если замечаний в направлении нет
 *
 * После --clear направление помечается (app_setting «demo.cleared»): обычный запуск, в том числе при старте
 * контейнера с DEMO_DATA=true, демо в него больше не загружает. Вернуть демо — только явно, --force.
 *
 * Если в направлении уже есть данные, внесённые вручную, --force и --clear его пропускают;
 * удалить и их — флаг --delete-manual-data (только после резервной копии базы).
 *
 * Настройки направлений, статусы и учётные записи с входом не затрагиваются.
 * Нужен сначала базовый сид (npm run db:seed): он создаёт направления.
 */
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import path from 'node:path';
import { cleanupExampleUsers, prisma, wipeDirection, type Tx } from './lib';
import { importMkd } from './mkd';
import { importNetworks } from './networks';
import { importSchools } from './schools';
import { importStreets } from './streets';
import { importRemarks } from './remarks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IMPORTERS: Record<string, (db: Tx, directionId: number, data: any) => Promise<Record<string, number>>> = {
  schools: importSchools,
  mkd: importMkd,
  networks: importNetworks,
  streets: importStreets,
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const clear = args.includes('--clear');
/** направления, где для наглядности добавляются демо-замечания */
const REMARK_DEMO = ['mkd', 'networks'];
const remarksOnly = args.includes('--remarks');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);

const CLEARED = 'demo.cleared';
async function clearedList(): Promise<string[]> {
  const s = await prisma.appSetting.findUnique({ where: { key: CLEARED } });
  return Array.isArray(s?.value) ? (s.value as string[]) : [];
}
async function setCleared(code: string, on: boolean) {
  const list = new Set(await clearedList());
  if (on) list.add(code);
  else list.delete(code);
  await prisma.appSetting.upsert({ where: { key: CLEARED }, create: { key: CLEARED, value: [...list] }, update: { value: [...list] } });
}

async function main() {
  const cleared = await clearedList();
  const codes = only ?? Object.keys(IMPORTERS);
  for (const code of codes) {
    if (!IMPORTERS[code]) throw new Error(`Неизвестное направление «${code}». Есть: ${Object.keys(IMPORTERS).join(', ')}`);
    const dir = await prisma.direction.findUnique({ where: { code } });
    if (!dir) throw new Error(`Направление «${code}» не найдено — сначала выполните npm run db:seed`);

    const sites = await prisma.site.count({ where: { directionId: dir.id } });
    if (remarksOnly) {
      if (!REMARK_DEMO.includes(code) || cleared.includes(code)) continue;
      if (await prisma.remark.count({ where: { directionId: dir.id } })) {
        console.log(`${dir.shortName}: замечания уже есть — пропущено`);
        continue;
      }
      const n = await prisma.$transaction((tx) => importRemarks(tx, dir.id), { timeout: 120_000 });
      console.log(`${dir.shortName}: демо-замечаний ${n}`);
      continue;
    }
    // защита реальных данных: --force и --clear удаляют всё в направлении, включая внесённое людьми
    const manual =
      (await prisma.progressEntry.count({ where: { source: 'MANUAL', workItem: { site: { directionId: dir.id } } } })) +
      (await prisma.siteReport.count({ where: { source: 'MANUAL', site: { directionId: dir.id } } })) +
      (await prisma.delayReason.count({ where: { period: { directionId: dir.id } } })) +
      (await prisma.reportingPeriod.count({ where: { directionId: dir.id, summary: { not: Prisma.DbNull } } }));
    if ((clear || (force && sites)) && manual && !args.includes('--delete-manual-data')) {
      console.log(
        `${dir.shortName}: есть ${manual} записей, внесённых вручную, — пропущено. ` +
          'Чтобы удалить и их, добавьте --delete-manual-data (сначала сделайте резервную копию базы).',
      );
      continue;
    }
    if (clear) {
      await prisma.$transaction((tx) => wipeDirection(tx, dir.id), { timeout: 600_000 });
      await setCleared(code, true);
      console.log(`${dir.shortName}: данные удалены (было объектов: ${sites})`);
      continue;
    }
    if (cleared.includes(code) && !force) {
      console.log(`${dir.shortName}: демо-данные были удалены (--clear) — не загружаются. Вернуть: --force`);
      continue;
    }
    if (sites && !force) {
      console.log(`${dir.shortName}: уже есть ${sites} объектов — пропущено (перезагрузка: --force)`);
      continue;
    }

    const file = path.join(__dirname, `${code}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const t0 = Date.now();
    const stats = await prisma.$transaction(
      async (tx) => {
        if (sites) await wipeDirection(tx, dir.id);
        const s = await IMPORTERS[code](tx, dir.id, data);
        if (REMARK_DEMO.includes(code)) s.remarks = await importRemarks(tx, dir.id);
        await tx.auditLog.create({
          data: { action: 'IMPORT', entity: 'direction', entityId: String(dir.id), directionId: dir.id, comment: `Загружены демо-данные: ${JSON.stringify(s)}` },
        });
        return s;
      },
      { timeout: 900_000, maxWait: 30_000 },
    );
    const summary = Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ');
    if (cleared.includes(code)) await setCleared(code, false);
    console.log(`${dir.shortName}: ${summary} — ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  }
  const removed = await prisma.$transaction((tx) => cleanupExampleUsers(tx));
  if (removed) console.log(`Удалено демо-сотрудников без привязок: ${removed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
