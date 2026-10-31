import { useState } from 'react';
import { Alert,Button,Divider,Group,Modal,Stack,Text,TextInput } from '@mantine/core';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { organizationSchema,type FleetRefs } from '@mvs/shared';
import { api } from '../../api';
import { FLEET_BASE } from './api';
export function FleetSettings({refs,onClose}:{refs:FleetRefs;onClose:()=>void}) {
 const [fuel,setFuel]=useState(''),[name,setName]=useState(''),[inn,setInn]=useState(''),[validation,setValidation]=useState(''),qc=useQueryClient();
 const update=()=>qc.invalidateQueries({queryKey:['dir','reb']});
 const fuelSave=useMutation({mutationFn:()=>api(FLEET_BASE+'/fuel-types',{method:'POST',body:{code:fuel}}),onSuccess:()=>{setFuel('');update();}});
 const orgSave=useMutation({mutationFn:(body:unknown)=>api('/directions/reb/manage/organizations',{method:'POST',body}),onSuccess:()=>{setName('');setInn('');update();}});
 return <Modal opened onClose={onClose} title="Справочники РЭБ" zIndex={400}><Stack><Text size="sm" fw={600}>Виды топлива</Text><Text size="sm" c="dimmed">{refs.fuelTypes.join(' · ')}</Text><TextInput label="Новый вид топлива" value={fuel} onChange={e=>setFuel(e.currentTarget.value)}/><Button variant="light" disabled={fuel.trim().length<2} loading={fuelSave.isPending} onClick={()=>fuelSave.mutate()}>Добавить вид топлива</Button>{fuelSave.error?<Alert color="red">{fuelSave.error.message}</Alert>:null}<Divider/><Text size="sm" fw={600}>Собственники и арендодатели</Text><Text size="xs" c="dimmed">Общий механизм организаций направления. Сотрудники и их контакты ведутся в общем справочнике пользователей.</Text><TextInput label="Организация" value={name} onChange={e=>setName(e.currentTarget.value)}/><TextInput label="ИНН при наличии" value={inn} onChange={e=>setInn(e.currentTarget.value)}/><Button variant="light" loading={orgSave.isPending} onClick={()=>{const body={name,inn,kind:'OTHER'};const parsed=organizationSchema.safeParse(body);if(!parsed.success){setValidation(parsed.error.issues.map(i=>i.message).join('; '));return;}setValidation('');orgSave.mutate(parsed.data);}}>Добавить организацию</Button>{validation||orgSave.error?<Alert color="red">{validation||orgSave.error?.message}</Alert>:null}<Group>{refs.organizations.map(o=><Text size="sm" key={o.id}>{o.name}</Text>)}</Group></Stack></Modal>;
}
