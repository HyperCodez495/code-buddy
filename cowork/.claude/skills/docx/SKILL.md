---
name: docx
description: "Create and edit Word documents (.docx): headings, styled paragraphs, tables, images, headers/footers, and page formatting. Use whenever the user asks to write, format, or modify a Word/.docx document."
license: MIT (Code Buddy original skill)
nativeEngine:
  triggers:
    - word document
    - docx
    - word doc
    - .docx
    - write a document
    - report document
---

# Create & edit Word documents with python-docx

Build real `.docx` files with the open-source **python-docx** library
(`python3 -c "import docx"`). Work in visible steps; verify before reporting done.

## Workflow
1. **Outline** the document: title, sections (headings), body, tables, images.
2. **Write a Python script** (heredoc via the `bash` tool) that assembles the
   document with python-docx and saves it.
3. **Verify**: reopen with `Document(path)` and assert key paragraphs/headings
   exist; `print(path)`.
4. **Report** the saved path + a one-line summary.

## Quality conventions
- Use real heading styles (`doc.add_heading('Title', level=0)`, `level=1/2`) so the
  document has a proper outline — not just bold text.
- Tables: `doc.add_table(rows, cols, style='Light Grid Accent 1')`; bold the header row.
- Embed images with `doc.add_picture(path, width=Inches(5))`; add a caption paragraph.
- Set page size/margins via `doc.sections[0]` when the user specifies them.
- Keep styling consistent; when editing an existing file, match its conventions.

## Example
```bash
python3 - <<'PY'
from docx import Document
from docx.shared import Pt, Inches
doc = Document()
doc.add_heading('Q2 Robotics Budget', level=0)
doc.add_heading('Overview', level=1)
doc.add_paragraph('Funding target: 120k EUR — status: on track.')
doc.add_heading('Line items', level=1)
t = doc.add_table(rows=1, cols=3); t.style = 'Light Grid Accent 1'
hdr = t.rows[0].cells
for i, h in enumerate(['Item', 'Cost', 'Status']):
    hdr[i].text = h; hdr[i].paragraphs[0].runs[0].font.bold = True
for item, cost, status in [('Actuators', '8000', 'ordered'), ('Compute', '3500', 'done')]:
    c = t.add_row().cells; c[0].text = item; c[1].text = cost; c[2].text = status
doc.save('report.docx')

assert Document('report.docx').paragraphs[0].text == 'Q2 Robotics Budget'
print('report.docx')
PY
```

## Reading / editing existing files
- Read text: iterate `Document(path).paragraphs` / `.tables`, or `python3 -m markitdown file.docx` if available.
- Edit in place: load, modify runs/paragraphs/tables, `save()` back; preserve tracked
  changes and comments where present.
