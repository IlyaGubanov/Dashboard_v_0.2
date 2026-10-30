/**
 * Скрытие финансовых данных одной кнопкой (показ на совещании, экран в зале).
 * Переключатель есть у администратора, руководства и кураторов направлений; выбор запоминается в браузере
 * и действует на все направления сразу. Скрываются стоимость, КС-2, оплата, авансы, лимиты и денежные показатели
 * на экранах просмотра; формы ввода не меняются.
 */
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Me } from '@mvs/shared';
import { meQuery } from '../api';
import { hasFeature } from './access';

const KEY = 'mvs.financeHidden';
const subs = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let hidden = read();

function subscribe(fn: () => void) {
  subs.add(fn);
  // переключили в другой вкладке — применяем и здесь
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) (hidden = read()), fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    subs.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function setFinanceHidden(v: boolean) {
  hidden = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* браузер не даёт хранить настройки — переключатель действует до перезагрузки */
  }
  subs.forEach((f) => f());
}

/**
 * Кому доступен переключатель: администратор, руководство, куратор хотя бы одного направления —
 * если финансы не отключены в карточке сотрудника (тогда они скрыты всегда, сервер их и не отдаёт).
 */
export const canHideFinance = (me: Me | undefined) =>
  !!me && hasFeature(me, 'finance') && (me.globalRole !== 'USER' || me.directions.some((d) => d.role === 'CURATOR'));

/** Финансы скрыты: переключателем (если он доступен пользователю) или в карточке сотрудника. */
export function useFinanceHidden() {
  const v = useSyncExternalStore(subscribe, () => hidden);
  const { data: me } = useQuery(meQuery);
  return !hasFeature(me, 'finance') || (v && canHideFinance(me));
}

/** Сырое значение переключателя — для самой кнопки. */
export const useFinanceToggle = () => useSyncExternalStore(subscribe, () => hidden);
