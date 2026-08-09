#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the comparison site's dataset from the latest daily price snapshot.

    python build_site_data.py                          # newest data/israeli_prices_*.csv.gz
    python build_site_data.py --input out/israeli_prices_20260809.csv
    python build_site_data.py --output site/data/products.json.gz

Stdlib only; safe to run in the Pages workflow without installing requirements.
"""
import argparse
import sys

from israeli_prices.basket import (
    SITE_DATA_PATH,
    build_site_data,
    latest_snapshot,
    load_promo_rows,
    load_snapshot_rows,
    snapshot_date,
    write_site_data,
)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", help="prices snapshot CSV (.csv / .csv.gz); "
                                    "default: newest under data/")
    ap.add_argument("--promos", help="promos snapshot CSV; default: newest "
                                     "under data/ (skipped if none)")
    ap.add_argument("--output", default=SITE_DATA_PATH,
                    help=f"output path (default: {SITE_DATA_PATH})")
    args = ap.parse_args()

    path = args.input or latest_snapshot()
    if not path:
        print("No snapshot found under data/. Run build_price_db.py first, "
              "or pass --input.", file=sys.stderr)
        sys.exit(1)

    promos_path = args.promos or latest_snapshot(kind="promos")
    promo_rows = load_promo_rows(promos_path) if promos_path else []

    print(f"snapshot : {path}")
    print(f"promos   : {promos_path or '(none)'}")
    rows = load_snapshot_rows(path)
    data = build_site_data(rows, date=snapshot_date(path), promo_rows=promo_rows)
    raw_bytes = write_site_data(data, args.output)

    n_promo = sum(1 for p in data["products"] if p[6])
    print(f"chains   : {len(data['chains'])} ({', '.join(data['chains'])})")
    print(f"products : {len(data['products']):,} (from {len(rows):,} rows; "
          f"{n_promo:,} with promos)")
    print(f"output   : {args.output} ({raw_bytes / 1024:.0f} KB uncompressed)")


if __name__ == "__main__":
    main()
