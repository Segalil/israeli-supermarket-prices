#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the crawlable static price pages from today's dataset.

    python build_site_data.py          # first: site/data/products.json.gz
    python build_static_pages.py       # then: site/prices/, site/en/, site/sitemap-prices.xml

The output is build output (gitignored, like site/data/). Pages carry real,
dated, sourced shelf prices so crawlers and AI answer engines that do not run
JavaScript can read them. See israeli_prices/static_pages.py for the rules.

Stdlib only; safe to run in the Pages workflow without installing requirements.
"""
import argparse
import os
import sys
import time

from israeli_prices import static_pages as sp
from israeli_prices.static_pages import STATIC_PAGES_NOINDEX, GenerationError, generate


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default="site", help="site directory (default: site)")
    ap.add_argument("--data-dir", default="data",
                    help="snapshot history directory (default: data)")
    ap.add_argument("--products", default=None,
                    help="dataset path (default: <site>/data/products.json.gz)")
    args = ap.parse_args(argv)

    products = args.products or os.path.join(args.site, "data", "products.json.gz")
    if not os.path.exists(products):
        print(f"No dataset at {products}. Run build_site_data.py first.", file=sys.stderr)
        return 1
    started = time.time()
    # generate() validates the inputs (snapshot history, a non-empty page
    # selection) BEFORE it removes the previous output, so a failed run leaves
    # the live pages in place.
    try:
        stats = generate(site_dir=args.site, data_dir=args.data_dir, products_path=products)
    except GenerationError as exc:
        print(f"static pages not written: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:                      # surface any failure as a non-zero exit
        print(f"static pages failed: {exc!r}", file=sys.stderr)
        return 1

    excluded = {k[len("excluded_"):]: v for k, v in sorted(stats.items())
                if k.startswith("excluded_")}
    n = stats.get
    print(f"date     : {stats['date']} ({n('snapshot_days', 0)} snapshot days read)")
    print(f"entered  : {n('entered', 0):,} barcodes (>= {sp.MIN_ENTER_CHAINS} chains on "
          f">= {sp.ENTER_MIN_DAYS} days in {sp.ENTER_WINDOW_DAYS} days); "
          f"{n('entered_in_today_file', 0):,} in today's file, "
          f"{n('entered_missing_today', 0):,} not")
    print(f"kept     : {n('kept', 0):,} (>= {sp.KEEP_MIN_CHAINS} clean chain prices today); "
          f"{n('dropped_below_keep', 0):,} dropped below that")
    print(f"excluded : {sum(excluded.values()):,} "
          f"({', '.join(f'{k} {v}' for k, v in excluded.items()) or 'none'})")
    print(f"alcohol  : {n('alcohol_no_promo_text', 0):,} pages without promo text")
    print(f"promos   : {n('storewide_promos_hidden', 0):,} store-wide offers hidden "
          f"({n('storewide_promo_descriptions', 0)} descriptions carried by "
          f"> {sp.STOREWIDE_PROMO_MIN} products, plus spend-threshold/gift wording)")
    print(f"sizes    : {n('size_conflict_hidden', 0):,} pages without size/per-unit "
          "(the name states another size)")
    print(f"outliers : {n('outlier_prices_hidden', 0):,} chain prices hidden")
    print(f"changed  : {n('changed_since_previous', 0):,} products since the previous snapshot; "
          f"{n('no_observed_change', 0):,} pages with no observed change (no lastmod)")
    print(f"pages    : {n('product_pages', 0):,} product + {stats['category_pages']} category "
          f"+ hub + /en/ = {stats['files'] - 1:,} pages, sitemap"
          f"{' EMPTY (noindex)' if stats['noindex'] else ''}")
    print(f"output   : {stats['bytes'] / 1024 / 1024:.1f} MB under {args.site}/ "
          f"in {time.time() - started:.1f}s"
          f"{'  [STATIC_PAGES_NOINDEX on]' if STATIC_PAGES_NOINDEX else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
