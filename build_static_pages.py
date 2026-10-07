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

from israeli_prices.static_pages import STATIC_PAGES_NOINDEX, generate


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
    try:
        stats = generate(site_dir=args.site, data_dir=args.data_dir, products_path=products)
    except Exception as exc:                      # surface any failure as a non-zero exit
        print(f"static pages failed: {exc!r}", file=sys.stderr)
        return 1

    excluded = {k[len("excluded_"):]: v for k, v in sorted(stats.items())
                if k.startswith("excluded_")}
    print(f"date     : {stats['date']} ({stats['snapshot_days']} snapshot days read)")
    print(f"entered  : {stats['entered']:,} barcodes (>= 5 chains on >= 3 days in 180 days); "
          f"{stats['entered_in_today_file']:,} in today's file, "
          f"{stats['entered_missing_today']:,} not")
    print(f"kept     : {stats['kept']:,} (>= 2 clean chain prices today); "
          f"{stats['dropped_below_keep']:,} dropped below that")
    print(f"excluded : {sum(excluded.values()):,} "
          f"({', '.join(f'{k} {v}' for k, v in excluded.items()) or 'none'})")
    print(f"alcohol  : {stats['alcohol_no_promo_text']:,} pages without promo text")
    print(f"outliers : {stats['outlier_prices_hidden']:,} chain prices hidden")
    print(f"changed  : {stats['changed_since_previous']:,} products since the previous snapshot")
    print(f"pages    : {stats['product_pages']:,} product + {stats['category_pages']} category "
          f"+ hub + /en/ = {stats['files'] - 1:,} pages, sitemap"
          f"{' EMPTY (noindex)' if stats['noindex'] else ''}")
    print(f"output   : {stats['bytes'] / 1024 / 1024:.1f} MB under {args.site}/ "
          f"in {time.time() - started:.1f}s"
          f"{'  [STATIC_PAGES_NOINDEX on]' if STATIC_PAGES_NOINDEX else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
