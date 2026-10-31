import { Badge,Text } from '@mantine/core';
import { TECHNICAL_STATE,USAGE_STATE,DOWNTIME_REASON,type FleetKind,type FleetRefs,type FleetRow } from '@mvs/shared';
import { FIELDS } from './fields';

export function decimal(value:unknown,unit='') {
 if(value==null||value==='')return '—';const s=String(value),m=s.match(/^(-?\d+)(?:\.(\d+))?$/);
 return (m?BigInt(m[1]).toLocaleString('ru-RU')+(m[2]?','+m[2].padEnd(2,'0'):'' ):s)+(unit?' '+unit:'');
}
export function valueLabel(kind:FleetKind,key:string,row:FleetRow,refs:FleetRefs):string {
 const v=row[key];if(v==null||v==='')return '—';
 const field=FIELDS[kind].find(f=>f.key===key);
 if(key==='currentDowntimeReason')return DOWNTIME_REASON[String(v) as keyof typeof DOWNTIME_REASON]??String(v);
 if(key==='currentDowntimeStart'||key==='currentExpectedReturn')return String(v).slice(0,10).split('-').reverse().join('.');
 if(key==='currentDowntimeEmployeeId')return refs.users.find(u=>u.id===v)?.name??'Не установлен';
 if(key==='effectiveTechnicalState')return TECHNICAL_STATE[String(v) as keyof typeof TECHNICAL_STATE]??String(v);
 if(key==='effectiveUsageState')return USAGE_STATE[String(v) as keyof typeof USAGE_STATE]??String(v);
 if(field?.type==='ref') {if(field.ref==='fuelTypes')return String(v);const items=refs[field.ref??'users'] as {id:number;name:string}[];return items.find(x=>x.id===v)?.name??'Связь недоступна';}
 if(field?.type==='date')return String(v).slice(0,10).split('-').reverse().join('.');
 if(field?.type==='datetime')return new Date(String(v)).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',...(row.timeKnown===false?{}:{hour:'2-digit',minute:'2-digit'})})+(row.timeKnown===false?' · время не установлено':'');
 if(field?.options)return field.options[String(v)]??String(v);
 if(typeof v==='boolean')return v?'Да':'Нет';
 if(field?.type==='money')return decimal(v,field.finance?'₽':'л');
 if(Array.isArray(v))return v.map(String).join(', ');
 return String(v);
}
export function StatusValue({value,label}:{value:unknown;label:string}) {
 const state=String(value);const good=['OK','PAID','FULFILLED','CLOSED','ACTIVE'].includes(state),bad=['FAULTY','URGENT'].includes(state),warn=['REPAIR','PARTIAL','HIGH','INVESTIGATION','UNNEEDED'].includes(state);
 return <Badge variant="light" color={bad?'red':warn?'orange':good?'green':'gray'} style={{height:'auto',whiteSpace:'normal',textTransform:'none',textAlign:'left'}}>{bad?'! ':warn?'◷ ':good?'✓ ':'· '}{label}</Badge>;
}
export function Cell({kind,column,row,refs}:{kind:FleetKind;column:string;row:FleetRow;refs:FleetRefs}) {
 const label=valueLabel(kind,column,row,refs);
 return ['status','technicalState','usageState','effectiveTechnicalState','effectiveUsageState','ownership','reason','priority'].includes(column)?<StatusValue value={row[column]} label={label}/>:<Text size="sm" style={{overflowWrap:'anywhere'}}>{label}</Text>;
}
