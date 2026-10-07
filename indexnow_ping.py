#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tell IndexNow search engines which pages changed in this deploy.

    python indexnow_ping.py --since 2026-10-06            # POST the changed URLs
    python indexnow_ping.py --since 2026-10-06 --dry-run  # just list them
    python indexnow_ping.py --since 2026-10-07 --sitemap sitemap.xml   # hand-edited pages only

IndexNow reaches Bing (which grounds Copilot and is a search provider behind
ChatGPT search), Yandex, Naver, Seznam and Yep — not Google, which reads the
sitemaps. Only URLs whose sitemap <lastmod> is on/after --since are sent: the
protocol is for CHANGED pages, and re-sending the whole site every day is the
kind of noise that gets a key ignored. The key file lives at site/<key>.txt.
Stdlib only; a failed ping never fails the deploy (the caller decides).
"""
import argparse
import glob
import json
import os
import re
import sys
import urllib.request

HOST = "slim-super.com"
ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_URLS = 10000          # protocol limit per request


def find_key(site):
    """The IndexNow key: the one site/<32 hex>.txt whose content is its own name."""
    for path in glob.glob(os.path.join(site, "*.txt")):
        name = os.path.basename(path)[:-4]
        if re.fullmatch(r"[0-9a-f]{32}", name):
            with open(path, encoding="utf-8") as fh:
                if fh.read().strip() == name:
                    return name
    return None


def changed_urls(site, since, only=None):
    """URLs from every sitemap under site/ (or just the one named `only`) whose
    <lastmod> >= since, in order. Entries without a <lastmod> (a price page
    with no observed change) are never sent."""
    out = []
    pattern = only or "sitemap*.xml"
    for path in sorted(glob.glob(os.path.join(site, pattern))):
        with open(path, encoding="utf-8") as fh:
            xml = fh.read()
        for loc, mod in re.findall(r"<url>\s*<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", xml):
            if mod[:10] >= since and loc.startswith(f"https://{HOST}/") and loc not in out:
                out.append(loc)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", default="site")
    ap.add_argument("--since", required=True, help="YYYY-MM-DD; send URLs modified on/after it")
    ap.add_argument("--sitemap", help="only this sitemap file (e.g. sitemap.xml)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    key = find_key(args.site)
    if not key:
        sys.exit("indexnow: no key file site/<32 hex>.txt")
    urls = changed_urls(args.site, args.since, args.sitemap)[:MAX_URLS]
    print(f"indexnow: {len(urls)} changed URL(s) since {args.since}")
    if not urls or args.dry_run:
        for u in urls[:20]:
            print("  ", u)
        return
    body = json.dumps({"host": HOST, "key": key, "keyLocation": f"https://{HOST}/{key}.txt",
                       "urlList": urls}).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            print(f"indexnow: HTTP {res.status} (200/202 = accepted)")
    except urllib.error.HTTPError as err:
        sys.exit(f"indexnow: HTTP {err.code} {err.reason}")


if __name__ == "__main__":
    main()
