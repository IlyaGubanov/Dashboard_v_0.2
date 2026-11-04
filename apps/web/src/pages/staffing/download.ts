import { staffingCsvCell } from '@mvs/shared';

/** Выгрузка CSV для Excel: UTF-8 с BOM, разделитель «;», формулы экранируются. */
export const download = (name: string, rows: unknown[][]) => {
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(staffingCsvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
};
