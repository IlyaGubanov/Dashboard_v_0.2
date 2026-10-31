import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { fleetMembershipSchema, FLEET_SCHEMAS, liabilitySchema, type FleetKind, type FleetList, type FleetOverview, type FleetRefs, type FleetRow, type FleetAnalytics } from '@mvs/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthUser } from '../common/request';
import { decimalSum, fleetCounts, overlaps, paymentTotals, requestStatus } from './fleet-domain';
import { dbData, MONEY_FIELDS, redactFleet, store, wire, type DbRow } from './fleet-store';

export type FleetFilter = { from?: string; to?: string; q?: string; ownership?: string; kind?: string; fuelType?:string;category?:string;technicalState?:string;usageState?:string;status?: string; departmentId?: number; targetDirectionId?: number; vehicleId?: number; archived?: boolean; page?: number; take?: number; sort?: string; order?: 'asc'|'desc'; active?: boolean };
const day = (v: unknown) => v instanceof Date ? v.toISOString().slice(0,10) : String(v ?? '').slice(0,10);
export const fleetHash = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class FleetService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  async context(user: AuthUser, write = false) {
    this.access.assertSection(user,'fleet');
    const d=await this.prisma.fleetRegistry.findUnique({where:{code:'reb'}});
    if (!d) throw new NotFoundException('Раздел РЭБ не настроен');
    await this.access.assertViewFleet(user,d.id);
    if (write && d.isReadonly) throw new ForbiddenException('РЭБ доступна только для просмотра');
    return d;
  }

  async assertWrite(user: AuthUser, directionId: number, row?: Record<string,unknown>, manage=false) {
    if (manage ? await this.access.canManageFleet(user,directionId) : await this.access.canEditFleet(user,directionId,row)) return;
    throw new ForbiddenException(manage?'Нужны права куратора РЭБ':'Нет прав на изменение этой записи РЭБ');
  }

  async refs(user: AuthUser): Promise<FleetRefs> {
    const d=await this.context(user);
    const [directions, users, departments, organizations, vehicles, assignments, types, membership, manage]=await Promise.all([
      this.prisma.direction.findMany({where:{isActive:true,code:{not:'reb'},...(user.globalRole==='USER'?{members:{some:{userId:user.id}}}:{})},select:{id:true,name:true,code:true}}),
      this.access.canSee(user,'people') ? this.prisma.user.findMany({where:this.employeeWhere(user,d.id),select:{id:true,fullName:true,position:true,phone:true},orderBy:{fullName:'asc'}}) : Promise.resolve([]),
      this.prisma.department.findMany({where:{isArchived:false},select:{id:true,name:true}}),
      this.prisma.organization.findMany({where:{direction:{OR:[{code:'reb'},{isActive:true,...(user.globalRole==='USER'?{members:{some:{userId:user.id}}}:{})}]}},select:{id:true,name:true}}),
      this.prisma.fleetVehicle.findMany({where:{directionId:d.id,isArchived:false},select:{id:true,name:true,plate:true}}),
      this.prisma.fleetAssignment.findMany({where:{directionId:d.id,isArchived:false},include:{vehicle:{select:{name:true,plate:true}}}}),
      this.prisma.fleetFuelType.findMany({orderBy:{code:'asc'}}), this.access.fleetMembership(user,d.id), this.access.canManageFleet(user,d.id),
    ]);
    const sites=await this.prisma.site.findMany({where:{isArchived:false,directionId:{in:directions.map(x=>x.id)}},select:{id:true,name:true,directionId:true},orderBy:{name:'asc'}});
    return {registryId:d.id,canEdit:!d.isReadonly&&(manage||membership?.role==='EDITOR'),canManage:manage,canFinance:this.access.has(user,'finance'),canLiability:manage&&this.access.has(user,'finance'),canAudit:this.access.has(user,'audit'),
      directions,users:users.map(u=>({id:u.id,name:u.fullName,position:u.position,phone:u.phone})),departments,organizations,sites,
      vehicles:vehicles.map(v=>({id:v.id,name:`${v.name}${v.plate?' · '+v.plate:''}`})),assignments:assignments.map(a=>({id:a.id,name:`№ ${a.id} · ${a.vehicle.name} · ${day(a.startDate)} — ${a.endDate?day(a.endDate):'без окончания'}`})),fuelTypes:types.map(t=>t.code)};
  }

  async member(user:AuthUser,userId:number) {
    if(user.globalRole!=='ADMIN')throw new ForbiddenException('Нужны права администратора');
    const d=await this.context(user);
    const row=await this.prisma.fleetMember.findUnique({where:{registryId_userId:{registryId:d.id,userId}}});
    return {role:row?.role??null,scope:row?.scope??'ALL'};
  }
  async setMember(user:AuthUser,userId:number,body:unknown,ip:string|null) {
    if(user.globalRole!=='ADMIN')throw new ForbiddenException('Нужны права администратора');
    const d=await this.context(user,true),value=new ZodPipe(fleetMembershipSchema).transform(body);
    if(!await this.prisma.user.findUnique({where:{id:userId}}))throw new NotFoundException('Пользователь не найден');
    await this.prisma.$transaction(async tx=>{
      const where={registryId_userId:{registryId:d.id,userId}},before=await tx.fleetMember.findUnique({where});
      if(value.role)await tx.fleetMember.upsert({where,create:{registryId:d.id,userId,role:value.role,scope:value.scope},update:{role:value.role,scope:value.scope}});
      else await tx.fleetMember.deleteMany({where:{registryId:d.id,userId}});
      await this.audit.write({userId:user.id,entity:'fleet_member',entityId:userId,action:'UPDATE',before,after:value,ip},tx);
    });
    return value;
  }

  private employeeWhere(user:AuthUser,directionId:number):Prisma.UserWhereInput {
    if(user.globalRole==='ADMIN')return {isActive:true};
    return {isActive:true,OR:[{fleetMemberships:{some:{registryId:directionId}}},{memberships:{some:{direction:{isActive:true,...(user.globalRole==='USER'?{members:{some:{userId:user.id}}}:{})}}}},
      ...['fleetVehicleEmployeeId','fleetAssignmentEmployeeId','fleetIncidentEmployeeId','fleetFineEmployeeId','fleetTollEmployeeId','fleetDowntimeEmployeeId','fleetRequestEmployeeId','fleetRequestInitiatorId'].map(key=>({[key]:{some:{directionId}}}))]};
  }

  async get(user: AuthUser, kind: FleetKind, id: number, db: Prisma.TransactionClient | PrismaService=this.prisma) {
    const d=await this.context(user);
    const row=await store(db,kind).findFirst({where:{id,directionId:d.id}});
    if(!row) throw new NotFoundException('Запись РЭБ не найдена');
    return row;
  }

  private async enrich(db: Prisma.TransactionClient | PrismaService,kind:FleetKind,rows:DbRow[]):Promise<DbRow[]> {
    if(kind==='vehicles'&&rows.length) {
      const today=new Date(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}));
      const [idle,assigned]=await Promise.all([db.fleetDowntime.findMany({where:{vehicleId:{in:rows.map(r=>r.id)},isArchived:false,startDate:{lte:today},OR:[{endDate:null},{endDate:{gt:today}}]}}),db.fleetAssignment.findMany({where:{vehicleId:{in:rows.map(r=>r.id)},isArchived:false,startDate:{lte:today},OR:[{endDate:null},{endDate:{gt:today}}]}})]);
      return rows.map(r=>{const stop=idle.find(v=>v.vehicleId===r.id);return {...r,effectiveTechnicalState:stop&&['REPAIR','FAULTY'].includes(stop.reason)?stop.reason:r.technicalState,effectiveUsageState:stop?'UNNEEDED':assigned.some(a=>a.vehicleId===r.id)?'ACTIVE':r.usageState,currentDowntimeId:stop?.id??null,currentDowntimeReason:stop?.reason??null,currentDowntimeStart:stop?.startDate??null,currentExpectedReturn:stop?.expectedReturn??null,currentDowntimeEmployeeId:stop?.employeeId??r.employeeId,currentDowntimeComment:stop?.comment??null};});
    }
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
    if(q.vehicleId&&!['fuel','requests','snapshots'].includes(kind))where[kind==='vehicles'?'id':'vehicleId']=q.vehicleId;
    if(q.targetDirectionId && !['vehicles','fuel','snapshots','downtime'].includes(kind)) where.targetDirectionId=q.targetDirectionId;
    if(q.departmentId && ['requests','incidents','fines','tolls'].includes(kind)) where.departmentId=q.departmentId;
    if(q.status && ['incidents','fines','tolls','requests'].includes(kind)) where.status=q.status;
    if(kind==='fuel'){where.isReportedTotal=false;if(q.fuelType)where.fuelType=q.fuelType;if(q.category)where.category=q.category;}
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
    const d=await this.context(user); const finance=this.access.has(user,'finance');
    // Поиск выполняется по разрешённой проекции: скрытая сумма не должна влиять на результаты поиска.
    let rows=await store(this.prisma,kind).findMany({where:this.where(kind,d.id,q),orderBy:{id:'desc'}});
    rows=await this.enrich(this.prisma,kind,rows);
    let result=rows.map(r=>wire(r,finance));
    if(kind==='vehicles'&&q.usageState)result=result.filter(r=>q.usageState==='UNUSED'?['RESERVE','UNASSIGNED','UNNEEDED'].includes(String(r.effectiveUsageState)):r.effectiveUsageState===q.usageState);
    if(kind==='vehicles'&&q.technicalState)result=result.filter(r=>r.effectiveTechnicalState===q.technicalState);
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
      if(!await tx.user.findFirst({where:{...this.employeeWhere(user,directionId),id:Number(input[key])},select:{id:true}})) throw new BadRequestException('Сотрудник не найден, неактивен или недоступен');
    }
    if(input.departmentId!=null&&!await tx.department.findFirst({where:{id:Number(input.departmentId),isArchived:false}})) throw new BadRequestException('Подразделение не найдено');
    if(input.ownerId!=null) { const owner=await tx.organization.findUnique({where:{id:Number(input.ownerId)},include:{direction:{select:{id:true,code:true}}}}); if(!owner) throw new BadRequestException('Организация не найдена'); if(owner.direction.code!=='reb') await this.access.assertViewDirection(user,owner.direction.id); }
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
    const d=await this.context(user,true); const raw=(body??{}) as Record<string,unknown>;
    const old=id?await this.get(user,kind,id):null;
    await this.assertWrite(user,d.id,old??raw,kind==='snapshots');
    const finance=this.access.has(user,'finance');
    if(!finance&&(['fines','tolls','fuel'].includes(kind)||Object.keys(raw).some(k=>MONEY_FIELDS.has(k)))) throw new ForbiddenException('Нет доступа к финансовым изменениям');
    const parsed=new ZodPipe<Record<string,unknown>>(FLEET_SCHEMAS[kind]).transform(body);
    if(kind==='fuel'&&old) { if(raw.source===undefined)parsed.source=old.source; if(raw.isReportedTotal===undefined)parsed.isReportedTotal=old.isReportedTotal; }
    await this.assertWrite(user,d.id,{...old,...parsed},kind==='snapshots');
    if(id&&!Number.isInteger(parsed.version)) throw new ConflictException('Передайте версию открытой записи');
    if(old?.isArchived) throw new ConflictException('Сначала восстановите запись из архива');
    try {
      const result=await this.prisma.$transaction(async tx=>this.saveInTransaction(user,tx,kind,id,parsed,ip),{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
      return wire(result,finance);
    } catch(e) { this.dbError(e); }
  }

  /** Используется и ручной формой, и подтверждённым импортом; транзакция принадлежит вызывающему. */
  async saveInTransaction(user:AuthUser,tx:Prisma.TransactionClient,kind:FleetKind,id:number|null,input:Record<string,unknown>,ip:string|null,source?:{batchId:number;key:string;raw:Prisma.InputJsonValue}):Promise<DbRow> {
    const d=await tx.fleetRegistry.findUniqueOrThrow({where:{code:'reb'}});
    const repo=store(tx,kind);
    const before=id?await repo.findFirst({where:{id,directionId:d.id}}):null;
    if(id&&!before) throw new NotFoundException('Запись не найдена');
    if(before&&before.version!==input.version) throw new ConflictException('Запись изменена другим пользователем. Обновите карточку');
    const values={...input};
    if(kind==='assignments'&&id) await tx.$queryRaw`SELECT id FROM fleet_assignment WHERE id = ${id} FOR UPDATE`;
    if(kind==='requests') {
      if(id) await tx.$queryRaw`SELECT id FROM fleet_request WHERE id = ${id} FOR UPDATE`;
      for(const assignmentId of [...((values.allocationIds??[]) as number[])].sort((a,b)=>a-b)) await tx.$queryRaw`SELECT id FROM fleet_assignment WHERE id = ${assignmentId} FOR UPDATE`;
    }
    await this.validateLinks(user,tx,d.id,values);
    if(kind==='assignments'||kind==='downtime') {
      // Блокировка одной единицы делает проверку пересечений атомарной при одновременных запросах.
      await tx.$queryRaw`SELECT id FROM fleet_vehicle WHERE id = ${Number(values.vehicleId)} FOR UPDATE`;
      const active=await tx.fleetVehicle.findFirst({where:{id:Number(values.vehicleId),directionId:d.id,isArchived:false}});
      if(!active)throw new ConflictException('Техника уже архивирована');
      const other=await repo.findMany({where:{vehicleId:values.vehicleId,isArchived:false,...(id?{id:{not:id}}:{})}});
      if(other.some(r=>overlaps(day(r.startDate),r.endDate?day(r.endDate):null,String(values.startDate),values.endDate?String(values.endDate):null))) throw new ConflictException('Период пересекается с существующим '+(kind==='assignments'?'назначением':'простоем'));
    }
    if(kind==='fuel'&&!await tx.fleetFuelType.findUnique({where:{code:String(values.fuelType)}})) throw new BadRequestException('Вид топлива отсутствует в справочнике');
    const allocationIds=(values.allocationIds??[]) as number[];
    if(kind==='requests') {
      const assignments=await tx.fleetAssignment.findMany({where:{id:{in:allocationIds},directionId:d.id,isArchived:false},include:{vehicle:true}});
      if(assignments.length!==allocationIds.length || new Set(assignments.map(a=>a.vehicleId)).size!==assignments.length) throw new BadRequestException('Нужны разные действующие назначения техники');
      for(const a of assignments) {
        if(a.vehicle.isArchived || a.vehicle.kind!==values.kind || (values.targetDirectionId!=null&&a.targetDirectionId!==values.targetDirectionId) || (values.siteId!=null&&a.siteId!==values.siteId) || day(a.startDate)>String(values.startDate) || (a.endDate&&day(a.endDate)<String(values.endDate))) throw new BadRequestException('Назначение не соответствует виду техники, месту или полному периоду потребности');
      }
      const occupied=await tx.fleetAllocation.count({where:{assignmentId:{in:allocationIds},...(id?{requestId:{not:id}}:{}),request:{isArchived:false,status:{notIn:['CANCELLED','REJECTED']}}}});
      if(occupied)throw new ConflictException('Назначение уже выделено другой действующей заявке');
      if(assignments.length>Number(values.quantity)) throw new BadRequestException('Выделено больше запрошенного количества');
      values.status=requestStatus(Number(values.quantity),assignments.length,String(values.status));
    }
    if(kind==='assignments'&&id&&await tx.fleetAllocation.count({where:{assignmentId:id}})) throw new ConflictException('Назначение связано с заявкой. Сначала скорректируйте выделение в заявке');
    const data=dbData(values);
    if(kind==='fuel'&&!source&&!before?.importBatchId) data.sourceKey=fleetHash([values.period,values.fuelType,values.category,values.source].join('|'));
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
    // Простой влияет на эффективное состояние только в действующем интервале (enrich).
    // Последнее подтверждённое состояние автомобиля остаётся самостоятельным признаком.
    await this.audit.write({userId:user.id,entity:`fleet_${kind}`,entityId:row.id,action:id?'UPDATE':'CREATE',before,after:row,ip},tx);
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
    const d=await this.context(user,true); await this.assertWrite(user,d.id,undefined,true);
    const before=await this.get(user,kind,id);
    if(!this.access.has(user,'finance')&&['fines','tolls','fuel'].includes(kind)) throw new ForbiddenException('Нет доступа к финансовым изменениям');
    const result=await this.prisma.$transaction(async tx=>{
      if(kind==='assignments')await tx.$queryRaw`SELECT id FROM fleet_assignment WHERE id = ${id} FOR UPDATE`;
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
      await this.audit.write({userId:user.id,entity:`fleet_${kind}`,entityId:id,action:archived?'DELETE':'UPDATE',before,after,ip},tx);
      return after;
    });
    return wire(result,this.access.has(user,'finance'));
  }

  async history(user:AuthUser,kind:FleetKind,id:number) {
    const row=await this.get(user,kind,id); this.access.assertFeature(user,'audit');
    const history=await this.prisma.auditLog.findMany({where:{entity:`fleet_${kind}`,entityId:String(id)},orderBy:{id:'desc'},take:100,include:{user:{select:{fullName:true}}}});
    return redactFleet(history,this.access.has(user,'finance'));
  }

  async analytics(user:AuthUser,kind:FleetKind,q:FleetFilter):Promise<FleetAnalytics> {
    const d=await this.context(user),finance=this.access.has(user,'finance');
    let rows=await store(this.prisma,kind).findMany({where:this.where(kind,d.id,q)});
    if(q.q){const term=q.q.toLocaleLowerCase('ru');rows=rows.filter(r=>Object.values(wire(r,finance)).filter(v=>typeof v==='string').some(v=>String(v).toLocaleLowerCase('ru').includes(term)));}
    const summary:Record<string,string|number|null>={records:rows.length};
    const monthly:FleetAnalytics['monthly']=[],byVehicle:FleetAnalytics['byVehicle']=[],distribution:FleetAnalytics['distribution']=[];
    if(kind==='fines'||kind==='tolls') {
      const pay=paymentTotals(rows.map(r=>({amount:String(r.amount),paidAmount:r.paidAmount==null?null:String(r.paidAmount),status:String(r.status),dueDate:r.dueDate?day(r.dueDate):null})),new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}));
      if(finance)Object.assign(summary,pay);
      const groups=new Map<string,DbRow[]>();for(const r of rows){const date=r[kind==='fines'?'violationDate':'passageDate'];const key=date?day(date).slice(0,7):'Без даты';groups.set(key,[...(groups.get(key)??[]),r]);}
      if(finance)for(const [label,items] of [...groups].sort(([a],[b])=>a.localeCompare(b)))monthly.push({label,value:decimalSum(items.filter(r=>r.status!=='CANCELLED').map(r=>String(r.amount)))});
      const vehicles=new Map<string,DbRow[]>();for(const r of rows){const key=String(r.plate??`ТС № ${r.vehicleId??'не установлено'}`);vehicles.set(key,[...(vehicles.get(key)??[]),r]);}
      for(const [label,items]of vehicles)byVehicle.push({label,count:items.length,amount:finance?decimalSum(items.filter(r=>r.status!=='CANCELLED').map(r=>String(r.amount))):null,vehicleId:items[0].vehicleId==null?null:Number(items[0].vehicleId)});
    }
    if(kind==='fuel') {
      const parts=rows.filter(r=>!r.isReportedTotal);summary.liters=decimalSum(parts.map(r=>String(r.liters)),null);if(finance)summary.cost=decimalSum(parts.map(r=>r.cost==null?null:String(r.cost)),null);
      const months=[...new Set(parts.map(r=>String(r.period)))].sort();for(const label of months)monthly.push({label,value:decimalSum(parts.filter(r=>r.period===label).map(r=>String(r.liters)),null)});
    }
    if(kind==='incidents') {summary.open=rows.filter(r=>r.status!=='CLOSED').length;summary.casualties=rows.filter(r=>r.casualties===true).length;if(finance)for(const k of ['damage','repairCost','recoveredAmount'])summary[k]=decimalSum(rows.map(r=>r[k]==null?null:String(r[k])),null);}
    if(kind==='requests') {const enhanced=await this.enrich(this.prisma,kind,rows);summary.requested=rows.reduce((a,r)=>a+Number(r.quantity),0);summary.allocated=enhanced.reduce((a,r)=>a+Number(r.allocated),0);summary.remaining=enhanced.filter(r=>!['CANCELLED','REJECTED'].includes(String(r.status))).reduce((a,r)=>a+Number(r.remaining),0);}
    if(kind==='assignments') {
      if(!q.from&&!q.to){const now=new Date(new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}));rows=rows.filter(r=>new Date(String(r.startDate))<=now&&(!r.endDate||new Date(String(r.endDate))>now));}
      const refs=await this.refs(user),groups=new Map<string,DbRow[]>();
      for(const direction of refs.directions)distribution.push({group:'direction',label:direction.name,quantity:0,vehicleIds:[],targetDirectionId:direction.id,siteId:null});
      for(const r of rows){const entry=distribution.find(v=>v.targetDirectionId===r.targetDirectionId);if(entry){entry.vehicleIds.push(Number(r.vehicleId));entry.quantity=new Set(entry.vehicleIds).size;}const key=`${r.siteId??'none'}|${r.targetDirectionId}`;groups.set(key,[...(groups.get(key)??[]),r]);}
      for(const [,items]of groups){const siteId=items[0].siteId==null?null:Number(items[0].siteId),dirId=Number(items[0].targetDirectionId);distribution.push({group:'site',label:siteId?(refs.sites.find(s=>s.id===siteId)?.name??'Объект недоступен'):'Без объекта · '+(refs.directions.find(v=>v.id===dirId)?.name??'Направление'),quantity:new Set(items.map(r=>r.vehicleId)).size,vehicleIds:[...new Set(items.map(r=>Number(r.vehicleId)))],siteId,targetDirectionId:dirId});}
      const vehicles=await this.prisma.fleetVehicle.findMany({where:{id:{in:[...new Set(rows.map(r=>Number(r.vehicleId)))]}},select:{id:true,kind:true}});
      for(const label of [...new Set(vehicles.map(v=>v.kind))]){const ids=vehicles.filter(v=>v.kind===label).map(v=>v.id);distribution.push({group:'kind',label,quantity:ids.length,vehicleIds:ids,siteId:null,targetDirectionId:null});}
      summary.assigned=new Set(rows.map(r=>r.vehicleId)).size;
    }
    return {summary,monthly,byVehicle,distribution};
  }

  async getLiability(user:AuthUser,incidentId:number) {
    const r=await this.get(user,'incidents',incidentId); await this.assertWrite(user,r.directionId,undefined,true); this.access.assertFeature(user,'finance');
    const row=await this.prisma.fleetIncidentLiability.findUnique({where:{incidentId}});
    return row?{...redactFleet(row,true) as Record<string,unknown>,balance:row.confirmedAmount.minus(row.recoveredAmount).toFixed(2)}:null;
  }

  async saveLiability(user:AuthUser,incidentId:number,body:unknown,ip:string|null) {
    const d=await this.context(user,true); await this.get(user,'incidents',incidentId); await this.assertWrite(user,d.id,undefined,true); this.access.assertFeature(user,'finance');
    const input=new ZodPipe(liabilitySchema).transform(body);
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM fleet_incident WHERE id = ${incidentId} FOR UPDATE`;
      const before=await tx.fleetIncidentLiability.findUnique({where:{incidentId}});
      if(before&&before.version!==input.version) throw new ConflictException('Ответственность уже изменена');
      await this.validateLinks(user,tx,d.id,{employeeId:input.employeeId});
      const data={employeeId:input.employeeId,confirmedAmount:input.confirmedAmount,recoveredAmount:input.recoveredAmount,evidence:input.evidence,note:input.note};
      const after=before?await tx.fleetIncidentLiability.update({where:{incidentId},data:{...data,version:{increment:1}}}):await tx.fleetIncidentLiability.create({data:{...data,incidentId}});
      // В общем журнале — только факт операции; персональные суммы доступны через защищённую карточку.
      await this.audit.write({userId:user.id,entity:'fleet_liability',entityId:incidentId,action:before?'UPDATE':'CREATE',before,after,ip,comment:'Подтверждённая ответственность: ограниченный доступ'},tx);
    });
    return this.getLiability(user,incidentId);
  }

  async overview(user:AuthUser,q:FleetFilter):Promise<FleetOverview> {
    const d=await this.context(user); const finance=this.access.has(user,'finance');
    const kinds=['vehicles','incidents','fines','tolls','fuel','requests'] as const;
    const data=await Promise.all(kinds.map(k=>store(this.prisma,k).findMany({where:this.where(k,d.id,{...q,archived:false}),orderBy:{id:'desc'}})));
    const [rawVehicles,incidents,fines,tolls,fuel,requests]=data;
    const vehicles=await this.enrich(this.prisma,'vehicles',rawVehicles);
    const categories=fuel.filter(r=>!r.isReportedTotal);
    const months=[...new Set(categories.map(r=>String(r.period)))].sort();
    const monthly=months.map(period=>{const rows=categories.filter(r=>r.period===period);return {period,liters:decimalSum(rows.map(r=>String(r.liters)),null),cost:finance?decimalSum(rows.map(r=>r.cost==null?null:String(r.cost)),null):null};});
    const latest=monthly.at(-1);
    const updated=data.flat().map(r=>new Date(String(r.updatedAt)).getTime()).filter(Number.isFinite);
    const payments=(rows:DbRow[])=>paymentTotals(rows.map(r=>({amount:String(r.amount),paidAmount:r.paidAmount==null?null:String(r.paidAmount),status:String(r.status),dueDate:r.dueDate?day(r.dueDate):null})),new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}));
    return {asOf:updated.length?new Date(Math.max(...updated)).toISOString():null,counts:vehicles.length?fleetCounts(vehicles.map(v=>({ownership:String(v.ownership),technicalState:String(v.effectiveTechnicalState??v.technicalState),usageState:String(v.effectiveUsageState??v.usageState)}))):null,
      incidents:incidents.length||null,fines:finance&&fines.length?payments(fines):null,tolls:finance&&tolls.length?payments(tolls):null,
      fuel:{period:latest?.period??null,liters:latest?.liters??null,cost:latest?.cost??null,monthly},openRequests:requests.length?requests.filter(r=>!['FULFILLED','CANCELLED','REJECTED'].includes(String(r.status))).length:null};
  }
}
