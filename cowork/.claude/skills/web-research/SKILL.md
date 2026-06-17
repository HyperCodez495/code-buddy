---
name: web-research
description: "Autonomous multi-source web research: fetch several web pages, extract their main content, and synthesize a cited Markdown brief. Use whenever the user wants to research a topic, gather and compare sources, or produce a referenced write-up from the web."
license: MIT (Code Buddy original skill)
nativeEngine:
  triggers:
    - research
    - web research
    - investigate
    - gather sources
    - recherche sur
    - fais des recherches
    - renseigne-toi
    - documente-toi
    - état de l'art
    - cited brief
    - literature review
---

# Autonomous web research → cited Markdown brief

Gather information from several web pages and synthesize a **cited** Markdown
brief. This composes the other skills: it fetches with the bundled libraries
(lean, zero install), and for JS-heavy pages it hands off to the **`web-automate`**
skill (Playwright); you can also feed local files through **`doc-ingest`**.

Work in **visible steps** and **never fabricate** — every claim must trace to a
fetched source.

## Backends
- **Lean (default, no install):** `urllib` (stdlib) + the bundled `beautifulsoup4`
  + `lxml` read static pages — `python3 -c "import bs4, lxml"`.
- **JS-rendered pages:** if the lean fetch returns little/no text (SPA), use the
  **`web-automate`** skill to render with Playwright and grab the DOM text.

## Workflow (one step at a time)
1. **Plan**: write the research question and a short list of candidate URLs (or
   use `web-automate` to scrape a search-results page for links first).
2. **Fetch + extract** each source: a short Python script (heredoc via `bash`)
   that downloads the page, strips `script`/`style`/nav, and keeps the main text
   — print each source's URL + a length so progress is visible.
3. **Synthesize**: write a Markdown brief that answers the question, with **inline
   citations `[n]`** mapped to a numbered **Sources** list of the URLs. Note
   disagreements between sources rather than averaging them away.
4. **Verify**: assert at least one source returned text and the brief is
   non-empty; save it to a `.md` path.
5. **Report** the saved brief path and a one-line takeaway.

## Conventions
- Set a real `User-Agent`, a timeout, and skip a source that fails rather than
  aborting the whole run.
- Respect each site's terms / robots; this is for openly accessible pages, not
  for bypassing paywalls or access controls.
- Cite **every** factual claim; if sources conflict, say so. Don't invent URLs.
- De-duplicate near-identical sources; prefer primary sources.

## Example — fetch + extract several sources
```bash
python3 - <<'PY'
import urllib.request, ssl
from bs4 import BeautifulSoup

URLS = [
    "https://example.com",
    # add the real candidate URLs here
]
ctx = ssl.create_default_context()
docs = []
for url in URLS:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research)"})
        html = urllib.request.urlopen(req, timeout=20, context=ctx).read().decode("utf-8", "replace")
    except Exception as e:
        print(f"skip {url}: {e}"); continue
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(" ", strip=True).split())
    title = soup.title.get_text(strip=True) if soup.title else url
    docs.append({"url": url, "title": title, "text": text})
    print(f"[{len(text)} chars] {title} — {url}")

assert docs, "no sources fetched"
# → now write the cited Markdown brief from `docs` and save it to research-brief.md
PY
```

## Notes
- The brief is an artifact — surface its path so the GUI can preview it.
- To turn the brief into a Word/PDF, hand it to the `docx` / `pdf` create skills.
- For pages behind heavy JS, route through `web-automate` first, then synthesize.
