---
name: pptx
description: "Create and edit PowerPoint presentations (.pptx): title slides, bullet layouts, tables, images, and speaker notes. Use whenever the user asks to build, modify, or populate a presentation/slide deck/PowerPoint."
license: MIT (Code Buddy original skill)
nativeEngine:
  triggers:
    - powerpoint
    - pptx
    - ppt
    - presentation
    - slide deck
    - slides
---

# Create & edit PowerPoint with python-pptx

Build real `.pptx` files with the open-source **python-pptx** library
(`python3 -c "import pptx"`). Work in visible steps; verify before reporting done.

## Workflow
1. **Outline the deck**: a title slide + one slide per section; note any tables,
   images, or speaker notes.
2. **Write a Python script** (heredoc via the `bash` tool) that builds the deck
   with python-pptx and saves it.
3. **Verify**: reopen with `Presentation(path)` and assert the slide count / title;
   `print(path)`.
4. **Report** the saved path + a one-line summary.

## Quality conventions
- Start with a **title slide** (`slide_layouts[0]`), then content slides
  (`slide_layouts[1]` for bullets, `slide_layouts[5]` "Title Only" for custom layouts/tables).
- Real **bullet lists** via the body placeholder's `text_frame` paragraphs (set `.level`
  for sub-bullets) — not one big text blob.
- **Tables** via `slide.shapes.add_table(rows, cols, left, top, width, height)`; bold + fill
  the header row.
- Use a consistent accent color and **web-safe fonts** (Arial, Calibri) so the deck renders
  everywhere; keep ≤ ~6 bullets per slide.
- Add **speaker notes** with `slide.notes_slide.notes_text_frame.text = "…"` when useful.

## Example
```bash
python3 - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
p = Presentation()
s = p.slides.add_slide(p.slide_layouts[0])
s.shapes.title.text = 'Q2 Robotics Budget'
s.placeholders[1].text = 'Funding 120k EUR — on track'

s2 = p.slides.add_slide(p.slide_layouts[5]); s2.shapes.title.text = 'Line items'
tbl = s2.shapes.add_table(3, 3, Inches(0.6), Inches(1.6), Inches(8.5), Inches(2)).table
for j, h in enumerate(['Item', 'Cost', 'Status']):
    cell = tbl.cell(0, j); cell.text = h
    cell.text_frame.paragraphs[0].runs[0].font.bold = True
for i, row in enumerate([['Actuators', '8000', 'ordered'], ['Compute', '3500', 'done']], 1):
    for j, v in enumerate(row):
        tbl.cell(i, j).text = v
p.save('deck.pptx')

assert len(Presentation('deck.pptx').slides) == 2
print('deck.pptx')
PY
```

## Reading / editing existing files
- Read: iterate `Presentation(path).slides` and each `shape.text_frame`.
- Edit in place: load, modify shapes/placeholders/tables, `save()` back; keep the
  existing theme, layout, and fonts.
