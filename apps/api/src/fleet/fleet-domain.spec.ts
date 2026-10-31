import { describe, expect, it } from 'vitest';
import * as domain from './fleet-domain';

// Литеральные ожидания: неизвестная принадлежность не становится собственной,
// конец интервала исключён, денежные значения считаются в копейках.
const d = domain;
describe('РЭБ: предметные правила', () => {
  it('не относит неизвестную принадлежность к собственной', () => {
    expect(d.fleetCounts?.([{ ownership: 'OWN', technicalState: 'REPAIR', usageState: 'RESERVE' }, { ownership: 'RENTED', technicalState: 'OK', usageState: 'ACTIVE' }, { ownership: 'UNKNOWN', technicalState: 'UNKNOWN', usageState: 'UNASSIGNED' }]))
      .toEqual({ total: 3, own: 1, rented: 1, unknown: 1, used: 1, unused: 2, repair: 1, reserve: 1 });
  });
  it('выявляет пересечение назначений, включая открытый конец', () => {
    expect(d.overlaps?.('2026-10-01', null, '2026-10-31', '2026-11-01')).toBe(true);
    expect(d.overlaps?.('2026-10-01', '2026-10-31', '2026-10-31', null)).toBe(false);
  });
  it('не считает неизвестное использование подтверждённым простоем',()=>{
    expect(d.fleetCounts?.([{ownership:'UNKNOWN',technicalState:'UNKNOWN',usageState:'UNKNOWN'}])).toMatchObject({used:0,unused:0});
  });
  it('не теряет копейки при сложении и частичной оплате', () => {
    expect(d.paymentTotals?.([{ amount: '0.10', paidAmount: '0.00', status: 'REVIEW' }, { amount: '1000.20', paidAmount: '500.10', status: 'PARTIAL' }], '2026-10-31'))
      .toEqual({ count: 2, charged: '1000.30', paid: '500.10', balance: '500.20', overdue: 0 });
  });
  it('не представляет неподтверждённую оплату как ноль', () => {
    expect(d.paymentTotals?.([{ amount: '100.00', paidAmount: null, status: 'REVIEW' }], '2026-10-31'))
      .toMatchObject({ charged: '100.00', paid: null, balance: null });
  });
  it('исключает отменённые начисления из остатка', () => {
    expect(d.paymentTotals?.([{ amount: '100.00', paidAmount: '0.00', status: 'CANCELLED', dueDate: '2026-01-01' }], '2026-10-31'))
      .toMatchObject({ charged: '0.00', balance: '0.00', overdue: 0 });
  });
  it('обеспечение заявки подтверждается единицами техники', () => {
    expect(d.requestStatus?.(3, 0, 'FULFILLED')).toBe('IN_PROGRESS');
    expect(d.requestStatus?.(3, 2, 'REVIEW')).toBe('PARTIAL');
    expect(d.requestStatus?.(3, 3, 'IN_PROGRESS')).toBe('FULFILLED');
    expect(d.requestStatus?.(3, 2, 'CANCELLED')).toBe('CANCELLED');
  });
  it('показывает расхождение топлива и не исправляет источник', () => {
    expect(d.fuelDifference?.(['11727774', '919808', '42107', '119853', '383848'], '13193395')).toBe('-5.00');
    expect(d.fuelDifference?.(['353472', '92844', '57606', '53556', '681725'], '510436')).toBe('728767.00');
  });
});
