import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import type { AuthUser } from '../common/request';
import { FleetService } from './fleet.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { Readable } from 'node:stream';
import { FleetImportService } from './fleet-import.service';
import { workbookFixture } from './fleet-test-fixtures';

const url = process.env.FLEET_TEST_DATABASE_URL;
const db = url ? new PrismaService({ datasourceUrl: url }) : null;
describe.skipIf(!url)('РЭБ: транзакции, права и жизненные циклы на MySQL', () => {
  let service: FleetService, admin: AuthUser, editor: AuthUser, viewer: AuthUser, outsider: AuthUser, restricted: AuthUser;
  let reb: number, target: number, site: number, vehicle: number, assignment: number, incident: number;
  const suffix = Date.now().toString(36);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1','localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test')) throw new Error('Нужна отдельная локальная БД *_test');
    const d = await db!.direction.upsert({ where: { code: 'reb' }, update: {}, create: { code: 'reb', name: 'РЭБ', shortName: 'РЭБ', periodKind: 'REPORT', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } }); reb = d.id;
    const t = await db!.direction.create({ data: { code: `fleet_${suffix}`, name: 'Направление теста', shortName: 'Тест', periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } }); target=t.id;
    site=(await db!.site.create({ data: { directionId: target, name: 'Объект РЭБ теста', code: 'test' } })).id;
    const users: AuthUser[]=[];
    for (const role of ['ADMIN','USER','USER','USER','USER'] as const) {
      const u=await db!.user.create({ data: { fullName: `РЭБ тест ${suffix} ${users.length}`, globalRole: role } });
      users.push({ id:u.id, fullName:u.fullName, login:null, globalRole:role, mustChangePassword:false, sessionId:0, hiddenSections:[], deniedFeatures:[] });
    }
    [admin,editor,viewer,outsider,restricted]=users; restricted.deniedFeatures=['finance'];
    for(const [u,role] of [[editor,'EDITOR'],[viewer,'VIEWER'],[restricted,'CURATOR']] as const) await db!.directionMember.create({ data:{ directionId:reb,userId:u.id,role,scope:'ALL' } });
    const access=new AccessService(db!); service=new FleetService(db!,access,new AuditService(db!),new KpiService(db!,access));
    await db!.fleetFuelType.upsert({ where:{ code:'ДТ' },create:{ code:'ДТ' },update:{} });
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('запрещает чтение, запись и справочники без членства; наблюдатель не пишет', async () => {
    await expect(service.refs(outsider)).rejects.toMatchObject({ status:403 });
    await expect(service.list(outsider,'vehicles',{})).rejects.toMatchObject({ status:403 });
    await expect(service.save(viewer,'vehicles',null,{name:'ТС',kind:'Грузовая'},null)).rejects.toMatchObject({ status:403 });
  });
  it('сохраняет неизвестную принадлежность, разделяет ремонт и резерв, отклоняет устаревшую версию', async () => {
    const v=await service.save(admin,'vehicles',null,{name:`Самосвал ${suffix}`,kind:'Самосвал',technicalState:'REPAIR',usageState:'RESERVE'},null); vehicle=v.id;
    expect(v).toMatchObject({ownership:'UNKNOWN',technicalState:'REPAIR',usageState:'RESERVE',version:1});
    await service.save(editor,'vehicles',vehicle,{name:`Самосвал ${suffix}`,kind:'Самосвал',technicalState:'OK',usageState:'ACTIVE',version:1},null);
    await expect(service.save(admin,'vehicles',vehicle,{name:'Старые данные',kind:'Самосвал',version:1},null)).rejects.toMatchObject({status:409});
    expect(await db!.auditLog.count({where:{directionId:reb,entity:'fleet_vehicles',entityId:String(vehicle)}})).toBe(2);
  });
  it('конкурирующие назначения одной машины не проходят вместе', async () => {
    const input={vehicleId:vehicle,targetDirectionId:target,siteId:site,startDate:'2026-10-01',endDate:'2026-11-01'};
    const results=await Promise.allSettled([service.save(admin,'assignments',null,input,null),service.save(admin,'assignments',null,input,null)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const ok=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<{id:number}>; assignment=ok.value.id;
    await expect(service.save(admin,'assignments',null,{...input,targetDirectionId:reb},null)).rejects.toMatchObject({status:400});
  });
  it('связывает заявку с назначением и сохраняет причину отмены и повторное открытие', async () => {
    const body={requestDate:'2026-10-01',kind:'Самосвал',quantity:2,workPurpose:'Вывоз грунта',reason:'План работ',startDate:'2026-10-01',endDate:'2026-11-01',targetDirectionId:target,siteId:site,allocationIds:[assignment],status:'FULFILLED'};
    const r=await service.save(admin,'requests',null,body,null);
    expect(r).toMatchObject({status:'PARTIAL',allocated:1,remaining:1});
    await expect(service.save(admin,'requests',r.id,{...body,version:r.version,status:'CANCELLED'},null)).rejects.toMatchObject({status:400});
    const cancelled=await service.save(admin,'requests',r.id,{...body,version:r.version,status:'CANCELLED',decisionReason:'Работы перенесены'},null);
    const opened=await service.save(admin,'requests',r.id,{...body,version:cancelled.version,status:'REVIEW'},null);
    expect(opened.status).toBe('PARTIAL');
    await expect(service.archive(admin,'assignments',assignment,1,true,null)).rejects.toMatchObject({status:409});
  });
  it('финансы скрыты и запрещены для записи, история тоже не раскрывает суммы', async () => {
    const f=await service.save(admin,'fines',null,{uin:`000${Date.now()}`,plate:'А001АА77',violation:'Подтверждённое нарушение',amount:'1000.20',paidAmount:'500.10',status:'PARTIAL',paidDate:'2026-10-30'},null);
    const list=await service.list(restricted,'fines',{}); expect(list.rows.find(r=>r.id===f.id)).not.toHaveProperty('amount');
    await expect(service.save(restricted,'fines',f.id,{...f,amount:'1.00'},null)).rejects.toMatchObject({status:403});
    const history=await service.history(restricted,'fines',f.id); expect(JSON.stringify(history)).not.toContain('1000.20');
    const summary=await service.overview(restricted,{}); expect(summary.fines).toBeNull();
  });
  it('подтверждённая ответственность доступна куратору с финансами, водитель не становится должником', async () => {
    const row=await service.save(admin,'incidents',null,{vehicleId:vehicle,occurredAt:'2026-10-30T10:00:00+03:00',incidentType:'Столкновение',employeeId:editor.id,damage:'1000.00'},null); incident=row.id;
    expect(await db!.fleetIncidentLiability.count({where:{incidentId:incident}})).toBe(0);
    await expect(service.getLiability(editor,incident)).rejects.toMatchObject({status:403});
    await expect(service.saveLiability(restricted,incident,{employeeId:editor.id,confirmedAmount:'100',recoveredAmount:'0',evidence:'Акт'},null)).rejects.toMatchObject({status:403});
    const liability=await service.saveLiability(admin,incident,{employeeId:editor.id,confirmedAmount:'100.50',recoveredAmount:'20.10',evidence:'Подтверждённый акт'},null);
    expect(liability.balance).toBe('80.40');
  });
  it('закрытие простоя возвращает ту же единицу, старые записи остаются', async () => {
    const r=await service.save(admin,'downtime',null,{vehicleId:vehicle,reason:'REPAIR',startDate:'2026-11-01',expectedReturn:'2026-11-05'},null);
    const v=await service.card(admin,'vehicles',vehicle); expect(v.technicalState).toBe('OK');
    await service.save(admin,'downtime',r.id,{vehicleId:vehicle,reason:'REPAIR',startDate:'2026-11-01',endDate:'2026-11-05',version:r.version},null);
    expect(await db!.fleetDowntime.count({where:{id:r.id}})).toBe(1);
    expect(await db!.fleetVehicle.count({where:{id:vehicle}})).toBe(1);
  });
  it('будущий и исторический простой не меняют текущее состояние техники', async () => {
    const v=await service.save(admin,'vehicles',null,{name:'Проверка времён '+suffix,kind:'Самосвал',technicalState:'OK',usageState:'RESERVE'},null);
    await service.save(admin,'downtime',null,{vehicleId:v.id,reason:'REPAIR',startDate:'2099-01-01'},null);
    await service.save(admin,'downtime',null,{vehicleId:v.id,reason:'FAULTY',startDate:'2020-01-01',endDate:'2020-01-02'},null);
    expect(await service.card(admin,'vehicles',v.id)).toMatchObject({technicalState:'OK',usageState:'RESERVE'});
  });
  it('refs не отдаёт несвязанных сотрудников и их телефоны',async()=>{
    await db!.user.update({where:{id:outsider.id},data:{phone:'+79991234567'}});
    const refs=await service.refs(viewer);
    expect(refs.users.some(u=>u.id===outsider.id)).toBe(false);
  });
  it('закрытый финансовый файл ДТП не раскрывается через список, скачивание и журнал',async()=>{
    const access=new AccessService(db!); const attachments=new AttachmentsService(db!,new AuditService(db!),access);
    const file=await attachments.upload(admin,'fleet_incidents',incident,'Конфиденциальная_смета.pdf',Readable.from(Buffer.from('%PDF-1.7\n')),null,'FINANCE');
    const list=await attachments.list(restricted,'fleet_incidents',incident);
    expect(list.files.some(f=>f.id===file.id)).toBe(false);
    await expect(attachments.open(restricted,file.id)).rejects.toMatchObject({status:403});
    expect(await db!.auditLog.count({where:{directionId:reb,entity:'attachment',entityId:String(file.id)}})).toBe(0);
  });
  it('исторический срез не порождает фиктивные автомобили', async () => {
    const before=await db!.fleetVehicle.count();
    await service.save(admin,'snapshots',null,{asOfDate:'2026-10-30',source:`Справка ${suffix}`,total:252,used:239,unused:13,breakdown:[{label:'Благоустройство',quantity:210},{label:'Школы',quantity:27},{label:'Капремонт',quantity:2}]},null);
    expect(await db!.fleetVehicle.count()).toBe(before);
    const k=await service.overview(admin,{}); expect(k.snapshot).toMatchObject({total:252,used:239});
    expect(k.counts?.total).toBeLessThan(252);
  });
  it('dry-run не пишет в БД; повторный импорт не затирает ручную правку',async()=>{
    const access=new AccessService(db!),imports=new FleetImportService(db!,access,service),uin='000'+Date.now();
    const buffer=workbookFixture([['УИН','Госномер','Сумма','Нарушение','Дата','Статус'],[uin,'А001АА77','1000.10','Подтверждённое нарушение','30.10.2026','оплачен']]);
    await expect(imports.upload(viewer,'source.xlsx',buffer)).rejects.toMatchObject({status:403});
    const counts=[await db!.fleetFine.count(),await db!.fleetImportBatch.count()];
    const uploaded=await imports.upload(admin,'source.xlsx',buffer),body={uploadId:uploaded.uploadId,kind:'fines',sheet:'штрафы',headerRow:1,mapping:{uin:1,plate:2,amount:3,violation:4,violationDate:5,sourceStatus:6}};
    const preview=await imports.preview(admin,body);
    expect(preview.ready).toBe(1);expect([await db!.fleetFine.count(),await db!.fleetImportBatch.count()]).toEqual(counts);
    await expect(imports.preview(outsider,body)).rejects.toMatchObject({status:403});
    await expect(imports.commit(admin,{uploadId:uploaded.uploadId,previewId:preview.previewId,rows:[2],acknowledgeWarnings:false},null)).rejects.toMatchObject({status:400});
    const saved=await imports.commit(admin,{uploadId:uploaded.uploadId,previewId:preview.previewId,rows:[2],acknowledgeWarnings:true},null);expect(saved.imported).toBe(1);
    const fine=await db!.fleetFine.findFirstOrThrow({where:{uin}});expect(fine).toMatchObject({uin,paidAmount:null,status:'REVIEW',sourceStatus:'оплачен'});
    await service.save(admin,'fines',fine.id,{uin,plate:'А001АА77',amount:'1000.10',violation:'Подтверждённое нарушение',note:'Ручная проверка',version:fine.version},null);
    const again=await imports.upload(admin,'повтор.xlsx',buffer),p=await imports.preview(admin,{...body,uploadId:again.uploadId});
    expect(p.ready).toBe(0);expect((p.rows as {duplicate:boolean}[])[0].duplicate).toBe(true);
    expect((await db!.fleetFine.findUniqueOrThrow({where:{id:fine.id}})).note).toBe('Ручная проверка');
  });
  it('сервер проверяет и старую, и новую область EDITOR при переносе записи',async()=>{
    const u=await db!.user.create({data:{fullName:'Сотрудник с ограниченной областью '+suffix}});
    await db!.directionMember.create({data:{directionId:reb,userId:u.id,role:'EDITOR',scope:'SITES'}});
    await db!.directionMember.create({data:{directionId:target,userId:u.id,role:'EDITOR',scope:'SITES'}});
    await db!.siteAssignment.create({data:{siteId:site,userId:u.id,role:'ENTRY'}});
    const other=await db!.site.create({data:{directionId:target,name:'Недоступный объект',code:'limited-'+suffix}});
    const scoped={...editor,id:u.id};
    const input={requestDate:'2026-10-01',kind:'Самосвал',quantity:1,workPurpose:'Вывоз грунта',reason:'Работы',startDate:'2026-10-01',endDate:'2026-11-01',siteId:site,targetDirectionId:target};
    const request=await service.save(scoped,'requests',null,input,null);
    await expect(service.save(scoped,'requests',request.id,{...input,siteId:other.id,version:request.version},null)).rejects.toMatchObject({status:403});
    expect((await db!.fleetRequest.findUniqueOrThrow({where:{id:request.id}})).siteId).toBe(site);
  });
});
