# buddy-scrapling

Local, free Scrapling sidecar used by Code Buddy's `web_scrape` tool and
`buddy scrape` command. It accepts one JSON request on stdin and emits one JSON
response line on stdout.

## Install

```bash
./buddy-scrapling/setup.sh
# Also install browser runtimes for stealth/dynamic:
BUDDY_SCRAPLING_INSTALL_BROWSERS=1 ./buddy-scrapling/setup.sh
```

The virtual environment is created at
`~/.codebuddy/scrapling/.venv`. HTTP mode needs no browser download.

## Modes

- `http`: fast HTTP fetch with browser-like headers.
- `stealth`: headless browser with optional Cloudflare challenge handling.
- `dynamic`: headless browser waiting for network idle, for JavaScript pages.

Browser modes are heavier and can consume substantial RAM. They do not require
CUDA or ROCm and normally run on CPU, including AMD systems. Browser availability
still depends on Playwright support for the host distribution; use `http` or the
built-in `web_fetch` fallback when a browser cannot run.

The worker only fetches and extracts page content. It does not evaluate page
content as Python or shell code.
