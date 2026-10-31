import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import readExcelFile from 'read-excel-file/node';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { fineSchema, incidentSchema, tollSchema } from '@mvs/shared';

export type ImportKind='fines'|'tolls'|'incidents';
type NumericCell={numeric:string};
export type ImportCell=string|number|boolean|Date|NumericCell|null;
export type ImportSheet={name:string;rows:ImportCell[][]};
export type ParsedImportRow={data:Record<string,unknown>;warnings:string[];errors:string[];excluded:boolean};
const string=(v:unknown)=>v==null?'':v instanceof Date?v.toISOString():typeof v==='object'&&'numeric' in v?String((v as NumericCell).numeric):String(v).trim();
const empty=(v:unknown)=>v==null||string(v)===''||string(v)==='-';

/** Ограничиваем распаковку до запуска XML-парсера. Макросы, DTD и огромные ячейки не принимаются. */
export async function readFleetWorkbook(buffer:Buffer):Promise<ImportSheet[]> {
  if(buffer.length>8*1024*1024||buffer.length<4||buffer.readUInt32LE(0)!==0x04034b50) throw new BadRequestException('Нужен файл XLSX до 8 МБ');
  let bytes=0,entries=0;
  try {
    const files=unzipSync(buffer,{filter:e=>{
      bytes+=e.originalSize; entries++;
      if(e.originalSize>16*1024*1024||bytes>64*1024*1024||entries>300||/vbaProject|\.exe$/i.test(e.name)) throw new Error('Превышены ограничения безопасного Excel-импорта');
      return true;
    }});
    if(!files['xl/workbook.xml']) throw new Error('Нет книги Excel');
    let cells=0;
    for(const [name,data] of Object.entries(files)) if(name.endsWith('.xml')) {
      let xml=strFromU8(data);
      if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/ENTITY не допускаются');
      if(/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        // Шаблон содержит форматирование до XFD: пустые стилевые ячейки не являются данными.
        xml=xml.replace(/<dimension\b[^>]*\/>/g,'').replace(/<c\b[^>]*\/>/g,'').replace(/<c\b[^>]*>\s*<\/c>/g,'');
        for(const m of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>/g)) {
          let col=0;for(const c of m[1]) col=col*26+c.charCodeAt(0)-64;
          if(col>64||Number(m[2])>10000||++cells>250000) throw new Error('Лимит: 10 000 строк, 64 колонки, 250 000 ячеек');
        }
        files[name]=strToU8(xml);
      }
    }
    // Числа сохраняются вместе с исходной строкой, без преобразования длинных идентификаторов в JS number.
    const sheets=await readExcelFile(Buffer.from(zipSync(files)),{trim:false,parseNumber:s=>({numeric:s})});
    const cell=(v:unknown):ImportCell=>{
      if(v==null) return null;
      if(typeof v==='string'||typeof v==='number'||typeof v==='boolean'||v instanceof Date) return v;
      if(typeof v==='object'&&'numeric' in v&&typeof v.numeric==='string') return {numeric:v.numeric};
      throw new Error('Неподдерживаемый тип ячейки');
    };
    return sheets.map(s=>({name:s.sheet,rows:s.data.map(r=>r.slice(0,64).map(cell))}));
  } catch(e) { throw new BadRequestException(`Excel не прочитан: ${e instanceof Error?e.message:'неверная структура файла'}`); }
}

export function importDate(value:unknown):string|null {
  if(value instanceof Date) return Number.isNaN(value.getTime())?null:value.toISOString().slice(0,10);
  if(typeof value==='number'||(value&&typeof value==='object'&&'numeric' in value)) {
    const n=Number(string(value));
    if(!Number.isFinite(n)||n<61||n>100000) return null;
    return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);
  }
  const v=string(value); let result=v;
  const m=v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(m) result=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(result)&&!Number.isNaN(Date.parse(result))&&new Date(result).toISOString().slice(0,10)===result?result:null;
}
export function importMoney(value:unknown):string|null {
  const v=string(value).replace(/[ \u00a0\u202f]/g,'').replace(',','.');
  return /^\d{1,13}(\.\d{1,2})?$/.test(v)?new Prisma.Decimal(v).toFixed(2):null;
}
export function importIdentifier(value:unknown):string|null {return typeof value==='string'&&/^\d+$/.test(value.trim())?value.trim():null;}
export function normalizePlate(value:unknown) {
  const alphabet:Record<string,string>={A:'А',B:'В',E:'Е',K:'К',M:'М',H:'Н',O:'О',P:'Р',C:'С',T:'Т',Y:'У',X:'Х'};
  return string(value).toUpperCase().replace(/\s/g,'').replace(/[ABEKMHOPCTYX]/g,c=>alphabet[c]);
}
export function isMvsOrganization(value:unknown) {
  const v=string(value).toLowerCase().replace(/[^а-яa-z0-9]/g,'');
  return ['анопоразвитиюгородскойсредымвсст','аномвсст','аномосводостокстройтрест','анопоразвитиюгородскойсредымосводостокстройтрест'].includes(v);
}

export function parseImportRow(kind:ImportKind,raw:Record<string,unknown>,override:Record<string,unknown>={}):ParsedImportRow {
  const errors:string[]=[],warnings:string[]=[]; let data:Record<string,unknown>={};
  if(kind==='incidents'&&!isMvsOrganization(raw.organization)) return {data,warnings,errors,excluded:true};
  const date=(field:string,required=false)=>{const v=raw[field];if(empty(v)){if(required) errors.push(`${field}: дата обязательна`);return null;}const parsed=importDate(v);if(!parsed)errors.push(`${field}: дата не распознана`);return parsed;};
  const money=(field:string,required=false)=>{const v=raw[field];if(empty(v)){if(required)errors.push(`${field}: сумма обязательна`);return null;}const parsed=importMoney(v);if(parsed==null)errors.push(`${field}: нужна точная неотрицательная сумма с 2 знаками`);return parsed;};
  const plate=normalizePlate(raw.plate);if(!plate)errors.push('Нет государственного номера');
  if(plate!==string(raw.plate))warnings.push('Госномер нормализован для сопоставления; исходное значение сохранено');
  if(kind==='incidents') {
    const occurred=date('occurredAt',true);
    data={plate,occurredAt:occurred?`${occurred}T00:00:00+03:00`:null,incidentType:string(raw.incidentType),registrationMethod:string(raw.registrationMethod)||null,casualties:/^да$/i.test(string(raw.casualties))?true:/^нет$/i.test(string(raw.casualties))?false:null,
      conditionAfter:string(raw.conditionAfter)||null,delayReason:string(raw.delayReason)||null,status:'REVIEW',culpritCategory:null,culpritConfirmed:false,repairRequired:/не требуется/i.test(string(raw.conditionAfter))?false:/требуется/i.test(string(raw.conditionAfter))?true:null,
      expectedReturn:empty(raw.expectedReturn)?null:importDate(raw.expectedReturn),timeKnown:false,note:string(raw.note)||null};
    if(!empty(raw.expectedReturn)&&!data.expectedReturn)warnings.push('Плановый выход указан текстом, дата не установлена; текст сохранён в источнике');
    if(!empty(raw.culpritCategory))warnings.push('Категория виновника из источника требует подтверждения; автоматически не назначена');
    warnings.push('В источнике указана только дата ДТП: время 00:00 — техническое, фактическое время не установлено');
  } else {
    const identifier=importIdentifier(raw.uin);
    if(!identifier) {
      if(empty(raw.uin))warnings.push('Исходный идентификатор не указан: проверьте уникальность по госномеру, датам, описанию и сумме');
      else errors.push('УИН/идентификатор сохранён числом или некорректен: необходим подтверждённый строковый идентификатор');
    }
    const sourceStatus=string(raw.sourceStatus)||null;
    data={plate,amount:money('amount',true),paidAmount:null,paidDate:empty(raw.paidDate)?importDate(raw.paymentText):date('paidDate'),chargeDate:date('chargeDate'),detectedDate:date('detectedDate'),sourceStatus,status:'REVIEW',paymentDocument:null,note:string(raw.note)||null};
    if(sourceStatus)warnings.push(`Исходный статус «${sourceStatus}»: сумма платежа, отмена или оспаривание требуют подтверждения`);
    if(kind==='fines') Object.assign(data,{uin:identifier,violationDate:date('violationDate'),violation:string(raw.violation),fullAmount:money('fullAmount'),confirmedDiscount:null,dueDate:date('dueDate'),submittedDate:date('submittedDate')});
    else {Object.assign(data,{chargeIdentifier:identifier,passageDate:date('violationDate'),route:string(raw.violation)});if(!data.passageDate)warnings.push('Дата проезда в источнике отсутствует; в аналитику по датам проезда запись не войдёт');}
    if(!empty(raw.paymentText)&&!importDate(raw.paymentText))warnings.push('Платёж записан свободным текстом; сохранён в источнике без автоматического разбора суммы');
  }
  Object.assign(data,override);
  const schema=kind==='incidents'?incidentSchema:kind==='fines'?fineSchema:tollSchema;
  const parsed=schema.safeParse(data);
  if(!parsed.success) errors.push(...parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`));
  else data=parsed.data;
  return {data,warnings,errors:[...new Set(errors)],excluded:false};
}

export const IMPORT_COLUMNS:Record<ImportKind,Record<string,{label:string;column:number;required?:boolean}>>={
  fines:{uin:{label:'УИН',column:3,required:true},plate:{label:'Госномер',column:4,required:true},violationDate:{label:'Дата нарушения',column:5},violation:{label:'Нарушение',column:6,required:true},amount:{label:'Сумма начисления',column:7,required:true},fullAmount:{label:'Сумма без скидки',column:8},chargeDate:{label:'Дата начисления',column:2},dueDate:{label:'Срок оплаты',column:9},detectedDate:{label:'Дата обнаружения',column:10},employeeName:{label:'ФИО сотрудника',column:11},departmentName:{label:'Подразделение',column:12},submittedDate:{label:'Передано в оплату',column:13},paymentText:{label:'Исходный платёж',column:14},sourceStatus:{label:'Исходный статус',column:15},note:{label:'Примечание',column:16}},
  tolls:{uin:{label:'Идентификатор начисления',column:3,required:true},plate:{label:'Госномер',column:4,required:true},violationDate:{label:'Дата проезда',column:5,required:true},violation:{label:'Дорога / маршрут',column:6,required:true},amount:{label:'Сумма',column:7,required:true},chargeDate:{label:'Дата начисления',column:2},detectedDate:{label:'Дата обнаружения',column:10},employeeName:{label:'ФИО водителя',column:11},departmentName:{label:'Подразделение',column:12},paymentText:{label:'Исходный платёж',column:14},sourceStatus:{label:'Исходный статус',column:15},note:{label:'Примечание',column:16}},
  incidents:{organization:{label:'Организация — только МВС СТ',column:3,required:true},plate:{label:'Госномер',column:4,required:true},occurredAt:{label:'Дата ДТП',column:6,required:true},registrationMethod:{label:'Способ оформления',column:7},incidentType:{label:'Вид происшествия',column:8,required:true},casualties:{label:'Пострадавшие',column:9},culpritCategory:{label:'Исходная категория виновника',column:13},compensation:{label:'Исходный способ возмещения',column:14},conditionAfter:{label:'Состояние после ДТП',column:15},expectedReturn:{label:'Плановый выход',column:16},delayReason:{label:'Причина простоя',column:17},note:{label:'Примечание',column:18}},
};
