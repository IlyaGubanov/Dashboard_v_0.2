import { describe,expect,it } from 'vitest';
import { workbookFixture } from './fleet-test-fixtures';
import * as importer from './fleet-import-parser';

const imp=importer;
describe('РЭБ: безопасный разбор Excel',()=>{
  it('сохраняет ведущий ноль длинного УИН',async()=>{
    const rows=await imp.readFleetWorkbook?.(workbookFixture([['УИН','Номер'],['0412479001000023971566107','Н752МХ977']]));
    expect(rows?.[0].rows[1][0]).toBe('0412479001000023971566107');
  });
  it('проверяет Excel-даты и отбрасывает невозможную дату',()=>{
    expect(imp.importDate?.(46325)).toBe('2026-10-30');
    expect(imp.importDate?.('31.02.2026')).toBeNull();
    expect(imp.importDate?.('30.10.2026')).toBe('2026-10-30');
  });
  it('не считает ГУП Мосводосток и чужие организации МВС СТ',()=>{
    expect(imp.isMvsOrganization?.('ГУП «Мосводосток»')).toBe(false);
    expect(imp.isMvsOrganization?.('АНО по развитию городской среды "МВС СТ"')).toBe(true);
  });
  it('денежное значение с тремя знаками не округляется молча',()=>{
    expect(imp.importMoney?.('1 250,50')).toBe('1250.50');
    expect(imp.importMoney?.('1.255')).toBeNull();
  });
  it('числовой УИН отвергается вместо восстановления утраченных цифр',()=>{
    expect(imp.importIdentifier?.(18810577261029815000)).toBeNull();
    expect(imp.importIdentifier?.('001234567890123456789')).toBe('001234567890123456789');
  });
  it('чужая организация исключается до построения карточки ДТП',()=>{
    const row=imp.parseImportRow?.('incidents',{organization:'ГУП Мосводосток',plate:'А001АА77',occurredAt:new Date('2026-10-30'),incidentType:'Столкновение'});
    expect(row?.excluded).toBe(true);
  });
  it('«оплачен» без суммы платежа остаётся на проверке с исходным статусом',()=>{
    const row=imp.parseImportRow?.('fines',{uin:'00123',plate:'А001АА77',amount:1000,violation:'12.16.1',sourceStatus:'оплачен'});
    expect(row?.data).toMatchObject({status:'REVIEW',paidAmount:null,sourceStatus:'оплачен'});
    expect(row?.warnings.length).toBeGreaterThan(0);
  });
});
