"""Извлекает только агрегаты выбранного штатного расписания, без персональных данных."""
import json
import sys
from pathlib import Path
import openpyxl

source = Path(sys.argv[1])
target = Path(sys.argv[2])
book = openpyxl.load_workbook(source, data_only=True, read_only=True)
sheet = book['АНО МосводостокСтройТрест']
data = list(sheet.iter_rows(min_row=6, max_row=46, max_col=22, values_only=True))
number = lambda v: v if isinstance(v, (int, float)) else None
periods = []
for date, plan_col, actual_col in [('2025-01-01', 6, 14), ('2025-07-01', 7, 15), ('2026-01-01', 9, 16), ('2026-07-01', 10, 17)]:
    rows = [dict(id=f'source-{r[0]}', department=r[1], category=r[2], planned=number(r[plan_col]), actual=number(r[actual_col]), note='', isArchived=False, function=r[21] or '') for r in data]
    periods.append(dict(month=date[:7], asOf=date, note=f'Источник: {source.name}, {sheet.title}, строки 6–46. Пустые ячейки и «нет» сохранены как отсутствие данных.', rows=rows))
payroll = [dict(year=y, label='С октября 2024' if y == 2024 else f'{y} — период в источнике не уточнён', rows=[dict(id=f'source-{r[0]}', department=r[1], category=r[2], amount=number(r[c])) for r in data]) for y,c in [(2024,18),(2025,19),(2026,20)]]
result = dict(source=source.name, sheet=sheet.title, sheetCount=len(book.sheetnames), periods=periods, payroll=payroll)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(sheets=len(book.sheetnames), departments=len(data), periods=[dict(month=p['month'], planned=sum(r['planned'] or 0 for r in p['rows']), actual=sum(r['actual'] or 0 for r in p['rows']), missingPlan=sum(r['planned'] is None for r in p['rows']), missingActual=sum(r['actual'] is None for r in p['rows'])) for p in periods], payroll=[dict(year=p['year'], amount=round(sum(r['amount'] or 0 for r in p['rows']),2)) for p in payroll]), ensure_ascii=False))
