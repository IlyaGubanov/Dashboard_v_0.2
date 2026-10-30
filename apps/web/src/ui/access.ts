/**
 * Ограничения из карточки сотрудника: скрытые разделы и отключённые возможности.
 * Сервер проверяет то же самое; здесь — чтобы не показывать недоступное (у администратора ограничений нет).
 */
import { useQuery } from '@tanstack/react-query';
import type { AppSection, Feature, Me } from '@mvs/shared';
import { meQuery } from '../api';

export const canSee = (me: Me | undefined, s: AppSection) => !me?.hiddenSections.includes(s);
export const hasFeature = (me: Me | undefined, f: Feature) => !me?.deniedFeatures.includes(f);

export function useAccess() {
  const { data: me } = useQuery(meQuery);
  return { canSee: (s: AppSection) => canSee(me, s), has: (f: Feature) => hasFeature(me, f) };
}
