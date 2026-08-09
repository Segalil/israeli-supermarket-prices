# -*- coding: utf-8 -*-
"""Parsing utilities for Israeli price-transparency XML files.

Handles the two common schema variants (``<Item>`` / ``<Product>``), gzip
compression, and both ``utf-8`` and ``windows-1255`` encodings.
"""
import gzip
import re
import xml.etree.ElementTree as ET

# possible source tag names -> normalized column name
FIELD_MAP = {
    "itemcode": "barcode", "itemname": "item_name",
    "manufacturername": "manufacturer", "manufacturecountry": "country",
    "unitqty": "unit_qty", "quantity": "quantity",
    "unitofmeasure": "unit_of_measure", "bisweighted": "is_weighted",
    "qtyinpackage": "qty_in_package", "itemprice": "price",
    "unitofmeasureprice": "unit_price", "allowdiscount": "allow_discount",
    "itemstatus": "item_status", "priceupdatedate": "price_update_date",
}

ONLINE_KEYWORDS = ["אונליין", "און ליין", "און-ליין", "אינטרנט", "משלוח",
                   "online", "web", "ecom", "e-com", "deliver", "דלי"]


def read_bytes(path):
    """Read a file, transparently decompressing gzip."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:2] == b"\x1f\x8b":  # gzip magic bytes
        data = gzip.decompress(data)
    return data


def _localname(tag):
    return tag.split("}")[-1].lower() if tag else ""


def _text(el):
    return (el.text or "").strip() if el is not None and el.text else ""


def root_from_bytes(raw):
    """Parse XML bytes, tolerating declared windows-1255 encoding / stray bytes."""
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        txt = raw.decode("windows-1255", errors="replace")
        txt = re.sub(r'encoding="[^"]+"', 'encoding="utf-8"', txt, count=1)
        return ET.fromstring(txt.encode("utf-8"))


def parse_price_file(path, chain_label=None):
    """Parse one Price/PriceFull file into a list of normalized dict rows."""
    root = root_from_bytes(read_bytes(path))
    header = {}
    for child in root:
        ln = _localname(child.tag)
        if ln in ("chainid", "storeid", "subchainid"):
            header[ln] = _text(child)

    rows = []
    for el in root.iter():
        if _localname(el.tag) in ("item", "product"):
            row = {
                "chain": chain_label,
                "chain_id": header.get("chainid", ""),
                "store_id": header.get("storeid", ""),
            }
            for sub in el:
                col = FIELD_MAP.get(_localname(sub.tag))
                if col:
                    row[col] = _text(sub)
            if row.get("barcode") or row.get("item_name"):
                rows.append(row)
    return rows


def parse_store_file(path):
    """Parse a Stores file into ``[(store_id, display_name), ...]``."""
    root = root_from_bytes(read_bytes(path))
    stores = []
    for el in root.iter():
        if _localname(el.tag) == "store":
            sid = name = subchain = ""
            for sub in el.iter():
                l = _localname(sub.tag)
                if l == "storeid":
                    sid = _text(sub)
                elif l == "storename":
                    name = _text(sub)
                elif l == "subchainname":
                    subchain = _text(sub)
            if sid:
                stores.append((sid, f"{subchain} {name}".strip()))
    return stores


def looks_online(name):
    """True if a store display name looks like an online / delivery store."""
    low = (name or "").lower()
    return any(k.lower() in low for k in ONLINE_KEYWORDS)
