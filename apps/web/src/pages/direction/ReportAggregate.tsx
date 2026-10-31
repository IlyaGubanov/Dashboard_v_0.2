import { useEffect, useState } from 'react';
import { Accordion, Alert, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CKKB_GROUPS, CKKB_GROUP_LABELS, CKKB_TYPES, ckkbTypeLabel, reportSummarySchema, type EntrySheet, type ReportSummary } from '@mvs/shared';
import { api } from '../../api';
import { int } from '../../ui/format';

const OBJECT_LABELS: Record<keyof ReportSummary['objects'], string> = { total: 'Всего объектов', scheduled: 'Выход по графику', started: 'Работы начаты', completed: 'Работы завершены', commissioned: 'Приняты комиссионно' };
const SYSTEM_LABELS = { ELECTRICITY: 'Электрика', ASUDD: 'АСУДД', OOT: 'ООТ' };
const STATE_LABELS = { planned: 'Предусмотрено', completed: 'Завершено', inProgress: 'В работе', notStarted: 'Не ведутся' };
const empty: ReportSummary = { scope: 'ORGANIZATION', organization: '', source: '', page: null, areaHa: null,
  objects: { total: null, scheduled: null, started: null, completed: null, commissioned: null }, resources: { people: null, tech: null }, systems: [], volumes: [], violations: [] };
function NumberField({ label, value, onChange, integer = true, signed = false }: { label: string; value: number | null; onChange: (v: number | null) => void; integer?: boolean; signed?: boolean }) {
  return <NumberInput label={label} size="xs" value={value ?? ''} min={signed ? undefined : 0} allowDecimal={!integer} onChange={v => onChange(v === '' || !Number.isFinite(Number(v)) ? null : Number(v))} />;
}

/** Сводка имеет собственную область и источник; её числа не прибавляются к данным объектов. */
export function ReportAggregateView({ value }: { value: ReportSummary }) {
  return <Paper withBorder p="sm" mt="sm"><Stack gap="xs">
    <Text fw={600} size="sm">Сводные данные источника · {value.scope === 'CITY' ? 'Город' : 'Организация'}: {value.organization}</Text>
    <Text size="xs" c="dimmed">{value.source}{value.page ? ` · стр. ${value.page}` : ''}. Отдельный отчётный набор, без суммирования с реестром объектов.</Text>
    <Group gap="md">{Object.entries(OBJECT_LABELS).map(([k,label]) => <Text key={k} size="xs">{label}: <b>{int(value.objects[k as keyof typeof value.objects])}</b></Text>)}
      <Text size="xs">Площадь: {value.areaHa ?? '—'} га</Text><Text size="xs">Люди: {int(value.resources.people)}</Text><Text size="xs">Техника: {int(value.resources.tech)}</Text></Group>
    {!!value.volumes.length && <Table.ScrollContainer minWidth={600}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Вид работ / единица</Table.Th><Table.Th ta="right">План</Table.Th><Table.Th ta="right">Факт</Table.Th><Table.Th ta="right">Остаток</Table.Th><Table.Th ta="right">Динамика</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{value.volumes.map((v,i) => <Table.Tr key={i}><Table.Td>{v.name}, {v.unit}</Table.Td>{[v.plan,v.fact,v.remaining,v.delta].map((n,j) => <Table.Td key={j} ta="right">{n ?? '—'}</Table.Td>)}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
    {value.systems.map(s => <Text key={s.code} size="xs">{SYSTEM_LABELS[s.code]} · {Object.entries(STATE_LABELS).map(([k,label]) => `${label}: ${s[k as keyof typeof STATE_LABELS] ?? '—'}`).join(' · ')}</Text>)}
    {!!value.violations.length && <Table.ScrollContainer minWidth={600}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Группа / тип нарушения в источнике</Table.Th><Table.Th ta="right">Всего</Table.Th><Table.Th ta="right">Устранено</Table.Th><Table.Th ta="right">На контроле</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{value.violations.map((v,i) => <Table.Tr key={i}><Table.Td>{CKKB_GROUP_LABELS[v.group]}{v.type ? ` · ${ckkbTypeLabel(v.type)}` : ' · сводка группы'}</Table.Td><Table.Td ta="right">{int(v.total)}</Table.Td><Table.Td ta="right">{int(v.resolved)}</Table.Td><Table.Td ta="right">{int(v.controlled)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </Stack></Paper>;
}

export function ReportAggregateEditor({ code, periodId, aggregate, onDirty }: { code: string; periodId: number; aggregate: NonNullable<EntrySheet['aggregate']>; onDirty: (dirty: boolean) => void }) {
  const [value,setValue] = useState<ReportSummary>(aggregate.value ?? empty), [dirty,setDirty] = useState(false), [error,setError] = useState('');
  const [base,setBase] = useState(aggregate);
  useEffect(() => { if (!dirty && aggregate.version !== base.version) { setBase(aggregate); setValue(aggregate.value ?? empty); } }, [aggregate,base.version,dirty]);
  const qc=useQueryClient();
  useEffect(() => { onDirty(dirty); }, [dirty,onDirty]);
  const set=(patch:Partial<ReportSummary>) => { setDirty(true); setValue(v => ({ ...v,...patch })); };
  const save=useMutation({ mutationFn: () => api(`/directions/${code}/periods/${periodId}/summary`,{method:'PUT',body:{version:base.version,value}}), onSuccess: async () => {setDirty(false);onDirty(false);await Promise.all([qc.invalidateQueries({queryKey:['dir',code]}),qc.invalidateQueries({queryKey:['overview']})]);} });
  return <Accordion variant="contained"><Accordion.Item value="aggregate"><Accordion.Control>Сводные данные источника · {aggregate.value ? 'Заполнено' : 'Не заполнено'}{dirty ? ' · не сохранено' : ''}</Accordion.Control><Accordion.Panel>
    <Stack gap="sm"><Text size="xs" c="dimmed">Данные организации или города из отчёта. Они не создают объекты или карточки нарушений и не подменяют расчёт KPI.</Text>
      {dirty && aggregate.version !== base.version && <Alert color="orange">Другой сотрудник изменил сводку. Ваш черновик сохранён в форме; перед повторным сохранением сверьте данные. Отмена правок загрузит актуальную версию.</Alert>}
      <fieldset disabled={!aggregate.canEdit || save.isPending} style={{ border:0,padding:0,margin:0,minWidth:0 }}><Stack gap="sm">
        <SimpleGrid cols={{base:1,sm:2}}><Select label="Область сводки" data={[{value:'ORGANIZATION',label:'Организация'},{value:'CITY',label:'Город'}]} value={value.scope} allowDeselect={false} onChange={v => set({scope:v as ReportSummary['scope']})}/>
          <TextInput label="Организация / территория" value={value.organization} maxLength={200} onChange={e=>set({organization:e.currentTarget.value})}/>
          <TextInput label="Источник сводки" value={value.source} maxLength={300} onChange={e=>set({source:e.currentTarget.value})}/><NumberField label="Страница источника" value={value.page} onChange={page=>set({page})}/>
        </SimpleGrid>
        <SimpleGrid cols={{base:2,sm:3,lg:5}}>{Object.entries(OBJECT_LABELS).map(([k,label]) => <NumberField key={k} label={label} value={value.objects[k as keyof typeof value.objects]} onChange={n=>set({objects:{...value.objects,[k]:n}})}/>)}</SimpleGrid>
        <SimpleGrid cols={{base:1,sm:3}}><NumberField label="Площадь благоустройства, га" value={value.areaHa} integer={false} onChange={areaHa=>set({areaHa})}/><NumberField label="Люди по сводке" value={value.resources.people} onChange={people=>set({resources:{...value.resources,people}})}/><NumberField label="Техника по сводке" value={value.resources.tech} onChange={tech=>set({resources:{...value.resources,tech}})}/></SimpleGrid>
        <Text size="sm" fw={600}>Объёмы работ</Text>
        {value.volumes.map((v,i)=><Paper withBorder p="xs" key={i}><SimpleGrid cols={{base:2,sm:3}}>
          <TextInput size="xs" label="Вид работ сводки" value={v.name} onChange={e=>set({volumes:value.volumes.map((x,j)=>j===i?{...x,name:e.currentTarget.value}:x)})}/>
          <TextInput size="xs" label="Единица измерения" value={v.unit} onChange={e=>set({volumes:value.volumes.map((x,j)=>j===i?{...x,unit:e.currentTarget.value}:x)})}/>
          {(['plan','fact','remaining','delta'] as const).map(k=><NumberField key={k} label={{plan:'План',fact:'Факт',remaining:'Остаток',delta:'Динамика'}[k]} value={v[k]} integer={false} signed={k==='delta'} onChange={n=>set({volumes:value.volumes.map((x,j)=>j===i?{...x,[k]:n}:x)})}/>)}
        </SimpleGrid><Button size="compact-xs" variant="subtle" color="red" mt={6} onClick={()=>set({volumes:value.volumes.filter((_,j)=>j!==i)})}>Убрать строку сводки</Button></Paper>)}
        <Button size="xs" variant="default" onClick={()=>set({volumes:[...value.volumes,{name:'',unit:'',plan:null,fact:null,remaining:null,delta:null}]})}>Добавить вид работ сводки</Button>
        <Text size="sm" fw={600}>Электрика, АСУДД, ООТ</Text>
        {value.systems.map((s,i)=><Paper key={s.code} withBorder p="xs"><Text size="xs" fw={600}>{SYSTEM_LABELS[s.code]}</Text><SimpleGrid cols={{base:2,sm:4}}>{Object.entries(STATE_LABELS).map(([k,label])=><NumberField key={k} label={label} value={s[k as keyof typeof STATE_LABELS]} onChange={n=>set({systems:value.systems.map((x,j)=>j===i?{...x,[k]:n}:x)})}/>)}</SimpleGrid></Paper>)}
        {value.systems.length<3 && <Select label="Добавить систему в сводку" value={null} data={Object.entries(SYSTEM_LABELS).filter(([k])=>!value.systems.some(s=>s.code===k)).map(([v,label])=>({value:v,label}))} onChange={v=>{if(v)set({systems:[...value.systems,{code:v as ReportSummary['systems'][number]['code'],planned:null,completed:null,inProgress:null,notStarted:null}]});}}/>}
        <Text size="sm" fw={600}>Нарушения по источнику — отдельно от зарегистрированных</Text>
        {value.violations.map((v,i)=><Paper withBorder p="xs" key={i}><SimpleGrid cols={{base:1,sm:2}}>
          <Select size="xs" label="Группа в сводке" data={CKKB_GROUPS.map(x=>({value:x,label:CKKB_GROUP_LABELS[x]}))} value={v.group} onChange={g=>set({violations:value.violations.map((x,j)=>j===i?{...x,group:g as typeof v.group,type:null}:x)})}/>
          <Select size="xs" label="Тип в сводке (пусто — вся группа)" searchable clearable value={v.type} data={CKKB_TYPES.filter(t=>t.group===v.group).map(t=>({value:t.code,label:t.label}))} onChange={type=>set({violations:value.violations.map((x,j)=>j===i?{...x,type}:x)})}/>
        </SimpleGrid><SimpleGrid cols={{base:3}} mt={6}>{(['total','resolved','controlled'] as const).map(k=><NumberField key={k} label={{total:'Всего',resolved:'Устранено',controlled:'На контроле'}[k]} value={v[k]} onChange={n=>set({violations:value.violations.map((x,j)=>j===i?{...x,[k]:n}:x)})}/>)}</SimpleGrid>
          <Button size="compact-xs" variant="subtle" color="red" mt={6} onClick={()=>set({violations:value.violations.filter((_,j)=>j!==i)})}>Убрать строку сводки</Button></Paper>)}
        <Button size="xs" variant="default" onClick={()=>set({violations:[...value.violations,{group:'DOCUMENTATION',type:null,total:null,resolved:null,controlled:null}]})}>Добавить строку сводки нарушений</Button>
      </Stack></fieldset>
      {(error||save.error) && <Alert color="red">{error||save.error?.message}</Alert>}
      {aggregate.canEdit && <Group justify="flex-end"><Button variant="default" disabled={!dirty || save.isPending} onClick={()=>{setValue(aggregate.value??empty);setBase(aggregate);setDirty(false);setError('');}}>Отменить правки сводки</Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={()=>{const p=reportSummarySchema.safeParse(value);if(!p.success){setError(p.error.issues[0].message);return;}setError('');save.mutate();}}>Сохранить сводку источника</Button></Group>}
    </Stack>
  </Accordion.Panel></Accordion.Item></Accordion>;
}
