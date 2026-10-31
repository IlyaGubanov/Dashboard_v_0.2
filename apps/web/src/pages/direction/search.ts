import { FLEET_KINDS,type FleetKind } from '@mvs/shared';
/** Параметры адреса страницы направления: вкладка, дата среза, открытый объект. */
export const DIRECTION_TABS = ['overview', 'sites', 'matrix', 'schedule', 'trackers', 'people', 'dynamics', 'entry', 'remarks', 'manage', 'journal', 'settings'] as const;
export type DirectionTab = (typeof DIRECTION_TABS)[number];

export interface DirectionSearch {
  fleet?: FleetKind | 'overview';
  fr?: number;
  ff?: Record<string,string>;
  tab?: DirectionTab;
  /** дата среза ГГГГ-ММ-ДД; нет — последняя отчётная точка */
  date?: string;
  /** открытая карточка объекта */
  site?: number;
  /** объект, открытый в редакторе (вкладка «Управление») */
  edit?: number;
  /** открытое замечание */
  remark?: number;
  /** отбор реестра по подрядчику: id организации или 'none' */
  contractor?: string;
  /** отбор на вкладке замечаний (переход из «Моих задач») */
  rv?: 'check' | 'mine';
}

export function parseDirectionSearch(s: Record<string, unknown>): DirectionSearch {
  return {
    fleet: s.fleet==='overview'||FLEET_KINDS.includes(s.fleet as FleetKind)?s.fleet as FleetKind|'overview':undefined,
    fr:Number.isSafeInteger(Number(s.fr))&&Number(s.fr)>0?Number(s.fr):undefined,
    ff:s.ff&&typeof s.ff==='object'&&!Array.isArray(s.ff)?Object.fromEntries(Object.entries(s.ff).filter(([k,v])=>['from','to','q','ownership','kind','status','departmentId','targetDirectionId','vehicleId','archived','page','sort','order','active','fuelType','category','technicalState','usageState'].includes(k)&&typeof v==='string'&&v.length<=200)) as Record<string,string>:undefined,
    tab: DIRECTION_TABS.includes(s.tab as DirectionTab) ? (s.tab as DirectionTab) : undefined,
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
    site: Number.isInteger(Number(s.site)) && Number(s.site) > 0 ? Number(s.site) : undefined,
    edit: Number.isInteger(Number(s.edit)) && Number(s.edit) > 0 ? Number(s.edit) : undefined,
    contractor: typeof s.contractor === 'string' && /^(\d{1,9}|none)$/.test(s.contractor) ? s.contractor : typeof s.contractor === 'number' ? String(s.contractor) : undefined,
    rv: s.rv === 'check' || s.rv === 'mine' ? s.rv : undefined,
    remark: Number.isInteger(Number(s.remark)) && Number(s.remark) > 0 ? Number(s.remark) : undefined,
  };
}
