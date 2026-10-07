#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stamp the committed static pages with the facts of the day's dataset.

    python stamp_static.py                      # reads site/data/products.json.gz
    python stamp_static.py --products other.json.gz --site site

Readers that do not run JavaScript (most AI crawlers, link previews) only see
the static HTML, so the home page and llms.txt state the snapshot date, the
chains in it and where each chain's prices come from. Those facts change with
the data, so they are written at deploy time — a committed constant would go
stale the first day a chain's file is missing. Also stamps the home <lastmod>
in sitemap.xml, which is honest now that the home HTML changes with the data.

Each stamp replaces a fixed pattern; tests/test_seo.py pins that every pattern
matches the committed files exactly once, so a reformat cannot silently stop
the stamping. Stdlib only.
"""
import argparse
import gzip
import json
import os
import re
import sys

# Where each chain's prices come from is a fact about the DAY's file (a chain
# can fall back to a branch when its online store's file is missing), so it is
# read from products.json's "stores" through the one rule the price pages use.
from israeli_prices.basket import STORE_BRANCH, STORE_ONLINE, store_type  # noqa: E402
CHAIN_EN = {
    "שופרסל": "Shufersal", "רמי לוי": "Rami Levy", "ויקטורי": "Victory",
    "יינות ביתן / קרפור": "Yeinot Bitan / Carrefour", "יוחננוף": "Yochananof",
    "אושר עד": "Osher Ad", "חצי חינם": "Hatzi Hinam",
}
HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט",
             "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]

# the exact shapes the stamps rewrite (tests/test_seo.py imports these)
SITEMAP_HOME_RE = r"(<loc>https://slim-super\.com/</loc>\s*<lastmod>)[^<]+"
INDEX_DATE_RE = r'<time class="data-date" datetime="[^"]*">[^<]*</time>'
INDEX_CHAINS_RE = r'<span class="data-chains">[^<]*</span>'
INDEX_SOURCES_RE = r'<span class="data-sources">[^<]*</span>'
LLMS_DATE_RE = r"(?m)^- Latest data update: .*$"
LLMS_CHAINS_RE = r"(?m)^- Chains in the latest update: .*$"
LLMS_SOURCES_RE = r"(?m)^- Where each chain's prices come from: .*$"


def he_date(iso):
    """'2026-10-06' -> '6 באוקטובר 2026'."""
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} ב{HE_MONTHS[m - 1]} {y}"


def he_join(names):
    """Hebrew list: 'א, ב וג' — the conjunction is a prefix; a name starting
    with ו takes a maqaf ('ו־ויקטורי') so it does not read as one word."""
    names = list(names)
    if len(names) < 2:
        return "".join(names)
    last = names[-1]
    return ", ".join(names[:-1]) + (" ו־" if last.startswith("ו") else " ו") + last


def sources_he(chains, stores=None):
    stores = stores or {}
    kinds = {c: store_type(c, stores.get(c)) for c in chains}
    online = [c for c in chains if kinds[c] == STORE_ONLINE]
    branch = [c for c in chains if kinds[c] == STORE_BRANCH]
    parts = []
    if online:
        parts.append(f"המחירים של {he_join(online)} נלקחים מחנויות האונליין שלהן")
    if branch:
        parts.append(f"של {he_join(branch)} — מסניף מייצג" if online
                     else f"המחירים של {he_join(branch)} נלקחים מסניף מייצג")
    return ("; ".join(parts) + ".") if parts else ""


def sources_en(chains, stores=None):
    stores = stores or {}
    out = []
    for c in chains:
        t = store_type(c, stores.get(c))
        kind = ("online store" if t == STORE_ONLINE
                else "representative branch" if t == STORE_BRANCH else "store file")
        out.append(f"{CHAIN_EN.get(c, c)}: {kind}")
    return "; ".join(out)


def _sub_once(pattern, repl, text, what):
    new, n = re.subn(pattern, lambda m: repl(m) if callable(repl) else repl, text, count=1)
    if n != 1:
        raise SystemExit(f"stamp: {what} pattern not found — was the file reformatted?")
    return new


def stamp_index(html, date, chains, stores=None):
    html = _sub_once(INDEX_DATE_RE, f'<time class="data-date" datetime="{date}">{he_date(date)}</time>',
                     html, "index.html date")
    html = _sub_once(INDEX_CHAINS_RE, f'<span class="data-chains">{", ".join(chains)}</span>',
                     html, "index.html chains")
    return _sub_once(INDEX_SOURCES_RE, f'<span class="data-sources">{sources_he(chains, stores)}</span>',
                     html, "index.html sources")


def stamp_llms(text, date, chains, stores=None):
    text = _sub_once(LLMS_DATE_RE, f"- Latest data update: {date}", text, "llms.txt date")
    names = ", ".join(f"{c} ({CHAIN_EN[c]})" if c in CHAIN_EN else c for c in chains)
    text = _sub_once(LLMS_CHAINS_RE, f"- Chains in the latest update: {names}", text, "llms.txt chains")
    return _sub_once(LLMS_SOURCES_RE, f"- Where each chain's prices come from: {sources_en(chains, stores)}",
                     text, "llms.txt sources")


def stamp_sitemap(xml, date):
    return _sub_once(SITEMAP_HOME_RE, lambda m: m.group(1) + date, xml, "sitemap.xml home lastmod")


def _rw(path, fn):
    with open(path, encoding="utf-8") as fh:
        old = fh.read()
    new = fn(old)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(new)
    return old != new


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", default="site")
    ap.add_argument("--products", default=os.path.join("site", "data", "products.json.gz"))
    args = ap.parse_args()
    with gzip.open(args.products, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    date, chains = data.get("date") or "", data.get("chains") or []
    stores = data.get("stores") or {}
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not chains:
        sys.exit(f"stamp: dataset has no usable date/chains (date={date!r}, chains={chains})")
    _rw(os.path.join(args.site, "index.html"), lambda h: stamp_index(h, date, chains, stores))
    _rw(os.path.join(args.site, "llms.txt"), lambda t: stamp_llms(t, date, chains, stores))
    _rw(os.path.join(args.site, "sitemap.xml"), lambda x: stamp_sitemap(x, date))
    print(f"stamped {date} · {', '.join(chains)}")


if __name__ == "__main__":
    main()
