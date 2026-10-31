import { useState } from 'react';
import { Alert, Button, Group, Select, Stack, Text } from '@mantine/core';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { MEMBER_ROLES,MEMBER_ROLE_LABELS,type MemberRole,type MemberScope,type UserListItem } from '@mvs/shared';
import { api } from '../../api';
type Value={role:MemberRole|null;scope:MemberScope};
export function FleetRolePanel({user}:{user:UserListItem}){
 const qc=useQueryClient(),key=['fleet-member',user.id];
 const query=useQuery({queryKey:key,queryFn:()=>api<Value>(`/fleet/members/${user.id}`)});
 const [draft,setDraft]=useState<Value|null>(null),v=draft??query.data;
 const save=useMutation({mutationFn:()=>api(`/fleet/members/${user.id}`,{method:'PUT',body:v}),onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:key}),qc.invalidateQueries({queryKey:['me']}),qc.invalidateQueries({queryKey:['fleet']})]);setDraft(null);}});
 if(query.error)return <Alert color="red">{query.error.message}</Alert>;
 if(!v)return <Text size="sm">Загрузка роли РЭБ…</Text>;
 return <Stack gap="xs" pb="md" style={{borderBottom:'1px solid var(--mantine-color-default-border)'}}><Text fw={600}>РЭБ</Text><Text size="xs" c="dimmed">Администратор управляет разделом, руководство имеет просмотр. Роль сотрудника задаётся отдельно от направлений работ.</Text><Group align="end"><Select label="Роль в РЭБ" data={MEMBER_ROLES.map(value=>({value,label:MEMBER_ROLE_LABELS[value]}))} placeholder="Нет доступа" clearable value={v.role} onChange={role=>setDraft({...v,role:role as MemberRole|null})} maw="100%"/>{v.role==='EDITOR'?<Select label="Область ввода РЭБ" value={v.scope} allowDeselect={false} data={[{value:'ALL',label:'Все записи РЭБ'},{value:'SITES',label:'Записи по доступным для ввода объектам'},...(v.scope==='SECTIONS'?[{value:'SECTIONS',label:'Прежнее ограничение по объектам'}]:[])]} onChange={scope=>setDraft({...v,scope:scope as MemberScope})} maw="100%"/>:null}<Button disabled={!draft} loading={save.isPending} onClick={()=>save.mutate()}>Сохранить роль РЭБ</Button></Group>{save.error?<Alert color="red">{save.error.message}</Alert>:save.isSuccess?<Text size="xs" c="green">Роль РЭБ сохранена</Text>:null}</Stack>;
}
