# -*- coding: utf-8 -*-
"""Tests for the price-file parser (no network required)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from israeli_prices.parser import parse_price_file, parse_promo_file, looks_online

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


def test_itemnm_variant(tmp_path):
    """Rami Levy (Cerberus) uses <ItemNm>; ItemNm must win over the later
    ManufacturerItemDescription fallback."""
    xml = """<?xml version="1.0" encoding="utf-8"?>
    <Root><ChainId>729</ChainId><StoreId>39</StoreId><Items><Item>
      <ItemCode>123</ItemCode>
      <ItemNm>חלב תנובה</ItemNm>
      <ManufacturerItemDescription>תיאור יצרן ארוך</ManufacturerItemDescription>
      <ItemPrice>5.9</ItemPrice>
    </Item></Items></Root>"""
    p = tmp_path / "pricefull-test.xml"
    p.write_text(xml, encoding="utf-8")
    rows = parse_price_file(str(p), "רמי לוי")
    assert rows[0]["item_name"] == "חלב תנובה"
    assert rows[0]["price"] == "5.9"


def test_promo_variant_shufersal_gzip():
    """Real Shufersal PromoFull structure: per-item fields under Groups."""
    rows = parse_promo_file(os.path.join(SAMPLES, "promo.xml.gz"), "שופרסל")
    assert rows, "no promo rows parsed"
    first = rows[0]
    assert first["chain"] == "שופרסל"
    assert first["store_id"] == "413"
    assert first["promo_id"]
    assert first["description"]
    assert first["barcode"].isdigit()
    assert float(first["discounted_price"]) > 0


def test_looks_online():
    assert looks_online("שופרסל אונליין")
    assert looks_online("Rami Levy ONLINE delivery")
    assert not looks_online("סניף ירושלים תלפיות")


if __name__ == "__main__":
    for fn in [test_item_variant_utf8, test_product_variant_gzip_win1255, test_looks_online]:
        fn()
        print(f"PASS {fn.__name__}")
    print("all tests passed")
