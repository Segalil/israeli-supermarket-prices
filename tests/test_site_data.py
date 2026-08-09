# -*- coding: utf-8 -*-
"""Tests for the site dataset builder (no network required)."""
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from israeli_prices.basket import (
    HEB_TO_COL,
    PROMO_HEB_TO_COL,
    barcode_key,
    build_site_data,
    clean_name,
    consolidate_by_name,
    format_unit,
    load_snapshot_rows,
    name_signature,
    snapshot_date,
    write_site_data,
)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def row(chain, barcode, name, price, **kw):
    base = {"chain": chain, "barcode": barcode, "item_name": name, "price": price,
            "quantity": "1.00", "unit_qty": "יחידה", "unit_of_measure": ""}
    base.update(kw)
    return base


def test_hebrew_headers_match_build_price_db():
    from build_price_db import COL_HEB, PROMO_COL_HEB
    assert HEB_TO_COL == {v: k for k, v in COL_HEB.items()}
    assert PROMO_HEB_TO_COL == {v: k for k, v in PROMO_COL_HEB.items()}


def test_merges_same_barcode_across_chains():
    data = build_site_data([
        row("שופרסל", "7290004131074", "חלב 3% שומן", "6.90"),
        row("רמי לוי", "7290004131074", "חלב תנובה 3% שומן 1 ליטר", "5.90"),
    ])
    assert data["chains"] == ["שופרסל", "רמי לוי"]
    assert len(data["products"]) == 1
    key, name, unit, brand, prices, aliases, promos, cat = data["products"][0]
    assert key == "7290004131074"
    assert name == "חלב תנובה 3% שומן 1 ליטר"   # longest name wins
    assert prices == [6.90, 5.90]


def test_brand_first_non_empty_wins():
    data = build_site_data([
        row("שופרסל", "7290004131074", "חלב", "6.90", manufacturer=""),
        row("רמי לוי", "7290004131074", "חלב", "5.90", manufacturer="תנובה"),
    ])
    assert data["products"][0][3] == "תנובה"


def test_internal_codes_stay_per_chain():
    data = build_site_data([
        row("שופרסל", "1022788", "מלפפון", "4.90"),
        row("רמי לוי", "1022788", "עגבניה", "3.90"),
    ])
    assert len(data["products"]) == 2          # 7-digit PLU: never cross-chain


def test_leading_zero_barcodes_merge():
    data = build_site_data([
        row("שופרסל", "07290004131074", "חלב", "6.90"),
        row("רמי לוי", "7290004131074", "חלב", "5.90"),
    ])
    assert len(data["products"]) == 1


def test_duplicate_rows_keep_min_price():
    data = build_site_data([
        row("שופרסל", "7290004131074", "חלב", "6.90"),
        row("שופרסל", "7290004131074", "חלב", "6.20"),
    ])
    assert data["products"][0][4] == [6.20]


def test_name_signature_order_independent():
    assert name_signature("חלב תנובה 3%") == name_signature("3% חלב תנובה")
    assert name_signature("חלב תנובה 3%") != name_signature("חלב תנובה 1%")
    assert name_signature("חלב") is None          # single token — unsafe to merge


def test_consolidates_same_name_different_barcodes():
    data = build_site_data([
        row("שופרסל", "7290000000001", "חלב תנובה 3% 1 ליטר", "6.90"),
        row("רמי לוי", "7290000000002", "3% חלב תנובה 1 ליטר", "5.90"),
    ])
    assert len(data["products"]) == 1
    key, name, unit, brand, prices, aliases, promos, cat = data["products"][0]
    assert key.startswith("n:")
    assert prices == [6.90, 5.90]
    assert set(aliases) == {"7290000000001", "7290000000002"}   # saved lists survive


def test_no_consolidation_when_same_chain_conflict():
    # two SKUs in the SAME chain with reordered names must stay separate
    data = build_site_data([
        row("שופרסל", "7290000000001", "חלב תנובה 3% 1 ליטר", "6.90"),
        row("שופרסל", "7290000000002", "3% חלב תנובה 1 ליטר", "5.90"),
    ])
    assert len(data["products"]) == 2


def promo_row(chain, barcode, desc, price="", **kw):
    base = {"chain": chain, "barcode": barcode, "description": desc,
            "discounted_price": price, "end_date": "", "min_qty": "1",
            "club": "0", "is_coupon": "0"}
    base.update(kw)
    return base


def test_promos_attached_per_chain():
    data = build_site_data(
        [row("שופרסל", "7290004131074", "חלב תנובה", "6.90"),
         row("רמי לוי", "7290004131074", "חלב תנובה", "5.90")],
        date="2026-08-09",
        promo_rows=[
            promo_row("שופרסל", "7290004131074", "2 ב-10", "10.00", min_qty="2"),
            promo_row("רמי לוי", "7290004131074", "מבצע חלב", "4.90"),
            promo_row("רמי לוי", "7290004131074", "פג תוקף", "1.00", end_date="2026-01-01"),
        ])
    promos = data["products"][0][6]
    # deal total 10 for 2 -> normalized to 5.00/unit, conditional flag, min_qty 2
    assert promos[0] == [5.00, "2 ב-10", 4, 2]
    assert promos[1] == [4.90, "מבצע חלב", 0, 1]  # applicable; expired one ignored


def test_deal_price_normalization_rules():
    # no desc hint but raw (12) > base (6.90) -> must be a bundle total -> /3
    data = build_site_data(
        [row("שופרסל", "7290004131074", "חלב תנובה", "6.90")],
        promo_rows=[promo_row("שופרסל", "7290004131074", "מבצע שלישייה", "12.00",
                              min_qty="3")])
    assert data["products"][0][6][0] == [4.00, "מבצע שלישייה", 4, 3]

    # ambiguous: raw (5) <= base and no desc match -> badge only (no wrong price)
    data = build_site_data(
        [row("שופרסל", "7290004131074", "חלב תנובה", "6.90")],
        promo_rows=[promo_row("שופרסל", "7290004131074", "מבצע מיוחד", "5.00",
                              min_qty="2")])
    assert data["products"][0][6][0] == [None, "מבצע מיוחד", 4, 2]


def test_club_promo_flagged():
    data = build_site_data(
        [row("שופרסל", "7290004131074", "חלב תנובה", "6.90")],
        promo_rows=[promo_row("שופרסל", "7290004131074", "למועדון בלבד", "4.00",
                              club="1")])
    assert data["products"][0][6][0][2] == 1       # PROMO_CLUB flag


def test_category_classification():
    from israeli_prices.basket import CATEGORIES, classify_category
    cases = {
        "חלב טרי 3% 1 ליטר": "חלב, ביצים וגבינות",
        "שוקולד חלב 100 גרם": "חטיפים ומתוקים",     # snack, not dairy
        "חלבה במשקל": "חטיפים ומתוקים",              # halva, not dairy
        "רסק עגבניות 100 גרם": "שימורים ובישול",     # phrase beats produce
        "עגבניות שרי": "פירות וירקות",
        "מלפפונים במלח 7-9": "שימורים ובישול",       # pickles, not produce
        "תפוח אדמה לבן": "פירות וירקות",
        "פלפל שחור גרוס": "שימורים ובישול",          # spice, not produce
        "גלידה וניל": "קפואים",
        "נייר טואלט 32 גליל": "ניקיון וחד־פעמי",
        "שמפו לשיער יבש": "טואלטיקה והיגיינה",
        "לחם אחיד פרוס": "לחם ומאפים",
        "עוגת גבינה": "לחם ומאפים",                  # bakery beats dairy
        "טונה בשמן 4*160": "שימורים ובישול",
        "בירה גולדסטאר": "משקאות",
        "שניצל עוף טרי": "בשר, עוף ודגים",
        "ביצים L תריסר": "חלב, ביצים וגבינות",
        "מוצר עלום כלשהו": "אחר",
    }
    for name, expected in cases.items():
        assert CATEGORIES[classify_category(name)] == expected, name


def test_products_carry_category_index():
    data = build_site_data([row("שופרסל", "7290004131074", "חלב תנובה", "6.90")])
    assert data["categories"][data["products"][0][7]] == "חלב, ביצים וגבינות"


def test_invalid_or_zero_price_rows_skipped():
    data = build_site_data([
        row("שופרסל", "7290004131074", "חלב", "0"),
        row("שופרסל", "7290004131075", "לחם", "not-a-price"),
        row("שופרסל", "7290004131076", "ביצים", "12.30"),
    ])
    assert [p[1] for p in data["products"]] == ["ביצים"]


def test_clean_name_strips_promo_tags():
    assert clean_name("*מבצע* גבינת פקורינו") == "גבינת פקורינו"
    assert clean_name("  חלב   תנובה ") == "חלב תנובה"
    assert clean_name("*מבצע*") == "*מבצע*"    # all-tag name falls back, not emptied


def test_format_unit():
    assert format_unit("1.00", "קילוגרם", "1קילוגרם") == "1 קילוגרם"
    assert format_unit("0.5", "ליטר", "") == "0.5 ליטר"
    assert format_unit("", "", "יחידה") == "יחידה"


def test_barcode_key():
    assert barcode_key("7290004131074") == "7290004131074"
    assert barcode_key("00123456789") == "123456789"
    assert barcode_key("1022788") is None      # internal code
    assert barcode_key("ABC123") is None
    assert barcode_key("") is None
    assert barcode_key("0000000000000") is None   # all-zero pseudo-barcode


def test_snapshot_date():
    assert snapshot_date("data/israeli_prices_2026-08-09.csv.gz") == "2026-08-09"
    assert snapshot_date("out/israeli_prices_20260809.csv") == "2026-08-09"


def test_real_snapshot_roundtrip(tmp_path):
    """End-to-end over the checked-in daily snapshot (skipped if absent)."""
    import pytest
    snaps = sorted(glob.glob(os.path.join(DATA_DIR, "israeli_prices_*.csv.gz")))
    if not snaps:
        pytest.skip("no snapshot in data/")
    rows = load_snapshot_rows(snaps[-1])
    assert rows and rows[0]["chain"]           # Hebrew headers mapped
    data = build_site_data(rows, date=snapshot_date(snaps[-1]))
    assert data["chains"] and len(data["products"]) > 1000
    out = tmp_path / "products.json.gz"
    write_site_data(data, str(out))
    parsed = json.loads(gzip.decompress(out.read_bytes()))
    assert parsed["chains"] == data["chains"]
    assert all(len(p) == 8 and len(p[4]) == len(data["chains"])
               for p in parsed["products"])


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and k != "test_real_snapshot_roundtrip"]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print("all tests passed")
