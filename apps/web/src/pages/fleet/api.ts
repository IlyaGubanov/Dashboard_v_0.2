import { queryOptions } from '@tanstack/react-query';
import type { FleetKind,FleetList,FleetOverview,FleetRefs,FleetRow,FleetAnalytics } from '@mvs/shared';
import { api } from '../../api';

export const FLEET_BASE='/directions/reb/fleet';
export type Filters=Record<string,string|number|boolean|undefined>;
export const params=(filter:Filters)=>new URLSearchParams(Object.entries(filter).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString();
export const fleetQueries={
 refs:queryOptions({queryKey:['dir','reb','fleet','refs'],queryFn:()=>api<FleetRefs>(FLEET_BASE+'/refs'),staleTime:30000}),
 list:(kind:FleetKind,filters:Filters)=>queryOptions({queryKey:['dir','reb','fleet',kind,filters],queryFn:()=>api<FleetList>(`${FLEET_BASE}/${kind}?${params(filters)}`),staleTime:0}),
 card:(kind:FleetKind,id:number)=>queryOptions({queryKey:['dir','reb','fleet',kind,id],queryFn:()=>api<FleetRow>(`${FLEET_BASE}/${kind}/${id}`),staleTime:0}),
 overview:(filters:Filters)=>queryOptions({queryKey:['dir','reb','fleet','overview',filters],queryFn:()=>api<FleetOverview>(`${FLEET_BASE}/overview?${params(filters)}`),staleTime:0}),
 analytics:(kind:FleetKind,filters:Filters)=>queryOptions({queryKey:['dir','reb','fleet',kind,'analytics',filters],queryFn:()=>api<FleetAnalytics>(`${FLEET_BASE}/${kind}/analytics?${params(filters)}`),staleTime:0}),
};
