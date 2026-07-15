#!/usr/bin/env python3
"""Single-request JSON sidecar for local Scrapling extraction."""

import json
import sys
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


try:
    from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher
except ImportError:
    emit({"ok": False, "error": "scrapling-not-installed"})
    raise SystemExit(0)


def page_value(page: Any, name: str) -> str:
    value = getattr(page, name, "")
    if callable(value):
        value = value()
    return "" if value is None else str(value)


def page_status(page: Any) -> int:
    value = getattr(page, "status", getattr(page, "status_code", 0))
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def page_title(page: Any) -> str:
    title = getattr(page, "title", None)
    if callable(title):
        title = title()
    if title:
        return str(title)
    matches = page.css("title::text")
    value = matches.get() if hasattr(matches, "get") else None
    return "" if value is None else str(value)


def extract_css(page: Any, selectors: dict[str, str]) -> dict[str, list[str]]:
    extracted: dict[str, list[str]] = {}
    for field, selector in selectors.items():
        css_selector = selector if "::text" in selector else f"{selector}::text"
        matches = page.css(css_selector)
        values = matches.getall() if hasattr(matches, "getall") else []
        extracted[field] = [str(value) for value in values]
    return extracted


def fetch_page(request: dict[str, Any]) -> Any:
    url = request["url"]
    mode = request.get("mode", "http")
    timeout_ms = request.get("timeout")
    timeout = max(1, int(timeout_ms) / 1000) if timeout_ms is not None else None

    if mode == "http":
        kwargs: dict[str, Any] = {"stealthy_headers": True}
        if request.get("impersonate"):
            kwargs["impersonate"] = request["impersonate"]
        if timeout is not None:
            kwargs["timeout"] = timeout
        return Fetcher.get(url, **kwargs)

    if mode == "stealth":
        kwargs = {
            "headless": True,
            "solve_cloudflare": bool(request.get("solveCloudflare", False)),
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        return StealthyFetcher.fetch(url, **kwargs)

    if mode == "dynamic":
        kwargs = {"headless": True, "network_idle": True}
        if timeout is not None:
            kwargs["timeout"] = timeout
        return DynamicFetcher.fetch(url, **kwargs)

    raise ValueError("mode must be one of: http, stealth, dynamic")


def main() -> None:
    raw = sys.stdin.readline()
    if not raw:
        raise ValueError("expected one JSON request on stdin")
    request = json.loads(raw)
    if not isinstance(request, dict) or not isinstance(request.get("url"), str):
        raise ValueError("url must be a string")

    output_format = request.get("format", "markdown")
    if output_format not in ("markdown", "text", "html"):
        raise ValueError("format must be one of: markdown, text, html")

    page = fetch_page(request)
    payload: dict[str, Any] = {
        "ok": True,
        "status": page_status(page),
        "engine": request.get("mode", "http"),
    }
    if output_format == "markdown":
        payload["markdown"] = page_value(page, "markdown")
    elif output_format == "text":
        payload["text"] = page_value(page, "get_all_text")
    else:
        payload["html"] = page_value(page, "html")

    title = page_title(page)
    if title:
        payload["title"] = title

    selectors = request.get("css")
    if isinstance(selectors, dict):
        safe_selectors = {
            str(field): str(selector)
            for field, selector in selectors.items()
            if isinstance(field, str) and isinstance(selector, str)
        }
        payload["extracted"] = extract_css(page, safe_selectors)

    emit(payload)


try:
    main()
except Exception as error:
    emit({"ok": False, "error": str(error)})
