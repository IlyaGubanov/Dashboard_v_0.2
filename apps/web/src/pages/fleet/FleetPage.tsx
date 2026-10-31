import { useState } from 'react';
import { Alert,Button,Group,SegmentedControl,Select,SimpleGrid,Skeleton,Stack,Switch,Tabs,Text,TextInput,Title } from '@mantine/core';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconFileImport,IconPlus,IconRefresh,IconSearch,IconTruck } from '@tabler/icons-react';
import { FLEET_KINDS,FLEET_LABELS,OWNERSHIP,FUEL_CATEGORIES,TECHNICAL_STATE,USAGE_STATE } from '@mvs/shared';
import type { DirectionSearch } from '../direction/search';
import { canSee } from '../../ui/access';
import { meQuery } from '../../api';
import { fleetQueries } from './api';
import { COLUMNS,FIELDS,LABELS } from './fields';
import { FleetOverview } from './FleetOverview';
import { FleetList } from './FleetList';
import { FleetForm } from './FleetForm';
import { FleetDrawer } from './FleetDrawer';
import { FleetImport } from './FleetImport';
import { FleetSettings } from './FleetSettings';

const route=getRouteApi('/app/d/$code');
export default function FleetPage() {
 const search=route.useSearch(),navigate=route.useNavigate(),qc=useQueryClient(),{data:me}=useQuery(meQuery);
 const {data:refs,error,isPending}=useQuery({...fleetQueries.refs,enabled:!!me&&canSee(me,'fleet')});
 const [create,setCreate]=useState(false),[importOpen,setImportOpen]=useState(false);
 const [settings,setSettings]=useState(false),[idleView,setIdleView]=useState('current');
 const section=search.fleet??'overview',filters=search.ff??{};
 const set=(patch:Partial<DirectionSearch>)=>navigate({search:(s:DirectionSearch)=>({...s,...patch})});
 const filter=(key:string,value:string|undefined)=>set({ff:{...filters,[key]:value??'',page:key==='page'?value??'1':'1'}});
 const sectionSet=(fleet:typeof section)=>{setCreate(false);set({fleet,fr:undefined,ff:{from:filters.from??'',to:filters.to??'',page:'1'}});};
 if(me&&!canSee(me,'fleet'))return <Alert color="red">Раздел РЭБ вам недоступен</Alert>;
 if(isPending)return <Skeleton h={300}/>;
 if(error)return <Alert color="red">{error.message}<Button variant="subtle" onClick={()=>qc.invalidateQueries({queryKey:['dir','reb']})}>Повторить</Button></Alert>;
 if(!refs)return null;
 const financial=['fines','tolls','fuel'].includes(section),canCreate=section!=='overview'&&refs.canEdit&&(!financial||refs.canFinance)&&(section!=='snapshots'||refs.canManage);
 const status=section!=='overview'?FIELDS[section].find(f=>f.key==='status')?.options:undefined;
 const refresh=()=>{qc.invalidateQueries({queryKey:['dir','reb']});qc.invalidateQueries({queryKey:['overview']});};
 const labels=[{value:'overview',label:FLEET_LABELS.overview},...FLEET_KINDS.filter(k=>k!=='snapshots').map(value=>({value,label:FLEET_LABELS[value]}))];
 return <Stack gap="md" style={{minWidth:0}}>
  <Group justify="space-between" align="flex-start"><Group gap="sm" wrap="nowrap"><IconTruck size={30}/><div><Title order={2}>РЭБ — Ремонтно-эксплуатационная база</Title><Text size="sm" c="dimmed">{FLEET_LABELS[section]}</Text></div></Group><Group gap="xs"><Button size="xs" variant="default" leftSection={<IconRefresh size={14}/>} onClick={refresh}>Обновить</Button>{refs.canManage&&refs.canFinance?<Button size="xs" variant="light" leftSection={<IconFileImport size={14}/>} onClick={()=>setImportOpen(true)}>Импорт Excel</Button>:null}{canCreate?<Button size="xs" leftSection={<IconPlus size={14}/>} onClick={()=>setCreate(true)}>Добавить</Button>:null}</Group></Group>
  <Select hiddenFrom="sm" label="Раздел РЭБ" value={section==='snapshots'?'overview':section} data={labels} allowDeselect={false} onChange={v=>sectionSet(v as typeof section)}/>
  <Tabs value={section==='snapshots'?'overview':section} onChange={v=>sectionSet(v as typeof section)}><Tabs.List visibleFrom="sm" style={{flexWrap:'wrap'}}>{labels.map(t=><Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>)}</Tabs.List></Tabs>
  {refs.canManage?<Group justify="flex-end"><Button size="compact-xs" variant="subtle" onClick={()=>setSettings(true)}>Справочники РЭБ</Button></Group>:null}
  <SimpleGrid cols={{base:2,sm:3,lg:5}} spacing="xs"><TextInput type="date" label="Период с" value={filters.from??''} onChange={e=>filter('from',e.currentTarget.value)}/><TextInput type="date" label="По" value={filters.to??''} onChange={e=>filter('to',e.currentTarget.value)}/>{!['fuel','snapshots'].includes(section)?<><Select label="Принадлежность" placeholder="Любая" clearable value={filters.ownership||null} data={Object.entries(OWNERSHIP).map(([value,label])=>({value,label}))} onChange={v=>filter('ownership',v??'')}/><TextInput label="Вид техники" placeholder="Все виды" value={filters.kind??''} onChange={e=>filter('kind',e.currentTarget.value)}/><Select label="Подразделение" placeholder="Все" clearable searchable value={filters.departmentId||null} data={refs.departments.map(v=>({value:String(v.id),label:v.name}))} onChange={v=>filter('departmentId',v??'')}/></>:null}{section==='fuel'?<><Select label="Вид топлива" placeholder="Все" clearable data={refs.fuelTypes} value={filters.fuelType||null} onChange={v=>filter('fuelType',v??'')}/><Select label="Категория" placeholder="Все категории" clearable data={[...FUEL_CATEGORIES]} value={filters.category||null} onChange={v=>filter('category',v??'')}/></>:null}</SimpleGrid>
  {section==='overview'?<><FleetOverview filters={filters} onSection={sectionSet}/><Group><Button size="xs" variant="subtle" onClick={()=>sectionSet('snapshots')}>Исторические срезы справки</Button></Group></>:<>
   {section==='snapshots'?<Alert color="gray">Агрегированный исторический срез. Не создаёт автомобили и не суммируется с индивидуальным реестром.</Alert>:null}
   <SimpleGrid cols={{base:1,sm:2,lg:4}} spacing="xs"><TextInput label="Поиск по реестру" placeholder="Номер, наименование, примечание" leftSection={<IconSearch size={15}/>} value={filters.q??''} onChange={e=>filter('q',e.currentTarget.value)}/>{!['vehicles','fuel','snapshots','downtime'].includes(section)?<Select label="Направление использования" placeholder="Все направления" clearable searchable value={filters.targetDirectionId||null} data={refs.directions.map(v=>({value:String(v.id),label:v.name}))} onChange={v=>filter('targetDirectionId',v??'')}/>:null}{status?<Select label="Статус" clearable placeholder="Все статусы" value={filters.status||null} data={Object.entries(status).map(([value,label])=>({value,label}))} onChange={v=>filter('status',v??'')}/>:null}<Select label="Сортировка" clearable value={filters.sort||null} data={COLUMNS[section].filter(k=>!k.startsWith('effective')).map(k=>({value:k,label:LABELS[k]??k}))} onChange={v=>filter('sort',v??'')}/></SimpleGrid>
   <Group><Switch label="Архив" checked={filters.archived==='true'} onChange={e=>filter('archived',String(e.currentTarget.checked))}/><Switch label="По убыванию" checked={filters.order==='desc'} onChange={e=>filter('order',e.currentTarget.checked?'desc':'asc')}/>{section==='requests'?<Select aria-label="Активные и завершённые заявки" value={filters.active??''} data={[{value:'',label:'Все заявки'},{value:'true',label:'Активные'},{value:'false',label:'Завершённые'}]} onChange={v=>filter('active',v??'')}/>:null}{filters.vehicleId?<Button size="compact-xs" variant="light" onClick={()=>filter('vehicleId','')}>Снять отбор по технике № {filters.vehicleId}</Button>:null}</Group>
   {section==='vehicles'?<SimpleGrid cols={{base:1,sm:2}}><Select label="Техническое состояние сейчас" clearable value={filters.technicalState||null} data={Object.entries(TECHNICAL_STATE).map(([value,label])=>({value,label}))} onChange={v=>filter('technicalState',v??'')}/><Select label="Использование сейчас" clearable value={filters.usageState||null} data={Object.entries(USAGE_STATE).map(([value,label])=>({value,label}))} onChange={v=>filter('usageState',v??'')}/></SimpleGrid>:null}
   {section==='downtime'?<SegmentedControl value={idleView} onChange={setIdleView} data={[{value:'current',label:'Неиспользуемая сейчас'},{value:'history',label:'История простоев'}]} size="xs"/>:null}
   {section==='downtime'&&idleView==='current'?<FleetList kind="vehicles" filters={{...filters,usageState:'UNUSED'}} refs={refs} columnsOverride={['name','kind','ownership','currentDowntimeReason','currentDowntimeStart','effectiveTechnicalState','currentExpectedReturn','currentDowntimeEmployeeId']} onOpen={fr=>set({fleet:'vehicles',fr,ff:{}})} onPage={p=>filter('page',String(p))} onVehicle={fr=>set({fleet:'vehicles',fr,ff:{}})}/>:<FleetList key={section} kind={section} filters={filters} refs={refs} onOpen={fr=>set({fr})} onPage={p=>filter('page',String(p))} onVehicle={fr=>set({fleet:'vehicles',fr,ff:{}})}/>}
  </>}
  {create&&section!=='overview'?<FleetForm kind={section} refs={refs} onClose={()=>setCreate(false)} onSaved={r=>{setCreate(false);set({fr:r.id});}}/>:null}
  {search.fr&&section!=='overview'?<FleetDrawer key={section+search.fr} kind={section} id={search.fr} refs={refs} onClose={()=>set({fr:undefined})} onOpenVehicle={fr=>set({fleet:'vehicles',fr,ff:{}})} onRelated={(fleet,id)=>set({fleet,fr:undefined,ff:{vehicleId:String(id)}})}/>:null}
  {importOpen?<FleetImport initial={['incidents','fines','tolls'].includes(section)?section as 'incidents'|'fines'|'tolls':'incidents'} refs={refs} onClose={()=>setImportOpen(false)}/>:null}
  {settings?<FleetSettings refs={refs} onClose={()=>setSettings(false)}/>:null}
 </Stack>;
}
