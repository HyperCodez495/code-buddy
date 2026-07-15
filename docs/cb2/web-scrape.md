# Local web scraping with Scrapling

Code Buddy's `web_scrape` tool adds a local, free path for pages that need more
than the lightweight `web_fetch` extractor. It delegates extraction to the
Python sidecar in `buddy-scrapling/`; no hosted scraping service or API key is
required.

## Setup

Install the HTTP parser and fetcher dependencies:

```bash
buddy scrape --setup
buddy scrape --check
```

Stealth and dynamic modes also require browser runtimes. Their download is
deliberately opt-in because it is large:

```bash
buddy scrape --setup --browsers
```

This creates `~/.codebuddy/scrapling/.venv`. The repository and project virtual
environments are not modified.

## Modes and formats

```bash
buddy scrape https://example.com
buddy scrape https://example.com --mode stealth --format text
buddy scrape https://example.com --mode dynamic --format html --out page.html
buddy scrape https://example.com --css "title=h1" --css "prices=.price"
```

- `http` (default) uses `Fetcher.get`, browser-like headers, and no browser.
- `stealth` uses a headless browser and can attempt Cloudflare challenge
  handling through the tool's `solveCloudflare` parameter.
- `dynamic` uses a headless browser and waits for network idle so JavaScript
  content can render.
- Formats are Markdown (`md` in the CLI, `markdown` in the tool), plain text,
  and HTML. CSS results are returned as arrays under their supplied field names.

All URLs pass through Code Buddy's existing SSRF guard before Python starts.
Private, loopback, link-local, malformed, and DNS-resolved private destinations
are refused. The worker only extracts page data; page content is never executed
as Python or shell code.

## Fail-open behavior

If Python cannot be started or the `scrapling` package is absent, `web_scrape`
automatically calls the existing `web_fetch` path. Its output is marked
`Engine: fallback (web_fetch)`. Network and site errors from an installed
Scrapling runtime remain visible instead of being disguised as installation
problems.

Set `CODEBUDDY_SCRAPLING_NO_FALLBACK=true` to disable that fallback. The tool
then returns a guided error pointing to `buddy scrape --setup`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CODEBUDDY_SCRAPLING_PYTHON` | Preferred explicit Python executable |
| `BUDDY_SCRAPLING_PYTHON` | Compatibility override for the Python executable |
| `CODEBUDDY_SCRAPLING_TIMEOUT_MS` | Sidecar and fetch timeout; default `60000`, maximum `600000` |
| `CODEBUDDY_SCRAPLING_NO_FALLBACK` | Set to `true` to fail instead of using `web_fetch` |
| `BUDDY_SCRAPLING_INSTALL_BROWSERS` | Setup-only flag used by `buddy scrape --setup --browsers` |

Resolution order is explicit environment variable, then
`~/.codebuddy/scrapling/.venv/bin/python`, then `python3` (`python` on Windows).

## Platform and AMD notes

Scrapling's HTTP mode is CPU-only and does not depend on CUDA or ROCm. Browser
modes also do not need a GPU, so AMD machines use the same path. They do consume
more memory and depend on the browser binaries supporting the Linux/Windows/macOS
host. When those binaries are unavailable, use `http`; if Scrapling itself is
missing, the normal `web_fetch` fallback remains available. Cloudflare solving
is best effort and cannot guarantee access to every protected site.
