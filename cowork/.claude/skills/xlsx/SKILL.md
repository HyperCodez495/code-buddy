---
name: xlsx
description: "Create and edit Excel spreadsheets (.xlsx): multiple sheets, live formulas, professional formatting, and data tables. Use whenever the user asks to build, populate, or modify a spreadsheet/workbook/Excel file."
license: MIT (Code Buddy original skill)
nativeEngine:
  triggers:
    - excel
    - xlsx
    - spreadsheet
    - workbook
    - sheet
---

# Create & edit Excel spreadsheets with openpyxl

Build real `.xlsx` files with the open-source **openpyxl** library (available as
`python3 -c "import openpyxl"`). Work in visible steps and verify before you
report done.

## Workflow (one step at a time)
1. **Plan** the sheet(s), columns, and any formulas/totals.
2. **Write a short Python script** (a heredoc through the `bash` tool) that builds
   the workbook with openpyxl and saves it to the requested path.
3. **Verify**: reopen with `load_workbook(path)` and `assert` the key cells and
   formulas are present, then `print(path)`.
4. **Report** the saved path and a one-line summary.

## Quality conventions
- **Header row**: bold, light fill (`PatternFill('solid', fgColor='D9EAF7')`), thin borders.
- **Use formulas, never hardcoded totals**: e.g. `ws['B5'] = '=SUM(B2:B4)'`.
- **Number formats**: currency `'$#,##0;($#,##0);-'`, percent `'0.0%'`, multiples `'0.0x'`.
- **Financial color convention** (optional, for models): blue font (`Font(color='0000FF')`)
  for hardcoded inputs, black for formulas, green for cross-sheet links.
- Size column widths to content; `ws.freeze_panes = 'A2'` to keep headers visible.
- Deliver **zero formula errors** (`#REF!`, `#DIV/0!`, `#VALUE!`, …).

## Example
```bash
python3 - <<'PY'
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

wb = Workbook(); ws = wb.active; ws.title = 'Items'
ws.append(['Item', 'Cost', 'Status'])
for r in [['Actuators', 8000, 'ordered'], ['Compute', 3500, 'done']]:
    ws.append(r)
ws.append(['Total', '=SUM(B2:B3)', ''])

hdr = PatternFill('solid', fgColor='D9EAF7'); thin = Side(style='thin', color='B7B7B7')
for row in ws.iter_rows():
    for c in row:
        c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
for c in ws[1]:
    c.font = Font(bold=True); c.fill = hdr
for r in range(2, 4):
    ws[f'B{r}'].font = Font(color='0000FF'); ws[f'B{r}'].number_format = '$#,##0'
ws['B4'].font = Font(bold=True); ws['B4'].number_format = '$#,##0'
for i in range(1, 4):
    ws.column_dimensions[get_column_letter(i)].width = 16
ws.freeze_panes = 'A2'
wb.save('budget.xlsx')

wb2 = load_workbook('budget.xlsx')
assert wb2['Items']['B4'].value == '=SUM(B2:B3)'
print('budget.xlsx')
PY
```

## Reading / editing existing files
- Read values/formulas: `load_workbook(path)` (use `data_only=True` for cached results).
- Edit in place: modify cells/styles and `save()` back to the same path; preserve the
  existing layout and formatting conventions rather than imposing new ones.
- For data analysis on large sheets, `pandas.read_excel` is also available.
