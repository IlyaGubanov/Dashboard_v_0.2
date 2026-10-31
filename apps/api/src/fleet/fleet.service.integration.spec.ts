import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/request';
import { FleetService } from './fleet.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { Readable } from 'node:stream';

const url = process.env.FLEET_TEST_DATABASE_URL;
const db = url ? new PrismaService({ datasourceUrl: url }) : null;
describe.skipIf(!url)('РЭБ: транзакции, права и жизненные циклы на MySQL', () => {
  let service: FleetService, admin: AuthUser, editor: AuthUser, viewer: AuthUser, outsider: AuthUser, restricted: AuthUser;
  let reb: number, target: number, site: number, vehicle: number, assignment: number, incident: number;
  const suffix = Date.now().toString(36);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1','localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test')) throw new Error('Нужна отдельная локальная БД *_test');
    const d = await db!.fleetRegistry.findUniqueOrThrow({where:{code:'reb'}}); reb=d.id;
    const t = await db!.direction.create({ data: { code: `fleet_${suffix}`, name: 'Направление теста', shortName: 'Тест', periodKind: 'DAY', progressMethod: 'SIMPLE_AVERAGE', planMethod: 'NONE' } }); target=t.id;
    site=(await db!.site.create({ data: { directionId: target, name: 'Объект РЭБ теста', code: 'test' } })).id;
    const users: AuthUser[]=[];
    for (const role of ['ADMIN','USER','USER','USER','USER'] as const) {
      const u=await db!.user.create({ data: { fullName: `РЭБ тест ${suffix} ${users.length}`, globalRole: role } });
      users.push({ id:u.id, fullName:u.fullName, login:null, globalRole:role, mustChangePassword:false, sessionId:0, hiddenSections:[], deniedFeatures:[] });
    }
    [admin,editor,viewer,outsider,restricted]=users; restricted.deniedFeatures=['finance'];
    for(const [u,role] of [[editor,'EDITOR'],[viewer,'VIEWER'],[restricted,'CURATOR']] as const) await db!.fleetMember.create({ data:{ registryId:reb,userId:u.id,role,scope:'ALL' } });
    const access=new AccessService(db!); service=new FleetService(db!,access,new AuditService(db!));
    await db!.fleetFuelType.upsert({ where:{ code:'ДТ' },create:{ code:'ДТ' },update:{} });
  });
  afterAll(async () => { await db?.$disconnect(); });
  it('РЭБ работает независимо от активности производственного направления', async () => {
    const d=await db!.direction.findUnique({where:{code:'reb'}});
    if(!d){await expect(service.refs(admin)).resolves.toMatchObject({canEdit:true});return;}
    try {
      await db!.direction.update({where:{id:d.id},data:{isActive:false}});
      await expect(service.refs(admin)).resolves.toMatchObject({canEdit:true});
    } finally { await db!.direction.update({where:{id:d.id},data:{isActive:d.isActive}}); }
  });
  it('обзор показывает последний месяц топлива и реальную месячную историю', async () => {
    await service.save(admin,'fuel',null,{period:'2026-01',fuelType:'ДТ',category:'Тест месячного учёта '+suffix,liters:'100.00',cost:'1000.00',source:'Тест'},null);
    await service.save(admin,'fuel',null,{period:'2026-02',fuelType:'ДТ',category:'Тест месячного учёта '+suffix,liters:'200.00',cost:'2000.00',source:'Тест'},null);
    const data=await service.overview(admin,{from:'2026-01-01',to:'2026-02-28',category:'Тест месячного учёта '+suffix});
    expect(data.fuel).toMatchObject({period:'2026-02',liters:'200.00',cost:'2000.00'});
    expect(data.fuel).toHaveProperty('monthly', [{period:'2026-01',liters:'100.00',cost:'1000.00'},{period:'2026-02',liters:'200.00',cost:'2000.00'}]);
  });
  it('при переносе ручного топлива освобождает прежнюю комбинацию и защищает новую от дубля',async()=>{
    const category='Проверка ключа '+suffix;
    const body={period:'2025-01',fuelType:'ДТ',category,liters:'10',source:'Ручной ввод'};
    const row=await service.save(admin,'fuel',null,body,null);
    await service.save(admin,'fuel',row.id,{...body,period:'2025-02',version:row.version},null);
    await expect(service.save(admin,'fuel',null,body,null)).resolves.toMatchObject({period:'2025-01'});
    await expect(service.save(admin,'fuel',null,{...body,period:'2025-02'},null)).rejects.toMatchObject({status:409});
  });
  it('запрещает чтение, запись и справочники без членства; наблюдатель не пишет', async () => {
    await expect(service.refs(outsider)).rejects.toMatchObject({ status:403 });
    await expect(service.list(outsider,'vehicles',{})).rejects.toMatchObject({ status:403 });
    await expect(service.save(viewer,'vehicles',null,{name:'ТС',kind:'Грузовая'},null)).rejects.toMatchObject({ status:403 });
  });
  it('назначение самостоятельной роли доступно только администратору',async()=>{
    await expect(service.setMember(viewer,outsider.id,{role:'EDITOR',scope:'ALL'},null)).rejects.toMatchObject({status:403});
    await service.setMember(admin,outsider.id,{role:'VIEWER',scope:'ALL'},null);
    await expect(service.refs(outsider)).resolves.toMatchObject({canEdit:false});
    await service.setMember(admin,outsider.id,{role:null,scope:'ALL'},null);
    await expect(service.refs(outsider)).rejects.toMatchObject({status:403});
  });
  it('сохраняет неизвестную принадлежность, разделяет ремонт и резерв, отклоняет устаревшую версию', async () => {
    const v=await service.save(admin,'vehicles',null,{name:`Самосвал ${suffix}`,kind:'Самосвал',technicalState:'REPAIR',usageState:'RESERVE'},null); vehicle=v.id;
    expect(v).toMatchObject({ownership:'UNKNOWN',technicalState:'REPAIR',usageState:'RESERVE',version:1});
    await service.save(editor,'vehicles',vehicle,{name:`Самосвал ${suffix}`,kind:'Самосвал',technicalState:'OK',usageState:'ACTIVE',version:1},null);
    await expect(service.save(admin,'vehicles',vehicle,{name:'Старые данные',kind:'Самосвал',version:1},null)).rejects.toMatchObject({status:409});
    expect(await db!.auditLog.count({where:{entity:'fleet_vehicles',entityId:String(vehicle)}})).toBe(2);
  });
  it('конкурирующие назначения одной машины не проходят вместе', async () => {
    const input={vehicleId:vehicle,targetDirectionId:target,siteId:site,startDate:'2026-10-01',endDate:'2026-11-01'};
    const results=await Promise.allSettled([service.save(admin,'assignments',null,input,null),service.save(admin,'assignments',null,input,null)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const allocation=await service.analytics(admin,'assignments',{from:'2026-10-01',to:'2026-10-31',kind:'Самосвал',targetDirectionId:target});
    expect(allocation.distribution).toEqual(expect.arrayContaining([expect.objectContaining({group:'kind',label:'Самосвал',quantity:1})]));
    const ok=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<{id:number}>; assignment=ok.value.id;
    await expect(service.save(admin,'assignments',null,{...input,targetDirectionId:99999999},null)).rejects.toMatchObject({status:400});
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
    const curator={...restricted,deniedFeatures:[]};
    const body={employeeId:editor.id,confirmedAmount:'100',recoveredAmount:'0',evidence:'Акт'};
    await expect(service.saveLiability({...curator,hiddenSections:['people']},incident,body,null)).rejects.toMatchObject({status:403});
    await expect(service.saveLiability(curator,incident,{...body,employeeId:outsider.id},null)).rejects.toMatchObject({status:400});
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
  it('подтверждающий файл доступен самостоятельному куратору РЭБ без роли направления',async()=>{
    const attachments=new AttachmentsService(db!,new AuditService(db!),new AccessService(db!));
    const file=await attachments.upload(admin,'fleet_incidents',incident,'Подтверждение.pdf',Readable.from(Buffer.from('%PDF-1.7\n')),null,'LIABILITY');
    await db!.fleetMember.update({where:{registryId_userId:{registryId:reb,userId:viewer.id}},data:{role:'CURATOR'}});
    try {
      const result=await attachments.open(viewer,file.id); expect(result.headers['Content-Type']).toBe('application/pdf');result.stream.destroy();
      await expect(attachments.open(editor,file.id)).rejects.toMatchObject({status:403});
      await expect(attachments.archive(viewer,file.id,null)).resolves.toMatchObject({ok:true});
    } finally {await db!.fleetMember.update({where:{registryId_userId:{registryId:reb,userId:viewer.id}},data:{role:'VIEWER'}});}
  });
  it('отбор по технике не создаёт ошибку БД в месячном топливе и обзоре',async()=>{
    await expect(service.list(admin,'fuel',{vehicleId:vehicle})).resolves.toHaveProperty('rows');
    await expect(service.list(admin,'vehicles',{vehicleId:vehicle})).resolves.toMatchObject({total:1});
    await expect(service.overview(admin,{vehicleId:vehicle})).resolves.toHaveProperty('fuel');
  });
  it('исторический срез не порождает фиктивные автомобили', async () => {
    const before=await db!.fleetVehicle.count();
    await service.save(admin,'snapshots',null,{asOfDate:'2026-10-30',source:`Справка ${suffix}`,total:252,used:239,unused:13,breakdown:[{label:'Благоустройство',quantity:210},{label:'Школы',quantity:27},{label:'Капремонт',quantity:2}]},null);
    expect(await db!.fleetVehicle.count()).toBe(before);
    const k=await service.overview(admin,{}); expect(k).not.toHaveProperty('snapshot'); expect(await db!.fleetSnapshot.count({where:{directionId:reb,source:`Справка ${suffix}`}})).toBe(1);
    expect(k.counts?.total).toBeLessThan(252);
  });
  it('сервер проверяет и старую, и новую область EDITOR при переносе записи',async()=>{
    const u=await db!.user.create({data:{fullName:'Сотрудник с ограниченной областью '+suffix}});
    await db!.fleetMember.create({data:{registryId:reb,userId:u.id,role:'EDITOR',scope:'SITES'}});
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
