# -*- coding: utf-8 -*-
"""Tests for the price-file parser (no network required)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from israeli_prices.parser import parse_price_file, looks_online

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")


def test_item_variant_utf8():
    rows = parse_price_file(os.path.join(SAMPLES, "item.xml"), "שופרסל אונליין")
    assert len(rows) == 2
    first = rows[0]
    assert first["barcode"] == "7290004131074"
    assert first["item_name"] == "חלב תנובה 3% שומן 1 ליטר"
    assert first["price"] == "6.90"
    assert first["chain"] == "שופרסל אונליין"
    assert first["store_id"] == "331"


def test_product_variant_gzip_win1255():
    rows = parse_price_file(os.path.join(SAMPLES, "product.xml.gz"), "רמי לוי אונליין")
    assert len(rows) == 1
    assert rows[0]["item_name"] == "לחם אחיד פרוס"   # Hebrew survives windows-1255
    assert rows[0]["price"] == "5.50"


def test_looks_online():
    assert looks_online("שופרסל אונליין")
    assert looks_online("Rami Levy ONLINE delivery")
    assert not looks_online("סניף ירושלים תלפיות")


if __name__ == "__main__":
    for fn in [test_item_variant_utf8, test_product_variant_gzip_win1255, test_looks_online]:
        fn()
        print(f"PASS {fn.__name__}")
    print("all tests passed")
