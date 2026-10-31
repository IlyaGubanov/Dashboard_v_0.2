import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import { EntryService } from './entry.service';
import { RemarksService } from '../remarks/remarks.service';
import type { AuthUser } from '../common/request';

const url = process.env.REPORT_TEST_DATABASE_URL;
const db = url ? new PrismaService({ datasourceUrl: url }) : null;
describe.skipIf(!url)('отчётные программы: ввод, история и защита', () => {
  let dirId: number, siteId: number, otherSiteId: number, itemId: number, oldId: number, userId: number, editorId: number;
  let admin: AuthUser, editor: AuthUser, entry: EntryService, kpi: KpiService;
  const code = `qa_report_${Date.now().toString(36)}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost','127.0.0.1'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('Только локальная тестовая БД');
    const d = await db!.direction.create({ data: { code, name: 'Отчётный тест', shortName: 'Тест', periodKind: 'REPORT', progressMethod: 'SHARE_COMPLETED', planMethod: 'NONE', settings: { programs: { kbu: 'КБУ', current: 'Текущий ремонт', future: 'Новая программа' }, kpis: [{metric:'remarksTotal',label:'Замечаний в отчёте'}, { metric: 'reportStatusCount', label: 'По статусу', params: { statuses: ['Работы завершены', 'Сдан ЦККБ'] } }] } } }); dirId = d.id;
    userId = (await db!.user.create({ data: { fullName: 'QA администратор' } })).id;
    editorId = (await db!.user.create({ data: { fullName: 'QA ввод' } })).id;
    admin = { id: userId, login: 'qa', fullName: 'QA', globalRole: 'ADMIN', sessionId: -1, mustChangePassword: false, hiddenSections: [], deniedFeatures: [] };
    editor = { ...admin, id: editorId, globalRole: 'USER' };
    const section = await db!.section.create({ data: { directionId: dirId, code: 'kbu', name: 'КБУ' } });
    const other = await db!.section.create({ data: { directionId: dirId, code: 'current', name: 'Текущий ремонт' } });
    const wt = await db!.workType.create({ data: { directionId: dirId, code: 'w', name: 'Покрытие', unit: 'м²' } });
    const s = await db!.site.create({ data: { directionId: dirId, code: 'a', name: 'Улица А', sectionId: section.id, workItems: { create: { workTypeId: wt.id, code: 'w', unit: 'м²', planQty: 10 } }, assignments: { create: { userId: editorId, role: 'ENTRY' } } }, include: { workItems: true } });
    siteId = s.id; itemId = s.workItems[0].id;
    otherSiteId = (await db!.site.create({ data: { directionId: dirId, code: 'b', name: 'Улица Б', sectionId: other.id } })).id;
    await db!.directionMember.create({ data: { userId: editorId, directionId: dirId, role: 'EDITOR', scope: 'SITES' } });
    oldId = (await db!.reportingPeriod.create({ data: { directionId: dirId, program: 'kbu', date: new Date('2026-01-01'), label: 'Исходный лист', status: 'LOCKED' } })).id;
    await db!.progressEntry.create({ data: { workItemId: itemId, periodId: oldId, factQty: 5, source: 'IMPORT', attrs: { p: 10, a: 4 } } });
    await db!.siteReport.create({ data: { siteId, periodId: oldId, workers: 3, remarksCount: 2, statusText: 'В работе', source: 'IMPORT' } });
    await db!.siteReport.create({ data: { siteId: otherSiteId, periodId: oldId, source: 'IMPORT' } });
    const access = new AccessService(db!); kpi = new KpiService(db!, access); entry = new EntryService(db!, new AuditService(db!), access, kpi);
  });
  afterAll(async () => {
    if (dirId) await db!.direction.delete({ where: { id: dirId } });
    if (userId) await db!.user.deleteMany({ where: { id: { in: [userId, editorId] } } });
    await db?.$disconnect();
  });
  it('исторический заблокированный отчёт требует явного открытия даже у администратора', async () => {
    expect((await entry.sheet(admin, code, oldId)).permissions.canEdit).toBe(false);
    await expect(entry.save(admin, code, oldId, { items: [], reports: [{ siteId, workers: 4, version: 1 }] }, null)).rejects.toThrow();
  });
  it('новые периоды различаются программой, неизвестные программы и неверные даты отклоняются', async () => {
    const a = await entry.openPeriod(admin, code, '2026-01-02', null, 'kbu');
    const b = await entry.openPeriod(admin, code, '2026-01-02', null, 'future');
    expect((await db!.reportingPeriod.findUniqueOrThrow({ where: { id: a.id } })).program).toBe('kbu');
    expect(b.id).not.toBe(a.id);
    await expect(entry.openPeriod(admin, code, '2026-02-31', null, 'kbu')).rejects.toThrow();
    await expect(entry.openPeriod(admin, code, '2026-01-03', null, 'unknown')).rejects.toThrow();
  });
  it('лист выбранной программы показывает её объекты, ресурсы и переносимые объёмы', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-04', null, 'kbu');
    const sheet = await entry.sheet(editor, code, p.id);
    expect(sheet.period).toMatchObject({ program: 'kbu' });
    expect(sheet.sites.map(s => s.id)).toEqual([siteId]);
    expect(sheet.fields.workers).toBe(true);
    expect((await entry.sheet(admin, code, p.id)).aggregate).toMatchObject({ version: 0, value: null, canEdit: true });
    expect(sheet.sites[0].items[0]).toMatchObject({ planQty: 10, value: { factQty: 5 } });
  });
  it('сохраняет новый ручной отчёт, обновляет KPI/аудит и сохраняет исходный импорт', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-05', null, 'kbu');
    await kpi.kpi(admin, code);
    await entry.save(editor, code, p.id, { items: [{ workItemId: itemId, factQty: 10 }], reports: [{ siteId, workers: 8, machines: 0, statusText: 'Работы завершены', remarksCount: 1 }] }, null);
    expect((await kpi.sites(admin, code)).find(s => s.id === siteId)).toMatchObject({ fact: 1, people: 8, tech: 0 });
    const report = await db!.siteReport.findUniqueOrThrow({ where: { siteId_periodId: { siteId, periodId: p.id } } });
    expect(report).toMatchObject({ statusText: 'Работы завершены', remarksCount: 1, source: 'MANUAL' });
    expect((await entry.sheet(editor, code, p.id)).sites[0].report.value).toMatchObject({ workers: 8, machines: 0 });
    expect(await db!.auditLog.count({ where: { directionId: dirId, siteId } })).toBeGreaterThanOrEqual(2);
    expect(await db!.progressEntry.findUniqueOrThrow({ where: { workItemId_periodId: { workItemId: itemId, periodId: oldId } } })).toMatchObject({ source: 'IMPORT', factQty: expect.anything(), attrs: { p: 10, a: 4 } });
    await expect(entry.save(editor, code, p.id, { items: [{ workItemId: itemId, factQty: 7, version: 99 }], reports: [] }, null)).rejects.toThrow();
    await expect(entry.save({ ...editor, id: userId }, code, p.id, { items: [], reports: [{ siteId, workers: 0 }] }, null)).rejects.toThrow();
  });
  it('не принимает объект другой программы и не открывает закрытые отчёты переключением readonly', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-06', null, 'kbu');
    await expect(entry.save(admin, code, p.id, { items: [], reports: [{ siteId: otherSiteId, workers: 1 }] }, null)).rejects.toThrow();
    await entry.setPeriodStatus(admin, code, p.id, 'CLOSED', undefined, null);
    await db!.direction.update({ where: { id: dirId }, data: { isReadonly: true } });
    await db!.direction.update({ where: { id: dirId }, data: { isReadonly: false } });
    expect((await entry.sheet(admin, code, p.id)).permissions.canEdit).toBe(false);
  });
  it('повторный seed сохраняет разрешение ввода', async () => {
    const before = await db!.direction.findUniqueOrThrow({ where: { code: 'streets' } });
    try {
      await db!.direction.update({ where: { code: 'streets' }, data: { isReadonly: false } });
      const root = resolve(process.cwd(), '../..');
      execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'apps/api/prisma/seed.ts')], { env: { ...process.env, DATABASE_URL: url! }, timeout: 30000 });
      expect((await db!.direction.findUniqueOrThrow({ where: { code: 'streets' } })).isReadonly).toBe(false);
    } finally { await db!.direction.update({ where: { code: 'streets' }, data: { isReadonly: before.isReadonly } }); }
  }, 30000);
  it('различает выполнение по объёмам и отчётному статусу без подгонки формул', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-07', null, 'kbu');
    const other = await db!.site.create({ data: { directionId: dirId, code: 'c', name: 'Улица В', sectionId: (await db!.site.findUniqueOrThrow({ where: { id: siteId } })).sectionId } });
    const item = await db!.workItem.create({ data: { siteId: other.id, code: 'c', workTypeId: (await db!.workItem.findUniqueOrThrow({ where: { id: itemId } })).workTypeId, planQty: 10 } });
    await entry.save(admin, code, p.id, { items: [{ workItemId: itemId, factQty: 5 }, { workItemId: item.id, factQty: 10 }], reports: [{ siteId, statusText: 'Работы завершены', remarksCount: 3 }, { siteId: other.id, statusText: 'В работе' }] }, null);
    const data = await kpi.kpi(admin, code);
    const summary = data.reportPrograms?.find(p => p.code === 'kbu');
    expect(summary).toMatchObject({ asOf: '2026-01-07', volumeDone: 1, volumeTotal: 2, statusDone: 1, statusTotal: 2 });
    expect(summary?.rows.find(s => s.id === siteId)).toMatchObject({ volumeDone: false, statusDone: true, remarksCount: 3, source: 'MANUAL' });
    expect(summary?.rows.find(s => s.id === other.id)).toMatchObject({ volumeDone: true, statusDone: false });
    expect(data.fact).toBe(0.5);
    expect(data.kpis.some(m=>m.key==='remarksTotal')).toBe(true);
    const hidden=await kpi.kpi({...admin,hiddenSections:['remarks']},code);
    expect(hidden.kpis.some(m=>m.key==='remarksTotal')).toBe(false);
  });
  it('реестр, карта и карточка получают собственную программу объекта', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-08', null, 'current');
    await entry.save(admin, code, p.id, { items: [], reports: [{ siteId: otherSiteId, workers: 11, machines: 2 }] }, null);
    expect((await kpi.sites(admin, code)).find(s => s.id === otherSiteId)).toMatchObject({ people: 11, tech: 2 });
    expect(await kpi.siteCard(admin, code, otherSiteId)).toMatchObject({ asOf: '2026-01-08', row: { people: 11, tech: 2 } });
  });
  it('ЦККБ регистрируется настоящим Remark с отдельными источником, датой и ответственным', async () => {
    const access = new AccessService(db!); const remarks = new RemarksService(db!, new AuditService(db!), access, kpi);
    const result = await remarks.create(admin, code, { siteId, text: 'Реальное тестовое нарушение', severity: 'HIGH', sourceName: 'ЦККБ', detectedOn: '2026-01-05', responsibleId: editorId, assigneeId: editorId, violationGroup: 'TECHNOLOGY', violationType: 'curb_base' }, null);
    expect(await remarks.card(admin, code, result.id)).toMatchObject({ sourceName: 'ЦККБ', detectedOn: '2026-01-05', responsible: { id: editorId }, assignee: { id: editorId } });
    expect((await db!.auditLog.findFirstOrThrow({where:{directionId:dirId,entity:'remark',action:'CREATE'},orderBy:{id:'desc'}})).after).toMatchObject({violationGroup:'TECHNOLOGY',violationType:'curb_base'});
    expect(await db!.remark.count({ where: { directionId: dirId } })).toBe(1);
    await expect(remarks.update(admin, code, result.id, { siteId, text: 'Попытка неполной классификации', severity: 'HIGH', violationType: null }, null)).rejects.toThrow();
    expect((await db!.siteReport.findUniqueOrThrow({ where: { siteId_periodId: { siteId, periodId: oldId } } })).remarksCount).toBe(2);
    await expect(remarks.create({ ...admin, deniedFeatures: ['remarksCreate'] }, code, { siteId, text: 'Запрещённое нарушение', severity: 'HIGH' }, null)).rejects.toThrow();
  });
  it('две одновременные правки одной версии не теряют данные', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-09', null, 'kbu');
    await entry.save(admin, code, p.id, { items: [{ workItemId: itemId, factQty: 1 }], reports: [] }, null);
    const results = await Promise.allSettled([2,3].map(factQty => entry.save(admin, code, p.id, { items: [{ workItemId: itemId, factQty, version: 1 }], reports: [] }, null)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('хранит сводку источника отдельно от объектов, защищает версию и права', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-10', null, 'kbu');
    const value = { scope: 'ORGANIZATION' as const, organization: 'Тестовая организация', source: 'Презентация ЦККБ', page: 9, areaHa: 3.5,
      objects: { total: 30, scheduled: 30, started: 30, completed: 19, commissioned: null }, resources: { people: null, tech: 0 }, systems: [], volumes: [],
      violations: [{ group: 'DOCUMENTATION' as const, type: 'missing_work_log', total: 8, resolved: 3, controlled: 5 }] };
    await expect(entry.saveSummary(editor, code, p.id, { version: 0, value }, null)).rejects.toThrow();
    await entry.saveSummary(admin, code, p.id, { version: 0, value }, null);
    expect((await entry.sheet(admin, code, p.id)).aggregate).toMatchObject({ version: 1, value });
    expect((await kpi.kpi(admin, code)).reportPrograms?.find(p => p.code === 'kbu')?.aggregate).toEqual(value);
    await expect(entry.saveSummary(admin, code, p.id, { version: 0, value }, null)).rejects.toThrow();
    expect((await entry.sheet({ ...admin, hiddenSections: ['remarks'] }, code, p.id)).aggregate?.value?.violations).toEqual([]);
    expect(await db!.remark.count({ where: { directionId: dirId } })).toBe(1);
  });
  it('скрытые отчётные замечания не выдаются и не перезаписываются через лист ввода', async () => {
    const p = await entry.openPeriod(admin, code, '2026-01-11', null, 'kbu');
    const restricted = { ...editor, hiddenSections: ['remarks' as const] };
    const sheet = await entry.sheet(restricted, code, p.id);
    expect(sheet.fields.reportRemarks).toBe(false);
    expect(sheet.sites.find(s=>s.id===siteId)?.report.value.remarksCount).toBeNull();
    await entry.save(restricted, code, p.id, { items: [], reports: [{ siteId, workers: 9, remarksCount: 99 }] }, null);
    expect((await db!.siteReport.findUniqueOrThrow({where:{siteId_periodId:{siteId,periodId:p.id}}})).remarksCount).toBeNull();
  });
  it('аудит правки импорта показывает настоящие источник, дату и сохранённые атрибуты', async () => {
    await entry.setPeriodStatus(admin, code, oldId, 'OPEN', 'Явное открытие истории', null);
    await entry.save(admin, code, oldId, { items: [{ workItemId: itemId, version: 1, factQty: 6 }], reports: [] }, null);
    const log = await db!.auditLog.findFirstOrThrow({ where: { directionId: dirId, entity: 'progress_entry' }, orderBy: { id: 'desc' } });
    expect(log.before).toMatchObject({ source: 'IMPORT', program: 'kbu', date: '2026-01-01', attrs: { p: 10, a: 4 } });
    expect(log.after).toMatchObject({ source: 'MANUAL', program: 'kbu', date: '2026-01-01', attrs: { p: 10, a: 4 } });
  });
  it('импорт не удаляет направление, в котором вручную внесена только сводка источника', async () => {
    const real = await db!.direction.findUniqueOrThrow({where:{code:'streets'}});
    const previousCleared = await db!.appSetting.findUnique({where:{key:'demo.cleared'}});
    const holder = `qa_saved_${Date.now().toString(36)}`;
    const fixture = await db!.direction.create({data:{code:`qa_summary_${Date.now().toString(36)}`,name:'Тест защиты',shortName:'Тест',periodKind:'REPORT',progressMethod:'SHARE_COMPLETED',planMethod:'NONE'}});
    const period = await db!.reportingPeriod.create({data:{directionId:fixture.id,program:'kbu',date:new Date('2026-01-01'),summary:{version:1,value:{source:'Ручная сводка'}}}});
    try {
      await db!.direction.update({where:{id:real.id},data:{code:holder}});
      await db!.direction.update({where:{id:fixture.id},data:{code:'streets'}});
      const root=resolve(process.cwd(),'../..');
      execFileSync(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),resolve(root,'apps/api/prisma/demo/import.ts'),'--clear','--only=streets'],{env:{...process.env,DATABASE_URL:url!},timeout:30000});
      expect(await db!.reportingPeriod.findUnique({where:{id:period.id}})).not.toBeNull();
    } finally {
      await db!.direction.delete({where:{id:fixture.id}});
      await db!.direction.update({where:{id:real.id},data:{code:'streets'}});
      if(previousCleared)await db!.appSetting.upsert({where:{key:'demo.cleared'},create:{key:'demo.cleared',value:previousCleared.value??Prisma.JsonNull},update:{value:previousCleared.value??Prisma.JsonNull}});
      else await db!.appSetting.deleteMany({where:{key:'demo.cleared'}});
    }
  },30000);
  it('перенос отчётного снимка сохраняет неизвестный проектный объём и знаменатель готовности',async()=>{
    const original=await db!.workItem.findUniqueOrThrow({where:{id:itemId},include:{site:true}});
    const site=await db!.site.create({data:{directionId:dirId,code:'unknown-plan',name:'Срез с неизвестными планами',sectionId:original.site.sectionId}});
    const items=[];
    for(const code of ['known','absent','null']){
      const item=await db!.workItem.create({data:{siteId:site.id,workTypeId:original.workTypeId,code,planQty:10}});items.push(item);
      await db!.progressEntry.create({data:{workItemId:item.id,periodId:oldId,factQty:code==='known'?10:0,source:'IMPORT',attrs:code==='known'?{p:10}:code==='null'?{p:null}:{a:4}}});
    }
    await db!.siteReport.create({data:{siteId:site.id,periodId:oldId,workers:3,source:'IMPORT'}});
    kpi.invalidate(dirId);
    expect((await kpi.siteCard(admin,code,site.id,'2026-01-01')).row.fact).toBe(1);
    const p=await entry.openPeriod(admin,code,'2026-01-12',null,'kbu');
    const displayed=(await entry.sheet(admin,code,p.id)).sites.find(s=>s.id===site.id)!;
    expect(displayed.items.filter(i=>i.id!==items[0].id).map(i=>i.planQty)).toEqual([null,null]);
    await entry.save(admin,code,p.id,{items:displayed.items.map(i=>({workItemId:i.id,...i.value})),reports:[{siteId:site.id,workers:9}]},null);
    expect((await kpi.siteCard(admin,code,site.id)).row.fact).toBe(1);
    for(const item of items.slice(1))expect((await db!.progressEntry.findUniqueOrThrow({where:{workItemId_periodId:{workItemId:item.id,periodId:p.id}}})).attrs).toMatchObject({p:null});
  });
});