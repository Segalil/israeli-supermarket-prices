#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build an Excel/CSV price database from Israeli supermarket price-transparency data.

Downloads the official price files (Israel's "Food Law" price transparency) for the
*online* stores of the leading grocery chains, parses them, and writes a combined
Excel + CSV dataset.

Run from a machine with normal internet access (the chains' publishing sites are
often blocked from restricted/cloud egress).

    pip install -r requirements.txt
    python build_price_db.py                    # 8 leading chains, online store
    python build_price_db.py --chains SHUFERSAL RAMI_LEVY
    python build_price_db.py --all-stores       # every branch (very large)
"""
import argparse
import glob
import os
import re
import shutil
import sys
from datetime import datetime

from israeli_prices.parser import (
    parse_price_file,
    parse_store_file,
    looks_online,
)

# leading chains: scraper key -> friendly (Hebrew) label
LEADING_CHAINS = {
    "SHUFERSAL": "שופרסל",
    "RAMI_LEVY": "רמי לוי",
    "VICTORY_NEW_SOURCE": "ויקטורי",
    "YAYNO_BITAN_AND_CARREFOUR": "יינות ביתן / קרפור",
    "YOHANANOF": "יוחננוף",
    "TIV_TAAM": "טיב טעם",
    "OSHER_AD": "אושר עד",
    "HAZI_HINAM": "חצי חינם",
}

DUMP_DIR = "dumps"
OUT_DIR = "out"

COL_ORDER = ["chain", "chain_id", "store_id", "barcode", "item_name",
             "manufacturer", "country", "quantity", "unit_of_measure",
             "unit_qty", "price", "unit_price", "is_weighted",
             "qty_in_package", "allow_discount", "item_status",
             "price_update_date"]
COL_HEB = {
    "chain": "רשת", "chain_id": "מזהה רשת", "store_id": "מזהה חנות",
    "barcode": "ברקוד", "item_name": "שם מוצר", "manufacturer": "יצרן",
    "country": "ארץ ייצור", "quantity": "כמות", "unit_of_measure": "יחידת מידה",
    "unit_qty": "יחידת כמות", "price": "מחיר (₪)", "unit_price": "מחיר ליחידה (₪)",
    "is_weighted": "שקיל", "qty_in_package": "כמות באריזה",
    "allow_discount": "מותר הנחה", "item_status": "סטטוס", "price_update_date": "עודכן",
}


# --------------------------- scraping ---------------------------
def scrape(chain_key, file_type, limit=None):
    from il_supermarket_scarper import ScarpingTask, FileTypesFilters
    task = ScarpingTask(
        enabled_scrapers=[chain_key],
        files_types=[getattr(FileTypesFilters, file_type).name],
        multiprocessing=1,
    )
    task.start(limit=limit)
    task.join()


def chain_dump_folder(chain_key):
    """Locate the dump folder created for a chain."""
    try:
        from il_supermarket_scarper.utils import DumpFolderNames
        p = os.path.join(DUMP_DIR, DumpFolderNames[chain_key].value)
        if os.path.isdir(p):
            return p
    except Exception:
        pass
    subs = [os.path.join(DUMP_DIR, d) for d in os.listdir(DUMP_DIR)
            if os.path.isdir(os.path.join(DUMP_DIR, d)) and d != "status"]
    return max(subs, key=os.path.getmtime) if subs else None


def find_online_store_id(chain_key):
    """Download a stores file and try to detect the online store id."""
    try:
        scrape(chain_key, "STORE_FILE", limit=1)
        folder = chain_dump_folder(chain_key)
        if not folder:
            return None
        for f in glob.glob(os.path.join(folder, "*")):
            if "store" in os.path.basename(f).lower():
                for sid, name in parse_store_file(f):
                    if looks_online(name):
                        return sid
    except Exception as exc:
        print(f"    (online detection failed: {exc})")
    return None


def collect_chain(chain_key, label, all_stores=False):
    print(f"[{label}] starting…")
    online_id = None
    if not all_stores:
        online_id = find_online_store_id(chain_key)
        print(f"    online store: store_id={online_id or 'not found – using a representative branch'}")

    limit = None if all_stores else (8 if online_id else 1)
    scrape(chain_key, "PRICE_FULL_FILE", limit=limit)
    folder = chain_dump_folder(chain_key)
    if not folder:
        print("    no files downloaded.")
        return []

    price_files = [f for f in glob.glob(os.path.join(folder, "*"))
                   if re.search(r"price", os.path.basename(f), re.I)
                   and "store" not in os.path.basename(f).lower()]
    rows, picked = [], 0
    for f in price_files:
        r = parse_price_file(f, label)
        if not r:
            continue
        if online_id and not all_stores:
            if r[0].get("store_id", "").lstrip("0") != online_id.lstrip("0"):
                continue
        rows.extend(r)
        picked += 1
        if not all_stores and not online_id and picked >= 1:
            break
    print(f"    collected {len(rows):,} rows from {picked} file(s).")
    return rows


# --------------------------- output ---------------------------
def write_outputs(rows, stamp):
    import pandas as pd
    os.makedirs(OUT_DIR, exist_ok=True)
    df = pd.DataFrame(rows)
    for c in COL_ORDER:
        if c not in df.columns:
            df[c] = ""
    df = df[COL_ORDER]
    for c in ("price", "unit_price"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

    csv_path = os.path.join(OUT_DIR, f"israeli_prices_{stamp}.csv")
    df.rename(columns=COL_HEB).to_csv(csv_path, index=False, encoding="utf-8-sig")

    xlsx_path = os.path.join(OUT_DIR, f"israeli_prices_{stamp}.xlsx")
    _write_xlsx(df, xlsx_path)
    return csv_path, xlsx_path, df


def _write_xlsx(df, path):
    import pandas as pd
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    summary = (df.groupby("chain")
                 .agg(מוצרים=("barcode", "count"),
                      מחיר_חציוני=("price", "median"),
                      מחיר_ממוצע=("price", "mean"))
                 .reset_index().rename(columns={"chain": "רשת"}))
    with pd.ExcelWriter(path, engine="openpyxl") as xl:
        df.rename(columns=COL_HEB).to_excel(xl, sheet_name="מחירים", index=False)
        summary.to_excel(xl, sheet_name="סיכום", index=False)
        for ws in xl.book.worksheets:
            ws.sheet_view.rightToLeft = True
            fill = PatternFill("solid", fgColor="1F4E78")
            for cell in ws[1]:
                cell.font = Font(name="Arial", bold=True, color="FFFFFF")
                cell.fill = fill
                cell.alignment = Alignment(horizontal="center", vertical="center")
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for col in ws.columns:
                width = max((len(str(c.value)) for c in col if c.value), default=8)
                ws.column_dimensions[get_column_letter(col[0].column)].width = min(width + 3, 45)
            for row in ws.iter_rows(min_row=2):
                for c in row:
                    if c.font is None or c.font.name != "Arial":
                        c.font = Font(name="Arial")


# --------------------------- main ---------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--chains", nargs="*", default=list(LEADING_CHAINS),
                    help="chain scraper keys (default: the 8 leading chains)")
    ap.add_argument("--all-stores", action="store_true",
                    help="every branch instead of just the online store (very large)")
    args = ap.parse_args()

    if os.path.isdir(DUMP_DIR):
        shutil.rmtree(DUMP_DIR, ignore_errors=True)

    stamp = datetime.now().strftime("%Y%m%d")
    all_rows = []
    for key in args.chains:
        label = LEADING_CHAINS.get(key, key)
        try:
            all_rows.extend(collect_chain(key, label, all_stores=args.all_stores))
        except Exception as exc:
            print(f"[{label}] error: {exc}")

    if not all_rows:
        print("No data collected. Check internet access and chain keys.")
        sys.exit(1)

    csv_path, xlsx_path, df = write_outputs(all_rows, stamp)
    print("\n=== summary ===")
    print(df.groupby("chain")["barcode"].count().to_string())
    print(f"\ntotal rows: {len(df):,}")
    print(f"CSV : {csv_path}")
    print(f"XLSX: {xlsx_path}")


if __name__ == "__main__":
    main()
