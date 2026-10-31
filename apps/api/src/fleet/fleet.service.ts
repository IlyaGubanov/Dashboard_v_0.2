import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { FLEET_SCHEMAS, liabilitySchema, type FleetKind, type FleetList, type FleetOverview, type FleetRefs, type FleetRow } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { KpiService } from '../kpi/kpi.service';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthUser } from '../common/request';
import { decimalSum, fleetCounts, fuelDifference, overlaps, paymentTotals, requestStatus } from './fleet-domain';
import { dbData, MONEY_FIELDS, redactFleet, store, wire, type DbRow } from './fleet-store';

export type FleetFilter = { from?: string; to?: string; q?: string; ownership?: string; kind?: string; status?: string; departmentId?: number; targetDirectionId?: number; vehicleId?: number; archived?: boolean; page?: number; take?: number; sort?: string; order?: 'asc'|'desc'; active?: boolean };
const day = (v: unknown) => v instanceof Date ? v.toISOString().slice(0,10) : String(v ?? '').slice(0,10);
export const fleetHash = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class FleetService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly kpi: KpiService) {}

  async direction(user: AuthUser, write = false) {
    this.access.assertSection(user,'fleet');
    const d=await this.prisma.direction.findUnique({where:{code:'reb'}});
    if (!d?.isActive) throw new NotFoundException('Направление РЭБ не найдено или выключено');
    await this.access.assertViewDirection(user,d.id);
    if (write && d.isReadonly) throw new ForbiddenException('Направление доступно только для просмотра');
    return d;
  }

  async assertWrite(user: AuthUser, directionId: number, row?: Record<string,unknown>, manage=false) {
    if (await this.access.canManageDirection(user,directionId)) return;
    if (!manage) {
      const m=await this.access.membership(user,directionId);
      if (m?.role==='EDITOR' && (m.scope==='ALL' || (typeof row?.siteId==='number' && await this.access.canEditSite(user,row.siteId)))) return;
    }
    throw new ForbiddenException(manage?'Нужны права куратора РЭБ':'Нет прав на изменение этой записи РЭБ');
  }

  async refs(user: AuthUser): Promise<FleetRefs> {
    const d=await this.direction(user);
    const [directions, users, departments, organizations, vehicles, assignments, types, membership, manage]=await Promise.all([
      this.prisma.direction.findMany({where:{isActive:true,...(user.globalRole==='USER'?{members:{some:{userId:user.id}}}:{})},select:{id:true,name:true}}),
      this.access.canSee(user,'people') ? this.prisma.user.findMany({where:{isActive:true},select:{id:true,fullName:true,position:true,phone:true},orderBy:{fullName:'asc'}}) : Promise.resolve([]),
      this.prisma.department.findMany({where:{isArchived:false},select:{id:true,name:true}}),
      this.prisma.organization.findMany({where:{directionId:d.id},select:{id:true,name:true}}),
      this.prisma.fleetVehicle.findMany({where:{directionId:d.id,isArchived:false},select:{id:true,name:true,plate:true}}),
      this.prisma.fleetAssignment.findMany({where:{directionId:d.id,isArchived:false},include:{vehicle:{select:{name:true,plate:true}}}}),
      this.prisma.fleetFuelType.findMany({orderBy:{code:'asc'}}), this.access.membership(user,d.id), this.access.canManageDirection(user,d.id),
    ]);
    const sites=await this.prisma.site.findMany({where:{isArchived:false,directionId:{in:directions.map(x=>x.id)}},select:{id:true,name:true,directionId:true},orderBy:{name:'asc'}});
    return {directionId:d.id,canEdit:!d.isReadonly&&(manage||membership?.role==='EDITOR'),canManage:manage,canFinance:this.access.has(user,'finance'),canLiability:manage&&this.access.has(user,'finance'),canAudit:this.access.has(user,'audit'),
      directions,users:users.map(u=>({id:u.id,name:u.fullName,position:u.position,phone:u.phone})),departments,organizations,sites,
      vehicles:vehicles.map(v=>({id:v.id,name:`${v.name}${v.plate?' · '+v.plate:''}`})),assignments:assignments.map(a=>({id:a.id,name:`№ ${a.id} · ${a.vehicle.name} · ${day(a.startDate)} — ${a.endDate?day(a.endDate):'без окончания'}`})),fuelTypes:types.map(t=>t.code)};
  }

  async get(user: AuthUser, kind: FleetKind, id: number, db: Prisma.TransactionClient | PrismaService=this.prisma) {
    const d=await this.direction(user);
    const row=await store(db,kind).findFirst({where:{id,directionId:d.id}});
    if(!row) throw new NotFoundException('Запись РЭБ не найдена');
    return row;
  }

  private async enrich(db: Prisma.TransactionClient | PrismaService,kind:FleetKind,rows:DbRow[]) {
    if(kind==='requests') {
      const allocations=await db.fleetAllocation.findMany({where:{requestId:{in:rows.map(r=>r.id)}},select:{requestId:true,assignmentId:true}});
      return rows.map(r=>{const ids=allocations.filter(a=>a.requestId===r.id).map(a=>a.assignmentId);return {...r,allocationIds:ids,allocated:ids.length,remaining:Math.max(0,Number(r.quantity)-ids.length)};});
    }
    return rows;
  }

  private where(kind: FleetKind,directionId:number,q:FleetFilter):Record<string,unknown> {
    const where:Record<string,unknown>={directionId,isArchived:q.archived??false};
    const vehicleWhere:Record<string,unknown>={};
    for(const key of ['ownership','kind','departmentId'] as const) if(q[key]) vehicleWhere[key]=q[key];
    if(kind==='vehicles') Object.assign(where,vehicleWhere);
    else if(Object.keys(vehicleWhere).length && !['fuel','requests','snapshots'].includes(kind)) where.vehicle=vehicleWhere;
    if(q.vehicleId) where[kind==='vehicles'?'id':'vehicleId']=q.vehicleId;
    if(q.targetDirectionId && !['vehicles','fuel','snapshots','downtime'].includes(kind)) where.targetDirectionId=q.targetDirectionId;
    if(q.departmentId && ['requests','incidents','fines','tolls'].includes(kind)) where.departmentId=q.departmentId;
    if(q.status && ['incidents','fines','tolls','requests'].includes(kind)) where.status=q.status;
    if(q.active!==undefined && kind==='requests') where.status=q.active?{notIn:['FULFILLED','CANCELLED','REJECTED']}:{in:['FULFILLED','CANCELLED','REJECTED']};
    const dateKey:Partial<Record<FleetKind,string>>={incidents:'occurredAt',fines:'violationDate',tolls:'passageDate',snapshots:'asOfDate',requests:'requestDate'};
    const key=dateKey[kind];
    if(key&&(q.from||q.to)) where[key]={...(q.from?{gte:new Date(q.from)}:{}),...(q.to?{lt:new Date(new Date(q.to).getTime()+86400000)}:{})};
    if(kind==='fuel'&&(q.from||q.to)) where.period={...(q.from?{gte:q.from.slice(0,7)}:{}),...(q.to?{lte:q.to.slice(0,7)}:{})};
    if(['assignments','downtime'].includes(kind)&&(q.from||q.to)) {
      where.AND=[...(q.to?[{startDate:{lte:new Date(q.to)}}]:[]),...(q.from?[{OR:[{endDate:null},{endDate:{gt:new Date(q.from)}}]}]:[])];
    }
    return where;
  }

  async list(user:AuthUser,kind:FleetKind,q:FleetFilter):Promise<FleetList> {
    const d=await this.direction(user); const finance=this.access.has(user,'finance');
    // Поиск выполняется по разрешённой проекции: скрытая сумма не должна влиять на результаты поиска.
    let rows=await store(this.prisma,kind).findMany({where:this.where(kind,d.id,q),orderBy:{id:'desc'}});
    rows=await this.enrich(this.prisma,kind,rows);
    let result=rows.map(r=>wire(r,finance));
    if(q.q) { const term=q.q.toLocaleLowerCase('ru'); result=result.filter(r=>Object.values(r).filter(v=>typeof v==='string').some(v=>(v as string).toLocaleLowerCase('ru').includes(term))); }
    if(q.sort&&/^[a-zA-Z]+$/.test(q.sort)) {const key=q.sort; result.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''),'ru',{numeric:true})*(q.order==='desc'?-1:1));}
    const total=result.length,take=Math.min(200,Math.max(1,q.take??50)),offset=(Math.max(1,q.page??1)-1)*take;
    return {rows:result.slice(offset,offset+take),total};
  }

  async card(user:AuthUser,kind:FleetKind,id:number) {
    const row=await this.get(user,kind,id); const rows=await this.enrich(this.prisma,kind,[row]);
    return wire(rows[0],this.access.has(user,'finance'));
  }

  private async validateLinks(user:AuthUser,tx:Prisma.TransactionClient,directionId:number,input:Record<string,unknown>) {
    for (const key of ['employeeId','initiatorId'] as const) if(input[key]!=null) {
      if(!this.access.canSee(user,'people')) throw new ForbiddenException('Справочник сотрудников недоступен');
      if(!await tx.user.findFirst({where:{id:Number(input[key]),isActive:true},select:{id:true}})) throw new BadRequestException('Сотрудник не найден или неактивен');
    }
    if(input.departmentId!=null&&!await tx.department.findFirst({where:{id:Number(input.departmentId),isArchived:false}})) throw new BadRequestException('Подразделение не найдено');
    if(input.ownerId!=null&&!await tx.organization.findFirst({where:{id:Number(input.ownerId),directionId}})) throw new BadRequestException('Собственник должен быть из справочника организаций РЭБ');
    if(input.vehicleId!=null) {
      const v=await tx.fleetVehicle.findFirst({where:{id:Number(input.vehicleId),directionId,isArchived:false}});
      if(!v) throw new BadRequestException('Техника не найдена или архивирована');
      if(input.plate&&v.plate&&input.plate!==v.plate) throw new BadRequestException('Госномер не совпадает с выбранной техникой');
      if(!input.plate&&v.plate&&'plate' in input) input.plate=v.plate;
    }
    if(input.targetDirectionId!=null) {
      const target=await tx.direction.findFirst({where:{id:Number(input.targetDirectionId),isActive:true}});
      if(!target) throw new BadRequestException('Направление назначения не найдено');
      await this.access.assertViewDirection(user,target.id);
    }
    if(input.siteId!=null) {
      const s=await tx.site.findFirst({where:{id:Number(input.siteId),isArchived:false}});
      if(!s || (input.targetDirectionId!=null&&s.directionId!==input.targetDirectionId)) throw new BadRequestException('Объект не относится к выбранному направлению');
      await this.access.assertViewDirection(user,s.directionId);
    }
  }

  async save(user:AuthUser,kind:FleetKind,id:number|null,body:unknown,ip:string|null):Promise<FleetRow> {
    const d=await this.direction(user,true); const raw=(body??{}) as Record<string,unknown>;
    const old=id?await this.get(user,kind,id):null;
    await this.assertWrite(user,d.id,old??raw,kind==='snapshots');
    const finance=this.access.has(user,'finance');
    if(!finance&&(['fines','tolls','fuel'].includes(kind)||Object.keys(raw).some(k=>MONEY_FIELDS.has(k)))) throw new ForbiddenException('Нет доступа к финансовым изменениям');
    const parsed=new ZodPipe<Record<string,unknown>>(FLEET_SCHEMAS[kind]).transform(body);
    if(id&&!Number.isInteger(parsed.version)) throw new ConflictException('Передайте версию открытой записи');
    if(old?.isArchived) throw new ConflictException('Сначала восстановите запись из архива');
    try {
      const result=await this.prisma.$transaction(async tx=>this.saveInTransaction(user,tx,kind,id,parsed,ip),{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
      this.kpi.invalidate(d.id); return wire(result,finance);
    } catch(e) { this.dbError(e); }
  }

  /** Используется и ручной формой, и подтверждённым импортом; транзакция принадлежит вызывающему. */
  async saveInTransaction(user:AuthUser,tx:Prisma.TransactionClient,kind:FleetKind,id:number|null,input:Record<string,unknown>,ip:string|null,source?:{batchId:number;key:string;raw:Prisma.InputJsonValue}):Promise<DbRow> {
    const d=await tx.direction.findUniqueOrThrow({where:{code:'reb'}});
    const repo=store(tx,kind);
    const before=id?await repo.findFirst({where:{id,directionId:d.id}}):null;
    if(id&&!before) throw new NotFoundException('Запись не найдена');
    if(before&&before.version!==input.version) throw new ConflictException('Запись изменена другим пользователем. Обновите карточку');
    const values={...input};
    await this.validateLinks(user,tx,d.id,values);
    if(kind==='assignments'||kind==='downtime') {
      // Блокировка одной единицы делает проверку пересечений атомарной при одновременных запросах.
      await tx.$queryRaw`SELECT id FROM fleet_vehicle WHERE id = ${Number(values.vehicleId)} FOR UPDATE`;
      const other=await repo.findMany({where:{vehicleId:values.vehicleId,isArchived:false,...(id?{id:{not:id}}:{})}});
      if(other.some(r=>overlaps(day(r.startDate),r.endDate?day(r.endDate):null,String(values.startDate),values.endDate?String(values.endDate):null))) throw new ConflictException('Период пересекается с существующим '+(kind==='assignments'?'назначением':'простоем'));
    }
    if(kind==='fuel'&&!await tx.fleetFuelType.findUnique({where:{code:String(values.fuelType)}})) throw new BadRequestException('Вид топлива отсутствует в справочнике');
    if(kind==='vehicles'&&id) {
      const open=await tx.fleetDowntime.count({where:{vehicleId:id,isArchived:false,endDate:null}});
      if(open&&(values.usageState==='ACTIVE'||values.technicalState==='OK')) throw new ConflictException('Сначала закройте незавершённый простой');
    }
    const allocationIds=(values.allocationIds??[]) as number[];
    if(kind==='requests') {
      const assignments=await tx.fleetAssignment.findMany({where:{id:{in:allocationIds},directionId:d.id,isArchived:false},include:{vehicle:true}});
      if(assignments.length!==allocationIds.length || new Set(assignments.map(a=>a.vehicleId)).size!==assignments.length) throw new BadRequestException('Нужны разные действующие назначения техники');
      for(const a of assignments) {
        if(a.vehicle.isArchived || a.vehicle.kind!==values.kind || (values.targetDirectionId!=null&&a.targetDirectionId!==values.targetDirectionId) || (values.siteId!=null&&a.siteId!==values.siteId) || day(a.startDate)>String(values.startDate) || (a.endDate&&day(a.endDate)<String(values.endDate))) throw new BadRequestException('Назначение не соответствует виду техники, месту или полному периоду потребности');
      }
      if(assignments.length>Number(values.quantity)) throw new BadRequestException('Выделено больше запрошенного количества');
      values.status=requestStatus(Number(values.quantity),assignments.length,String(values.status));
    }
    if(kind==='assignments'&&id&&await tx.fleetAllocation.count({where:{assignmentId:id}})) throw new ConflictException('Назначение связано с заявкой. Сначала скорректируйте выделение в заявке');
    const data=dbData(values);
    if(kind==='fuel'&&!source&&!before?.sourceKey) data.sourceKey=fleetHash([values.period,values.fuelType,values.category,values.source].join('|'));
    if(source) Object.assign(data,{importBatchId:source.batchId,sourceKey:source.key,sourceRaw:source.raw});
    let row:DbRow;
    if(id) {
      const changed=await repo.updateMany({where:{id,directionId:d.id,version:input.version,isArchived:false},data:{...data,updatedById:user.id,version:{increment:1}}});
      if(changed.count!==1) throw new ConflictException('Запись изменена другим пользователем');
      row=(await repo.findFirst({where:{id}}))!;
    } else row=await repo.create({data:{...data,directionId:d.id,createdById:user.id,updatedById:user.id}});
    if(kind==='requests') {
      const prev=before?await tx.fleetAllocation.findMany({where:{requestId:row.id}}):[];
      if(before) before.allocationIds=prev.map(a=>a.assignmentId);
      await tx.fleetAllocation.deleteMany({where:{requestId:row.id}});
      if(allocationIds.length) await tx.fleetAllocation.createMany({data:allocationIds.map(assignmentId=>({requestId:row.id,assignmentId}))});
      row={...row,allocationIds,allocated:allocationIds.length,remaining:Number(row.quantity)-allocationIds.length};
    }
    if(kind==='downtime') {
      const v=await tx.fleetVehicle.findUniqueOrThrow({where:{id:Number(values.vehicleId)}});
      const state=values.endDate?{usageState:'UNASSIGNED'}:{usageState:'UNNEEDED',...(['REPAIR','FAULTY'].includes(String(values.reason))?{technicalState:values.reason as string}:{})};
      // Окончание простоя само по себе не подтверждает техническую исправность.
      const after=await tx.fleetVehicle.update({where:{id:v.id},data:{...state,version:{increment:1},updatedById:user.id}});
      await this.audit.write({userId:user.id,directionId:d.id,entity:'fleet_vehicles',entityId:v.id,action:'UPDATE',before:v,after,ip,comment:'Изменение состояния при регистрации простоя'},tx);
    }
    await this.audit.write({userId:user.id,directionId:d.id,entity:`fleet_${kind}`,entityId:row.id,action:id?'UPDATE':'CREATE',before,after:row,ip},tx);
    return row;
  }

  dbError(e:unknown):never {
    if(e instanceof Prisma.PrismaClientKnownRequestError) {
      if(e.code==='P2002') throw new ConflictException('Запись с таким идентификатором уже существует; проверьте дубли');
      if(e.code==='P2034') throw new ConflictException('Одновременное изменение. Обновите данные и повторите');
      if(e.code==='P2003') throw new BadRequestException('Связанная запись недоступна или используется');
    }
    throw e;
  }

  async archive(user:AuthUser,kind:FleetKind,id:number,version:number,archived:boolean,ip:string|null) {
    const d=await this.direction(user,true); await this.assertWrite(user,d.id,undefined,true);
    const before=await this.get(user,kind,id);
    if(!this.access.has(user,'finance')&&['fines','tolls','fuel'].includes(kind)) throw new ForbiddenException('Нет доступа к финансовым изменениям');
    const result=await this.prisma.$transaction(async tx=>{
      if(kind==='vehicles'&&archived) {
        await tx.$queryRaw`SELECT id FROM fleet_vehicle WHERE id = ${id} FOR UPDATE`;
        const links=await tx.fleetAssignment.count({where:{vehicleId:id,isArchived:false,OR:[{endDate:null},{endDate:{gt:new Date()}}]}})+await tx.fleetDowntime.count({where:{vehicleId:id,isArchived:false,endDate:null}});
        if(links) throw new ConflictException('Сначала завершите назначения и простои техники');
      }
      if(kind==='assignments'&&await tx.fleetAllocation.count({where:{assignmentId:id}})) throw new ConflictException('Назначение связано с заявкой');
      if(!archived&&['assignments','downtime'].includes(kind)) throw new ConflictException('Для восстановления назначения или простоя обратитесь к куратору: создайте новый непересекающийся период с ссылкой на архивную запись');
      const changed=await store(tx,kind).updateMany({where:{id,directionId:d.id,version},data:{isArchived:archived,version:{increment:1},updatedById:user.id}});
      if(changed.count!==1) throw new ConflictException('Запись изменена другим пользователем');
      const after=(await store(tx,kind).findFirst({where:{id}}))!;
      await this.audit.write({userId:user.id,directionId:d.id,entity:`fleet_${kind}`,entityId:id,action:archived?'DELETE':'UPDATE',before,after,ip},tx);
      return after;
    });
    this.kpi.invalidate(d.id); return wire(result,this.access.has(user,'finance'));
  }

  async history(user:AuthUser,kind:FleetKind,id:number) {
    const row=await this.get(user,kind,id); this.access.assertFeature(user,'audit');
    const history=await this.prisma.auditLog.findMany({where:{directionId:row.directionId,entity:`fleet_${kind}`,entityId:String(id)},orderBy:{id:'desc'},take:100,include:{user:{select:{fullName:true}}}});
    return redactFleet(history,this.access.has(user,'finance'));
  }

  async getLiability(user:AuthUser,incidentId:number) {
    const r=await this.get(user,'incidents',incidentId); await this.assertWrite(user,r.directionId,undefined,true); this.access.assertFeature(user,'finance');
    const row=await this.prisma.fleetIncidentLiability.findUnique({where:{incidentId}});
    return row?{...redactFleet(row,true) as Record<string,unknown>,balance:row.confirmedAmount.minus(row.recoveredAmount).toFixed(2)}:null;
  }

  async saveLiability(user:AuthUser,incidentId:number,body:unknown,ip:string|null) {
    const d=await this.direction(user,true); await this.get(user,'incidents',incidentId); await this.assertWrite(user,d.id,undefined,true); this.access.assertFeature(user,'finance');
    const input=new ZodPipe(liabilitySchema).transform(body);
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM fleet_incident WHERE id = ${incidentId} FOR UPDATE`;
      const before=await tx.fleetIncidentLiability.findUnique({where:{incidentId}});
      if(before&&before.version!==input.version) throw new ConflictException('Ответственность уже изменена');
      if(!await tx.user.findFirst({where:{id:input.employeeId,isActive:true}})) throw new BadRequestException('Сотрудник не найден');
      const data={employeeId:input.employeeId,confirmedAmount:input.confirmedAmount,recoveredAmount:input.recoveredAmount,evidence:input.evidence,note:input.note};
      const after=before?await tx.fleetIncidentLiability.update({where:{incidentId},data:{...data,version:{increment:1}}}):await tx.fleetIncidentLiability.create({data:{...data,incidentId}});
      // В общем журнале — только факт операции; персональные суммы доступны через защищённую карточку.
      await this.audit.write({userId:user.id,directionId:d.id,entity:'fleet_liability',entityId:incidentId,action:before?'UPDATE':'CREATE',before,after,ip,comment:'Подтверждённая ответственность: ограниченный доступ'},tx);
    });
    return this.getLiability(user,incidentId);
  }

  async overview(user:AuthUser,q:FleetFilter):Promise<FleetOverview> {
    const d=await this.direction(user); const finance=this.access.has(user,'finance');
    const kinds=['vehicles','incidents','fines','tolls','fuel','requests'] as const;
    const data=await Promise.all(kinds.map(k=>store(this.prisma,k).findMany({where:this.where(k,d.id,{...q,archived:false}),orderBy:{id:'desc'}})));
    const [vehicles,incidents,fines,tolls,fuel,requests]=data;
    const snapshot=await this.prisma.fleetSnapshot.findFirst({where:{directionId:d.id,isArchived:false,...(q.to?{asOfDate:{lte:new Date(q.to)}}:{})},orderBy:[{asOfDate:'desc'},{id:'desc'}]});
    const warnings:string[]=[];
    const categories=fuel.filter(r=>!r.isReportedTotal), totals=fuel.filter(r=>r.isReportedTotal);
    for(const r of totals) for(const measure of ['liters','cost'] as const) {
      const parts=categories.filter(c=>c.period===r.period&&c.fuelType===r.fuelType&&c.source===r.source);
      const diff=fuelDifference(parts.map(p=>p[measure]==null?null:String(p[measure])),r[measure]==null?null:String(r[measure]));
      if(diff&&Number(diff)!==0&&(measure==='liters'||finance)) warnings.push(`${r.period} · ${r.fuelType} · ${measure==='liters'?'литры':'рубли'}: сумма категорий отличается от итога источника на ${diff}`);
    }
    if(snapshot&&snapshot.used!=null&&snapshot.unused!=null&&snapshot.used+snapshot.unused!==snapshot.total) warnings.push('Исторический срез: используемая и неиспользуемая техника не дают общий итог');
    const updated=data.flat().map(r=>new Date(String(r.updatedAt)).getTime()).filter(Number.isFinite);
    const payments=(rows:DbRow[])=>paymentTotals(rows.map(r=>({amount:String(r.amount),paidAmount:r.paidAmount==null?null:String(r.paidAmount),status:String(r.status),dueDate:r.dueDate?day(r.dueDate):null})),new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}));
    return {asOf:updated.length?new Date(Math.max(...updated)).toISOString():null,counts:vehicles.length?fleetCounts(vehicles.map(v=>({ownership:String(v.ownership),technicalState:String(v.technicalState),usageState:String(v.usageState)}))):null,
      incidents:incidents.length||null,fines:finance&&fines.length?payments(fines):null,tolls:finance&&tolls.length?payments(tolls):null,
      fuel:{liters:decimalSum(categories.map(r=>String(r.liters)),null),cost:finance?decimalSum(categories.map(r=>r.cost==null?null:String(r.cost)),null):null},openRequests:requests.length?requests.filter(r=>!['FULFILLED','CANCELLED','REJECTED'].includes(String(r.status))).length:null,
      snapshot:snapshot?wire(snapshot as unknown as DbRow,true):null,warnings};
  }
}
