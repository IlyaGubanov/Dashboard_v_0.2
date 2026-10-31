import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { FleetService,fleetHash } from './fleet.service';
import { store,redactFleet } from './fleet-store';
import { IMPORT_COLUMNS,normalizePlate,parseImportRow,readFleetWorkbook,type ImportSheet,type ImportKind } from './fleet-import-parser';

const mappingSchema=z.record(z.string().max(50),z.number().int().min(0).max(64));
export const importPreviewSchema=z.object({uploadId:z.string().length(48),kind:z.enum(['incidents','fines','tolls']),sheet:z.string().min(1).max(100),headerRow:z.number().int().min(1).max(30).default(1),mapping:mappingSchema,
  overrides:z.record(z.string().regex(/^\d+$/),z.object({vehicleId:z.number().int().positive().nullable().optional(),employeeId:z.number().int().positive().nullable().optional(),departmentId:z.number().int().positive().nullable().optional(),paidAmount:z.string().max(30).nullable().optional(),paidDate:z.string().max(10).nullable().optional(),status:z.enum(['REVIEW','TO_PAY','PARTIAL','PAID','DISPUTED','CANCELLED']).optional(),paymentDocument:z.string().max(500).nullable().optional()}).strict()).default({})}).strict();
export const importCommitSchema=z.object({uploadId:z.string().length(48),previewId:z.string().length(48),rows:z.array(z.number().int().positive()).min(1).max(500),acknowledgeWarnings:z.boolean()}).strict();
type PreviewRow={row:number;data:Record<string,unknown>;errors:string[];warnings:string[];excluded:boolean;duplicate:boolean;sourceKey:string;raw:Prisma.InputJsonValue};
type Session={userId:number;expires:number;name:string;hash:string;sheets:ImportSheet[];busy:boolean;preview?:{id:string;kind:ImportKind;sheet:string;mapping:Record<string,number>;rows:PreviewRow[]}};

/** Предпросмотр живёт только в памяти 20 минут, привязан к пользователю и не пишет в БД. */
@Injectable()
export class FleetImportService {
  private sessions=new Map<string,Session>();
  constructor(private readonly prisma:PrismaService,private readonly access:AccessService,private readonly fleet:FleetService) {}
  private expire() {for(const [id,s] of this.sessions) if(s.expires<Date.now()&&!s.busy)this.sessions.delete(id);}
  private session(user:AuthUser,id:string) {this.expire();const s=this.sessions.get(id);if(!s||s.userId!==user.id)throw new NotFoundException('Предпросмотр истёк или принадлежит другому пользователю. Загрузите файл снова');if(s.busy)throw new ConflictException('Импорт уже выполняется');return s;}
  async allowed(user:AuthUser,kind?:ImportKind) {
    const d=await this.fleet.direction(user,true);await this.fleet.assertWrite(user,d.id,undefined,true);
    if(!kind||kind!=='incidents')this.access.assertFeature(user,'finance');
    return d;
  }
  async upload(user:AuthUser,name:string,buffer:Buffer) {
    // Книга может содержать финансы других листов: загрузка и разбор доступны куратору с финансами.
    await this.allowed(user);this.expire();
    if(!/\.xlsx$/i.test(name))throw new BadRequestException('Поддерживается XLSX');
    if(this.sessions.size>=20)throw new ConflictException('Слишком много одновременных предпросмотров; повторите позже');
    for(const [id,s] of this.sessions)if(s.userId===user.id&&!s.busy)this.sessions.delete(id);
    const sheets=await readFleetWorkbook(buffer),id=randomBytes(24).toString('hex');
    this.sessions.set(id,{userId:user.id,expires:Date.now()+20*60000,name:name.slice(0,200),hash:fleetHash(buffer.toString('base64')),sheets,busy:false});
    return {uploadId:id,fileName:name,sheets:sheets.map(s=>({name:s.name,rows:s.rows.length,headers:(s.rows[0]??[]).map((v,i)=>({column:i+1,label:String(v??'').trim()||`Колонка ${i+1}`}))})),columns:IMPORT_COLUMNS};
  }
  async preview(user:AuthUser,body:unknown) {
    const input=new ZodPipe(importPreviewSchema).transform(body),d=await this.allowed(user,input.kind),s=this.session(user,input.uploadId);
    const sheet=s.sheets.find(v=>v.name===input.sheet);if(!sheet)throw new BadRequestException('Лист не найден');
    const fields=IMPORT_COLUMNS[input.kind];
    if(Object.keys(input.mapping).some(k=>!Object.hasOwn(fields,k)))throw new BadRequestException('Неизвестное поле сопоставления');
    for(const [key,field] of Object.entries(fields))if(field.required&&!input.mapping[key])throw new BadRequestException(`Сопоставьте колонку «${field.label}»`);
    const [vehicles,refs]=await Promise.all([this.prisma.fleetVehicle.findMany({where:{directionId:d.id,isArchived:false},select:{id:true,plate:true}}),this.fleet.refs(user)]);
    const existing=await store(this.prisma,input.kind).findMany({where:{directionId:d.id},select:{id:true,sourceKey:true,...(input.kind==='fines'?{uin:true}:input.kind==='tolls'?{chargeIdentifier:true}:{})}});
    const keys=new Set(existing.map(r=>String(r.sourceKey))),identifiers=new Set(existing.map(r=>String(r[input.kind==='fines'?'uin':'chargeIdentifier']??'')));
    const rows:PreviewRow[]=[];
    for(let i=input.headerRow;i<sheet.rows.length;i++) {
      const values=sheet.rows[i];if(!values.some(v=>v!=null&&v!==''))continue;
      // Строка технической нумерации «1 2 3…» в мониторинге не является происшествием.
      if(input.kind==='incidents'&&values.slice(0,8).every((v,j)=>String(typeof v==='object'&&v&&'numeric' in v?v.numeric:v)===String(j+1)))continue;
      const raw=Object.fromEntries(Object.entries(input.mapping).filter(([,col])=>col>0).map(([key,col])=>[key,values[col-1]??null]));
      const parsed=parseImportRow(input.kind,raw,input.overrides[String(i+1)]??{});
      if(!parsed.excluded) {
        const matches=vehicles.filter(v=>v.plate&&normalizePlate(v.plate)===normalizePlate(raw.plate));
        if(parsed.data.vehicleId==null&&matches.length===1)parsed.data.vehicleId=matches[0].id;
        if(parsed.data.vehicleId==null)parsed.warnings.push(matches.length>1?'Несколько совпадений техники; выберите вручную':'Техника не сопоставлена; сохранится только госномер, без создания автомобиля');
        const name=String(raw.employeeName??'').trim(),employees=refs.users.filter(u=>u.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'));
        if(parsed.data.employeeId==null&&name&&employees.length===1)parsed.data.employeeId=employees[0].id;
        if(name&&parsed.data.employeeId==null)parsed.warnings.push('Сотрудник не сопоставлен однозначно; ФИО сохранено только в источнике');
        const department=String(raw.departmentName??'').trim(),departments=refs.departments.filter(v=>v.name.toLowerCase()===department.toLowerCase());
        if(parsed.data.departmentId==null&&department&&departments.length===1)parsed.data.departmentId=departments[0].id;
        if(department&&parsed.data.departmentId==null)parsed.warnings.push('Подразделение не сопоставлено; исходное название сохранено');
        const override=input.overrides[String(i+1)];
        if(override?.vehicleId&&!refs.vehicles.some(v=>v.id===override.vehicleId))parsed.errors.push('Выбранная техника недоступна');
        if(override?.employeeId&&!refs.users.some(v=>v.id===override.employeeId))parsed.errors.push('Выбранный сотрудник недоступен');
        if(override?.departmentId&&!refs.departments.some(v=>v.id===override.departmentId))parsed.errors.push('Выбранное подразделение недоступно');
      }
      const identifier=String(parsed.data[input.kind==='fines'?'uin':'chargeIdentifier']??'');
      const sourceKey=fleetHash(input.kind==='incidents'?JSON.stringify([parsed.data.plate,parsed.data.occurredAt,parsed.data.incidentType]):identifier?`${input.kind}|${identifier}`:JSON.stringify([input.kind,parsed.data.plate,parsed.data.passageDate??parsed.data.violationDate,parsed.data.chargeDate,parsed.data.detectedDate,parsed.data.route??parsed.data.violation,parsed.data.amount]));
      const duplicate=keys.has(sourceKey)||(!!identifier&&identifiers.has(identifier));
      if(duplicate)parsed.warnings.push('Уже есть в реестре, включая архив. Повторный импорт не перезапишет ручные изменения');
      rows.push({row:i+1,...parsed,duplicate,sourceKey,raw:JSON.parse(JSON.stringify({sheet:sheet.name,row:i+1,cells:values,mapping:input.mapping,confirmedOverrides:input.overrides[String(i+1)]??{}}))});
    }
    const seen=new Map<string,PreviewRow>();
    for(const row of rows)if(!row.excluded&&!row.errors.length&&!row.duplicate) {
      const prev=seen.get(row.sourceKey);
      if(prev) {
        if(JSON.stringify(prev.data)!==JSON.stringify(row.data)) {prev.errors.push('Один идентификатор с разными сведениями в файле');row.errors.push('Один идентификатор с разными сведениями в файле');}
        else {row.duplicate=true;row.warnings.push(`Точный повтор строки ${prev.row} в файле`);}
      } else seen.set(row.sourceKey,row);
    }
    const previewId=randomBytes(24).toString('hex');
    s.preview={id:previewId,kind:input.kind,sheet:input.sheet,mapping:input.mapping,rows};
    return {previewId,kind:input.kind,total:rows.length,ready:rows.filter(r=>!r.excluded&&!r.duplicate&&!r.errors.length).length,rows:redactFleet(rows,this.access.has(user,'finance'))};
  }
  async commit(user:AuthUser,body:unknown,ip:string|null) {
    const input=new ZodPipe(importCommitSchema).transform(body),s=this.session(user,input.uploadId),p=s.preview;
    if(!p||p.id!==input.previewId)throw new ConflictException('Предпросмотр изменился. Проверьте данные заново');
    const d=await this.allowed(user,p.kind);
    if(!input.acknowledgeWarnings)throw new BadRequestException('Подтвердите проверку выбранных строк и предупреждений');
    if(new Set(input.rows).size!==input.rows.length)throw new BadRequestException('Выбраны повторные строки');
    const selected=p.rows.filter(r=>input.rows.includes(r.row));
    if(selected.length!==input.rows.length||selected.some(r=>r.excluded||r.duplicate||r.errors.length))throw new BadRequestException('Выбраны строки с ошибками, дублями или чужой организацией');
    s.busy=true;
    try {
      const result=await this.prisma.$transaction(async tx=>{
        const batch=await tx.fleetImportBatch.create({data:{directionId:d.id,createdById:user.id,fileName:s.name,fileHash:s.hash,kind:p.kind,mapping:p.mapping,importedRows:selected.length,skippedRows:p.rows.length-selected.length}});
        for(const row of selected)await this.fleet.saveInTransaction(user,tx,p.kind,null,row.data,ip,{batchId:batch.id,key:row.sourceKey,raw:row.raw});
        return {batchId:batch.id,imported:selected.length,skipped:p.rows.length-selected.length};
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:60000});
      this.sessions.delete(input.uploadId);return result;
    } catch(e) {this.fleet.dbError(e);} finally {s.busy=false;}
  }
}
