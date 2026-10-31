import { Alert,Anchor,Badge,Button,Card,Group,SimpleGrid,Skeleton,Stack,Table,Text,Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconArrowUpRight,IconInfoCircle,IconTruck } from '@tabler/icons-react';
import type { FleetKind } from '@mvs/shared';
import { useFinanceHidden } from '../../ui/finance';
import { fleetQueries,type Filters } from './api';
import { decimal } from './display';

export function FleetOverview({filters,onSection}:{filters:Filters;onSection:(k:FleetKind)=>void}) {
 const {data,error,isPending}=useQuery(fleetQueries.overview(filters)),hidden=useFinanceHidden();
 if(isPending)return <Skeleton h={280}/>;
 if(error)return <Alert color="red">{error.message}</Alert>;
 const c=data.counts;
 const tiles:{label:string;value:unknown;section:FleetKind;unit?:string;attention?:boolean}[]=[
 {label:'Всего в индивидуальном реестре',value:c?.total,section:'vehicles'}, {label:'Собственная',value:c?.own,section:'vehicles'}, {label:'Арендуемая',value:c?.rented,section:'vehicles'}, {label:'Используется',value:c?.used,section:'assignments'}, {label:'Не используется',value:c?.unused,section:'downtime'}, {label:'В ремонте',value:c?.repair,section:'downtime',attention:true}, {label:'В резерве',value:c?.reserve,section:'vehicles'}, {label:'ДТП за период',value:data.incidents,section:'incidents'}, {label:'Открытые потребности',value:data.openRequests,section:'requests'}, {label:'Топливо за период',value:data.fuel.liters,unit:'л',section:'fuel'},
 ...(!hidden?[{label:'Штрафы · начислено',value:data.fines?.charged,unit:'₽',section:'fines' as const},{label:'Штрафы · остаток',value:data.fines?.balance,unit:'₽',section:'fines' as const,attention:true},{label:'Платные дороги',value:data.tolls?.charged,unit:'₽',section:'tolls' as const},{label:'Топливо · стоимость',value:data.fuel.cost,unit:'₽',section:'fuel' as const}]:[]),
 ];
 const snapshot=data.snapshot;
 return <Stack gap="md">
  <Group justify="space-between"><Text size="sm" c="dimmed">Актуальность реестров: {data.asOf?new Date(data.asOf).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'данных пока нет'}</Text>{c?.unknown?<Badge color="gray" variant="light">Принадлежность не установлена: {c.unknown}</Badge>:null}</Group>
  <SimpleGrid cols={{base:2,sm:3,xl:5}} spacing="xs">{tiles.map(t=><Card key={t.label} withBorder p="sm" className={t.attention&&t.value?'kpi-alert':''}><Anchor component="button" onClick={()=>onSection(t.section)} ta="left" c="inherit" underline="never"><Text size="xs" c="dimmed">{t.label}</Text><Group gap={6} justify="space-between"><Text className="kpi-value">{decimal(t.value,t.unit)}</Text><IconArrowUpRight size={14}/></Group></Anchor></Card>)}</SimpleGrid>
  {!hidden?<Group gap="md"><Text size="sm">Штрафов: {data.fines?.count??'—'} · просрочено с подтверждённой оплатой: {data.fines?.overdue??'—'}</Text><Text size="sm">Проездов: {data.tolls?.count??'—'} · остаток: {decimal(data.tolls?.balance,'₽')}</Text></Group>:null}
  {snapshot?<Card withBorder p="md"><Group justify="space-between"><div><Group gap="xs"><Title order={4}>Исторический срез · {String(snapshot.asOfDate).slice(0,10).split('-').reverse().join('.')}</Title><Badge color="gray" variant="light">Агрегированные данные</Badge></Group><Text size="xs" c="dimmed">{String(snapshot.source)}</Text></div><Button variant="subtle" size="xs" onClick={()=>onSection('snapshots')}>История срезов</Button></Group><SimpleGrid cols={{base:2,sm:4}} mt="sm">{[['Всего',snapshot.total],['Используется',snapshot.used],['Не используется',snapshot.unused],['В ремонте',snapshot.repair]].map(([k,v])=><div key={String(k)}><Text size="xs" c="dimmed">{k as string}</Text><Text fw={700} size="xl">{decimal(v)}</Text></div>)}</SimpleGrid><Table.ScrollContainer minWidth={320}><Table mt="xs"><Table.Tbody>{(snapshot.breakdown as {label:string;quantity:number}[]??[]).map((r,i)=><Table.Tr key={i}><Table.Td>{r.label}</Table.Td><Table.Td ta="right">{r.quantity} ед.</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer><Text size="xs" c="dimmed" mt="xs">Срез хранится отдельно; его количества не прибавляются к индивидуальному реестру.</Text></Card>:<Alert icon={<IconInfoCircle size={16}/>} color="gray">Исторический срез пока не внесён. <Button size="xs" variant="subtle" onClick={()=>onSection('snapshots')}>Добавить срез</Button></Alert>}
  {data.warnings.length?<Alert title="Расхождения исходных данных" color="orange">{data.warnings.map((w,i)=><Text key={i} size="sm">{w}</Text>)}</Alert>:null}
 </Stack>;
}

/** РЭБ показывается отдельно от строительной готовности и ресурсов объектов. */
export function FleetSummaryCard(){
 const {data,error}=useQuery(fleetQueries.overview({}));
 return <Card withBorder><Group justify="space-between"><Group><IconTruck size={22}/><Title order={4}>РЭБ · техника и эксплуатация</Title></Group><Button component="a" href="/d/reb" variant="light" size="xs">Открыть РЭБ</Button></Group>{error?<Text c="red" size="sm">{error.message}</Text>:<Text mt="xs" size="sm">В индивидуальном реестре: {data?.counts?.total??'—'} · в ремонте: {data?.counts?.repair??'—'} · открытых потребностей: {data?.openRequests??'—'}</Text>}</Card>;
}
