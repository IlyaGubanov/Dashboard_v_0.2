import { useState } from 'react';
import { Alert,Button,Checkbox,Group,Modal,MultiSelect,NumberInput,Select,SimpleGrid,Stack,Text,Textarea,TextInput } from '@mantine/core';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { FLEET_LABELS,FLEET_SCHEMAS,type FleetKind,type FleetRefs,type FleetRow } from '@mvs/shared';
import { api,ApiError } from '../../api';
import { DEFAULTS,FIELDS,type Field } from './fields';
import { FLEET_BASE } from './api';

function editable(kind:FleetKind,row?:FleetRow) {
 const values:Record<string,unknown>={...DEFAULTS[kind]};
 if(row) {for(const f of FIELDS[kind])if(row[f.key]!==undefined)values[f.key]=f.type==='date'?String(row[f.key]??'').slice(0,10)||null:f.type==='datetime'&&row[f.key]?new Date(String(row[f.key])).toLocaleString('sv-SE',{timeZone:'Europe/Moscow'}).slice(0,16).replace(' ','T'):row[f.key];values.version=row.version;}
 return values;
}
export function FleetForm({kind,row,refs,onClose,onSaved}:{kind:FleetKind;row?:FleetRow;refs:FleetRefs;onClose:()=>void;onSaved:(row:FleetRow)=>void}) {
 const [values,setValues]=useState(()=>editable(kind,row));const [errors,setErrors]=useState<Record<string,string>>({});const qc=useQueryClient();
 const set=(key:string,value:unknown)=>{setValues(v=>({...v,[key]:value}));setErrors(e=>({...e,[key]:''}));};
 const mutation=useMutation({mutationFn:(body:unknown)=>api<FleetRow>(`${FLEET_BASE}/${kind}${row?'/'+row.id:''}`,{method:row?'PATCH':'POST',body}),onSuccess:async result=>{await qc.invalidateQueries({queryKey:['fleet']});await qc.invalidateQueries({queryKey:['overview']});onSaved(result);},onError:e=>{if(e instanceof ApiError)setErrors(e.fields);}});
 function submit() {
   const body={...values};for(const f of FIELDS[kind])if(f.type==='datetime'&&body[f.key])body[f.key]=new Date(String(body[f.key])+'+03:00').toISOString();
   const checked=FLEET_SCHEMAS[kind].safeParse(body);
   if(!checked.success){setErrors(Object.fromEntries(checked.error.issues.map(e=>[e.path.join('.')||'_',e.message])));return;}
   mutation.mutate(checked.data);
 }
 const fields=FIELDS[kind].filter(f=>!f.finance||refs.canFinance);
 return <Modal opened onClose={()=>{if(!mutation.isPending)onClose();}} closeOnClickOutside={!mutation.isPending} closeOnEscape={!mutation.isPending} withCloseButton={!mutation.isPending} title={`${row?'Изменить':'Добавить'} · ${FLEET_LABELS[kind]}`} size="xl" zIndex={400}>
  <form onSubmit={e=>{e.preventDefault();submit();}}><fieldset disabled={mutation.isPending} style={{border:0,padding:0,margin:0,minWidth:0}}><Stack>
   {kind==='assignments'||kind==='requests'?<Text size="xs" c="dimmed">Окончание периода не включается. В дату передачи техника может быть закреплена на новом объекте.</Text>:null}
   {kind==='downtime'?<Text size="xs" c="dimmed">Простой влияет на состояние только в своём периоде. Подтверждённое состояние техники хранится в её карточке.</Text>:null}
   <SimpleGrid cols={{base:1,sm:2}}>{fields.map(field=><FieldControl key={field.key} field={field} value={values[field.key]} onChange={v=>set(field.key,v)} error={errors[field.key]} refs={refs} values={values}/>)}</SimpleGrid>
   {errors._?<Alert color="red">{errors._}</Alert>:null}
   {mutation.error?<Alert color="red">{mutation.error.message}{mutation.error instanceof ApiError&&mutation.error.status===409?' Закройте форму и откройте карточку заново.':''}</Alert>:null}
   <Group justify="flex-end"><Button variant="default" onClick={onClose}>Отмена</Button><Button type="submit" loading={mutation.isPending}>Сохранить</Button></Group>
  </Stack></fieldset></form>
 </Modal>;
}
function FieldControl({field:f,value,onChange,error,refs,values}:{field:Field;value:unknown;onChange:(v:unknown)=>void;error?:string;refs:FleetRefs;values:Record<string,unknown>}) {
 const props={label:f.label,required:f.required,error,description:f.description};
 if(f.type==='bool')return <Checkbox mt="sm" label={f.label} checked={value===true} onChange={e=>onChange(e.currentTarget.checked)}/>;
 if(f.type==='nullableBool')return <Select {...props} data={[{value:'yes',label:'Да'},{value:'no',label:'Нет'},{value:'unknown',label:'Не установлено'}]} value={value===true?'yes':value===false?'no':'unknown'} onChange={v=>onChange(v==='yes'?true:v==='no'?false:null)} comboboxProps={{zIndex:1000}}/>;
 if(f.type==='select')return <Select {...props} data={Object.entries(f.options??{}).map(([value,label])=>({value,label}))} value={typeof value==='string'?value:null} onChange={v=>onChange(v)} searchable clearable={!f.required} comboboxProps={{zIndex:1000}}/>;
 if(f.type==='ref') {
  const items=f.ref==='fuelTypes'?refs.fuelTypes.map(v=>({value:v,label:v})):(refs[f.ref??'users'] as {id:number;name:string;directionId?:number}[]).filter(v=>f.ref!=='sites'||!values.targetDirectionId||v.directionId===values.targetDirectionId).map(v=>({value:String(v.id),label:v.name}));
  return <Select {...props} data={items} value={value==null?null:String(value)} onChange={v=>onChange(v==null?null:f.ref==='fuelTypes'?v:Number(v))} searchable clearable={!f.required} nothingFoundMessage="Нет доступных записей" comboboxProps={{zIndex:1000}}/>;
 }
 if(f.type==='allocations')return <MultiSelect {...props} data={refs.assignments.map(v=>({value:String(v.id),label:v.name}))} value={Array.isArray(value)?value.map(String):[]} onChange={v=>onChange(v.map(Number))} searchable comboboxProps={{zIndex:1000}}/>;
 if(f.type==='breakdown')return <Breakdown value={Array.isArray(value)?value:[]} onChange={onChange} refs={refs} error={error}/>;
 if(f.type==='number')return <NumberInput {...props} value={value==null?'':Number(value)} onChange={v=>onChange(v===''?null:Number(v))} min={0} allowDecimal={false}/>;
 if(f.type==='money')return <TextInput {...props} inputMode="decimal" placeholder="Не установлено" value={value==null?'':String(value)} onChange={e=>onChange(e.currentTarget.value===''?null:e.currentTarget.value.replace(',','.').replaceAll(' ',''))}/>;
 if(f.type==='date'||f.type==='datetime')return <TextInput {...props} type={f.type==='date'?'date':'datetime-local'} value={value==null?'':String(value)} onChange={e=>onChange(e.currentTarget.value||null)}/>;
 if(['note','description','cause','workPurpose','reason','delayReason','details','dailyMethod','decisionReason','comment'].includes(f.key))return <Textarea {...props} autosize minRows={2} value={value==null?'':String(value)} onChange={e=>onChange(e.currentTarget.value||null)}/>;
 return <TextInput {...props} value={value==null?'':String(value)} onChange={e=>onChange(e.currentTarget.value||null)}/>;
}
function Breakdown({value,onChange,refs,error}:{value:unknown[];onChange:(v:unknown)=>void;refs:FleetRefs;error?:string}) {
 const rows=value as {label:string;quantity:number;targetDirectionId?:number|null}[];
 const update=(i:number,patch:object)=>onChange(rows.map((r,j)=>j===i?{...r,...patch}:r));
 return <Stack gap="xs"><Text size="sm" fw={500}>Распределение используемой техники</Text>{rows.map((r,i)=><Stack key={i} gap={4} p="xs" style={{border:'1px solid var(--line)',borderRadius:6}}><TextInput label="Название из источника" value={r.label} onChange={e=>update(i,{label:e.currentTarget.value})}/><Group grow><NumberInput label="Количество" min={0} allowDecimal={false} value={r.quantity} onChange={v=>update(i,{quantity:Number(v)})}/><Select label="Связь с направлением" clearable searchable data={refs.directions.map(d=>({value:String(d.id),label:d.name}))} value={r.targetDirectionId?String(r.targetDirectionId):null} onChange={v=>update(i,{targetDirectionId:v?Number(v):null})} comboboxProps={{zIndex:1000}}/></Group><Button variant="subtle" size="xs" color="red" onClick={()=>onChange(rows.filter((_,j)=>j!==i))}>Убрать строку</Button></Stack>)}<Button variant="light" size="xs" onClick={()=>onChange([...rows,{label:'',quantity:0}])}>Добавить направление</Button>{error?<Text c="red" size="xs">{error}</Text>:null}</Stack>;
}
