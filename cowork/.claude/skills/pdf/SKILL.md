---
name: pdf
description: "Work with PDF files: extract text, merge/split/reorder pages, rotate, read form fields, and render pages to images. To author a formatted PDF, build a .docx/.pptx and convert it. Use whenever the user asks to read, combine, split, or produce a PDF."
license: MIT (Code Buddy original skill)
nativeEngine:
  triggers:
    - pdf
    - merge pdf
    - split pdf
    - extract pdf
    - pdf form
---

# Work with PDF files (pypdf + pdf2image)

Use the open-source **pypdf** (`import pypdf`) for page operations and form fields,
and **pdf2image** (`from pdf2image import convert_from_path`) to render pages to
images. Work in visible steps; verify before reporting done.

## Common tasks
- **Extract text**: `pypdf.PdfReader(path).pages[i].extract_text()` (or `python3 -m markitdown file.pdf` if available).
- **Merge**: `w = pypdf.PdfWriter(); [w.append(p) for p in paths]; w.write('out.pdf')`.
- **Split / select pages**: read with `PdfReader`, `writer.add_page(reader.pages[i])` for the pages you want.
- **Rotate**: `page.rotate(90)` before writing.
- **Form fields**: `reader.get_fields()` to read; `writer.update_page_form_field_values(...)` to fill.
- **Render to image** (for visual inspection): `convert_from_path('file.pdf')[0].save('page1.png')`.

## Authoring a formatted PDF
pypdf does not lay out rich content. To produce a styled PDF, **build a `.docx` or
`.pptx` first** (see the docx/pptx skills), then convert:
```bash
soffice --headless --convert-to pdf --outdir . report.docx
```
This yields a clean, professionally formatted PDF.

## Workflow
1. Identify the operation (extract / merge / split / fill / convert).
2. Run the pypdf (or soffice-convert) command via the `bash` tool.
3. **Verify**: reopen the output (`PdfReader(out).pages` count, or extract a snippet) and `print` the path.
4. Report the saved path + a one-line summary.
