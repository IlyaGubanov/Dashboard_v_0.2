import { useState } from 'react';
import { Accordion,Alert,Anchor,Badge,Button,Divider,Drawer,Group,Modal,Select,SimpleGrid,Skeleton,Stack,Table,Text,Textarea,TextInput,Title } from '@mantine/core';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FLEET_LABELS,liabilitySchema,type Attachment,type AttachmentEntity,type FleetKind,type FleetRefs,type FleetRow } from '@mvs/shared';
import { api } from '../../api';
import { AddFiles,Gallery,uploadFile } from '../../ui/attachments';
import { useFinanceHidden } from '../../ui/finance';
import { fleetQueries,FLEET_BASE } from './api';
import { FIELDS } from './fields';
import { decimal,valueLabel } from './display';
import { FleetForm } from './FleetForm';

export function FleetDrawer({kind,id,refs,onClose,onOpenVehicle,onRelated}:{kind:FleetKind;id:number;refs:FleetRefs;onClose:()=>void;onOpenVehicle:(id:number)=>void;onRelated:(kind:FleetKind,id:number)=>void}) {
 const query=useQuery(fleetQueries.card(kind,id)),hidden=useFinanceHidden();const [edit,setEdit]=useState(false);
 const row=query.data,employee=refs.users.find(u=>u.id===row?.employeeId),site=refs.sites.find(s=>s.id===row?.siteId),direction=refs.directions.find(d=>d.id===site?.directionId);
 const canEdit=refs.canEdit&&!row?.isArchived&&(!['fines','tolls','fuel'].includes(kind)||refs.canFinance)&&(kind!=='snapshots'||refs.canManage);
 return <Drawer opened onClose={onClose} position="right" size="lg" zIndex={200} title={`${FLEET_LABELS[kind]} · № ${id}`}>
  {query.isPending?<Skeleton h={300}/>:query.error?<Alert color="red">{query.error.message}<Button variant="subtle" onClick={()=>query.refetch()}>Повторить</Button></Alert>:row?<Stack gap="md">
   <Group justify="space-between"><Badge variant="light" color={row.isArchived?'orange':'gray'}>{row.isArchived?'Архив':'Действующая запись'} · версия {row.version}</Badge>{canEdit?<Button size="xs" onClick={()=>setEdit(true)}>Изменить</Button>:null}</Group>
   {kind==='vehicles'?<Group><Text size="sm">Сейчас: {valueLabel(kind,'effectiveTechnicalState',row,refs)} · {valueLabel(kind,'effectiveUsageState',row,refs)}</Text>{row.currentDowntimeId?<Button variant="subtle" size="xs" onClick={()=>onRelated('downtime',id)}>Открыть простои</Button>:null}</Group>:null}
   <SimpleGrid cols={{base:1,sm:2}}>{FIELDS[kind].filter(f=>f.type!=='breakdown'&&f.type!=='allocations'&&(!f.finance||!hidden)).map(f=><div key={f.key}><Text size="xs" c="dimmed">{f.label}</Text><Text size="sm" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{valueLabel(kind,f.key,row,refs)}</Text></div>)}</SimpleGrid>
   {Array.isArray(row.breakdown)?<Table><Table.Tbody>{(row.breakdown as {label:string;quantity:number}[]).map((r,i)=><Table.Tr key={i}><Table.Td>{r.label}</Table.Td><Table.Td>{r.quantity} ед.</Table.Td></Table.Tr>)}</Table.Tbody></Table>:null}
   {kind==='requests'?<Stack gap={4}><Text fw={600}>Обеспечение: {String(row.allocated)} из {String(row.quantity)} · осталось {String(row.remaining)}</Text><Group>{(row.allocationIds as number[]??[]).map(a=><Badge key={a} variant="light">Назначение № {a}</Badge>)}</Group></Stack>:null}
   {['fines','tolls'].includes(kind)&&!hidden?<Text fw={600}>Остаток: {row.status==='CANCELLED'?'0,00 ₽':row.paidAmount!=null?decimal(exactSubtract(String(row.amount),String(row.paidAmount)),'₽'):'Не установлен — оплата не подтверждена'}</Text>:null}
   {kind==='incidents'&&!hidden&&row.damage!=null&&row.recoveredAmount!=null?<Text fw={600}>Непогашенный подтверждённый ущерб: {decimal(exactSubtract(String(row.damage),String(row.recoveredAmount)),'₽')}</Text>:null}
   {employee?<Alert color="gray" title="Сотрудник · общий справочник"><Text size="sm">{employee.name}{employee.position?' · '+employee.position:''}</Text>{employee.phone?<Anchor size="sm" href={`tel:${employee.phone}`}>{employee.phone}</Anchor>:<Text size="sm">Телефон не указан</Text>}</Alert>:null}
   {site&&direction?.code?<Button renderRoot={props=><Link to="/d/$code" params={{code:direction.code!}} search={{site:site.id}} {...props}/>} variant="light" size="xs">Открыть объект: {site.name}</Button>:null}
   {row.vehicleId?<Button variant="light" size="xs" onClick={()=>onOpenVehicle(Number(row.vehicleId))}>Карточка связанной техники</Button>:null}
   {kind==='vehicles'?<Group gap="xs">{(['assignments','incidents','fines','tolls','downtime'] as const).map(k=><Button key={k} variant="light" size="xs" onClick={()=>onRelated(k,id)}>{FLEET_LABELS[k]}</Button>)}</Group>:null}
   <Text size="xs" c="dimmed">Внесено: {new Date(row.createdAt).toLocaleString('ru-RU')} · обновлено: {new Date(row.updatedAt).toLocaleString('ru-RU')}</Text>
   {!hidden&&row.sourceRaw?<Accordion variant="contained"><Accordion.Item value="source"><Accordion.Control>Исходная строка · без изменений</Accordion.Control><Accordion.Panel><SourceRow value={row.sourceRaw}/></Accordion.Panel></Accordion.Item></Accordion>:null}
   {['vehicles','incidents','fines','tolls','requests'].includes(kind)&&(!['fines','tolls'].includes(kind)||refs.canFinance)?<FleetFiles entity={`fleet_${kind}` as AttachmentEntity} id={id} refs={refs}/>:null}
   {kind==='incidents'&&refs.canLiability&&!hidden?<Liability incidentId={id} refs={refs}/>:null}
   {refs.canAudit?<FleetHistory kind={kind} id={id} refs={refs}/>:null}
  </Stack>:null}
  {edit&&row?<FleetForm kind={kind} row={row} refs={refs} onClose={()=>setEdit(false)} onSaved={()=>{setEdit(false);query.refetch();}}/>:null}
 </Drawer>;
}
function exactSubtract(a:string,b:string) {const cents=(s:string)=>{const [i,f='']=s.split('.');return BigInt(i)*100n+BigInt(f.padEnd(2,'0').slice(0,2));};const n=cents(a)-cents(b),sign=n<0n?'-':'',abs=n<0n?-n:n;return sign+(abs/100n)+'.'+String(abs%100n).padStart(2,'0');}

export function FleetFiles({entity,id,refs}:{entity:AttachmentEntity;id:number;refs:FleetRefs}) {
 const qc=useQueryClient(),hidden=useFinanceHidden(),[visibility,setVisibility]=useState<'GENERAL'|'FINANCE'|'LIABILITY'>(refs.canFinance?'FINANCE':'GENERAL');
 const key=['dir','reb','fleet','files',entity,id];
 const {data,error}=useQuery({queryKey:key,queryFn:()=>api<{files:Attachment[];canUpload:boolean}>(`/attachments?entity=${entity}&entityId=${id}`)});
 const upload=useMutation({mutationFn:async(files:File[])=>{for(const file of files)await uploadFile(entity,id,file,visibility);},onSettled:()=>qc.invalidateQueries({queryKey:key})});
 if(error)return <Alert color="red">Файлы: {error.message}</Alert>;
 return <Stack gap="xs"><Divider/><Title order={5}>Документы и фотографии</Title>{data?.canUpload?<><Select label="Доступ к новым файлам" value={visibility} onChange={v=>setVisibility(v as typeof visibility)} data={[{value:'GENERAL',label:'По правам направления'},...(refs.canFinance?[{value:'FINANCE',label:'Только с доступом к финансам'}]:[]),...(refs.canLiability?[{value:'LIABILITY',label:'Куратор с финансами — персональная ответственность'}]:[])]} comboboxProps={{zIndex:1000}}/><AddFiles onFiles={files=>upload.mutate(files)} busy={upload.isPending}/></>:null}{upload.error?<Alert color="red">{upload.error.message}</Alert>:null}<Gallery files={(data?.files??[]).filter(f=>!hidden||f.visibility==='GENERAL')} onChanged={()=>qc.invalidateQueries({queryKey:key})}/>{!data?.files.length?<Text size="sm" c="dimmed">Нет доступных вложений</Text>:null}</Stack>;
}
function SourceRow({value}:{value:unknown}) {
 const v=value as {sheet?:string;row?:number;cells?:unknown[]};
 return <Stack gap={4}><Text size="xs">Лист: {v.sheet??'—'} · строка: {v.row??'—'}</Text><Table><Table.Tbody>{(v.cells??[]).map((cell,i)=><Table.Tr key={i}><Table.Td>{i+1}</Table.Td><Table.Td style={{overflowWrap:'anywhere'}}>{cell==null?'—':typeof cell==='object'&&'numeric' in cell?String(cell.numeric):String(cell)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Stack>;
}
function FleetHistory({kind,id,refs}:{kind:FleetKind;id:number;refs:FleetRefs}) {
 const [opened,setOpened]=useState(false),hidden=useFinanceHidden();
 const {data,error,isPending}=useQuery({queryKey:['dir','reb','fleet','history',kind,id],queryFn:()=>api<{id:string;at:string;user:{fullName:string}|null;before:Record<string,unknown>|null;after:Record<string,unknown>|null}[]>(`${FLEET_BASE}/${kind}/${id}/history`),enabled:opened});
 return <Accordion variant="contained" onChange={v=>setOpened(v==='history')}><Accordion.Item value="history"><Accordion.Control>История изменений</Accordion.Control><Accordion.Panel>{isPending?<Skeleton h={70}/>:error?<Alert color="red">{error.message}</Alert>:<Stack gap="sm">{data?.map(event=><div key={event.id}><Text size="xs" c="dimmed">{new Date(event.at).toLocaleString('ru-RU')} · {event.user?.fullName??'Система'}</Text>{FIELDS[kind].filter(f=>(!f.finance||!hidden)&&JSON.stringify(event.before?.[f.key]??null)!==JSON.stringify(event.after?.[f.key]??null)).map(f=><Text key={f.key} size="xs"><strong>{f.label}:</strong> {event.before?valueLabel(kind,f.key,event.before as FleetRow,refs):'—'} → {event.after?valueLabel(kind,f.key,event.after as FleetRow,refs):'—'}</Text>)}</div>)}</Stack>}</Accordion.Panel></Accordion.Item></Accordion>;
}
function Liability({incidentId,refs}:{incidentId:number;refs:FleetRefs}) {
 const [edit,setEdit]=useState(false);const key=['dir','reb','fleet','liability',incidentId],qc=useQueryClient();
 const {data,error}=useQuery({queryKey:key,queryFn:()=>api<Record<string,unknown>|null>(`${FLEET_BASE}/incidents/${incidentId}/liability`)});
 const [values,setValues]=useState<Record<string,unknown>>({}),[validation,setValidation]=useState('');
 const save=useMutation({mutationFn:(body:unknown)=>api(`${FLEET_BASE}/incidents/${incidentId}/liability`,{method:'POST',body}),onSuccess:async()=>{setEdit(false);await qc.invalidateQueries({queryKey:key});}});
 const set=(key:string,value:unknown)=>setValues(v=>({...v,[key]:value}));
 return <Stack gap="xs"><Divider/><Title order={5}>Подтверждённая ответственность сотрудника</Title>{error?<Alert color="red">{error.message}</Alert>:data?<Text size="sm">Подтверждено: {decimal(data.confirmedAmount,'₽')} · возмещено: {decimal(data.recoveredAmount,'₽')} · остаток: {decimal(data.balance,'₽')}</Text>:<Text size="sm" c="dimmed">Не установлена. Участие сотрудника в ДТП само по себе не создаёт ответственность.</Text>}<Button size="xs" variant="light" onClick={()=>{setValues(data??{});setValidation('');setEdit(true);}}>Указать подтверждённые сведения</Button><FleetFiles entity="fleet_liability" id={incidentId} refs={refs}/><Modal opened={edit} onClose={()=>setEdit(false)} title="Подтверждённая материальная ответственность" zIndex={400}><Stack><Select label="Сотрудник" searchable data={refs.users.map(u=>({value:String(u.id),label:u.name}))} value={values.employeeId?String(values.employeeId):null} onChange={v=>set('employeeId',v?Number(v):null)} comboboxProps={{zIndex:1000}}/><TextInput label="Подтверждено, ₽" value={String(values.confirmedAmount??'')} onChange={e=>set('confirmedAmount',e.currentTarget.value.replace(',','.'))}/><TextInput label="Фактически возмещено, ₽" value={String(values.recoveredAmount??'')} onChange={e=>set('recoveredAmount',e.currentTarget.value.replace(',','.'))}/><Textarea label="Документ подтверждения" value={String(values.evidence??'')} onChange={e=>set('evidence',e.currentTarget.value)}/><Textarea label="Примечание" value={String(values.note??'')} onChange={e=>set('note',e.currentTarget.value||null)}/>{validation?<Alert color="red">{validation}</Alert>:null}{save.error?<Alert color="red">{save.error.message}</Alert>:null}<Button loading={save.isPending} onClick={()=>{const body={employeeId:values.employeeId,confirmedAmount:values.confirmedAmount,recoveredAmount:values.recoveredAmount,evidence:values.evidence,note:values.note,...(data?{version:values.version}:{})};const parsed=liabilitySchema.safeParse(body);if(!parsed.success){setValidation(parsed.error.issues.map(e=>e.message).join('; '));return;}save.mutate(parsed.data);}}>Сохранить подтверждение</Button></Stack></Modal></Stack>;
}
