#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate the comparison site's dataset from the latest daily price snapshot.

    python build_site_data.py                          # newest data/israeli_prices_*.csv.gz
    python build_site_data.py --input out/israeli_prices_20260809.csv
    python build_site_data.py --output site/data/products.json.gz

Also writes site/data/retired.json.gz: the names of product keys that earlier
snapshots carried and today's dataset lacks, so lists saved against an older
catalogue can still be matched by name (see retired_names in basket.py).

Stdlib only; safe to run in the Pages workflow without installing requirements.
"""
import argparse
import glob
import gzip
import json
import os
import sys
from datetime import date, timedelta

from israeli_prices.basket import (
    DATA_DIR,
    RETIRED_PATH,
    SITE_DATA_PATH,
    build_site_data,
    known_keys,
    latest_snapshot,
    load_promo_rows,
    load_snapshot_rows,
    retired_names,
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
    ap.add_argument("--retired-output", default=RETIRED_PATH,
                    help=f"retired-key names (default: {RETIRED_PATH}; '' skips)")
    ap.add_argument("--retired-days", type=int, default=180,
                    help="how far back the retired-key scan looks (default: 180)")
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

    if args.retired_output:
        history = glob.glob(os.path.join(DATA_DIR, "israeli_prices_*.csv*"))
        try:
            since = (date.fromisoformat(data["date"]) -
                     timedelta(days=args.retired_days)).isoformat()
        except ValueError:
            since = ""
        names = retired_names(history, known_keys(data), since=since)
        payload = json.dumps({"date": data["date"], "keys": names},
                             ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        os.makedirs(os.path.dirname(args.retired_output) or ".", exist_ok=True)
        with open(args.retired_output, "wb") as fh:
            fh.write(gzip.compress(payload, mtime=0))
        print(f"retired  : {len(names):,} keys from {len(history)} snapshots "
              f"since {since or 'ever'} -> {args.retired_output} "
              f"({len(payload) / 1024:.0f} KB uncompressed)")


if __name__ == "__main__":
    main()
