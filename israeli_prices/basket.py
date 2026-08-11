# -*- coding: utf-8 -*-
"""Build the compact product/price dataset that powers the comparison site.

Reads a daily snapshot CSV (the output of build_price_db.py, possibly gzipped),
merges the same product across chains by barcode, and produces a small JSON
structure the static site can load client-side.

Stdlib only — the Pages build must not need pandas.
"""
import csv
import glob
import gzip
import io
import json
import os
import re
from datetime import datetime, timezone

# Hebrew CSV headers -> internal column names.
# Keep in sync with COL_HEB / PROMO_COL_HEB in build_price_db.py (tests assert this).
HEB_TO_COL = {
    "רשת": "chain", "מזהה רשת": "chain_id", "מזהה חנות": "store_id",
    "ברקוד": "barcode", "שם מוצר": "item_name", "יצרן": "manufacturer",
    "ארץ ייצור": "country", "כמות": "quantity", "יחידת מידה": "unit_of_measure",
    "יחידת כמות": "unit_qty", "מחיר (₪)": "price", "מחיר ליחידה (₪)": "unit_price",
    "שקיל": "is_weighted", "כמות באריזה": "qty_in_package",
    "מותר הנחה": "allow_discount", "סטטוס": "item_status", "עודכן": "price_update_date",
}
PROMO_HEB_TO_COL = {
    "רשת": "chain", "מזהה רשת": "chain_id", "מזהה חנות": "store_id",
    "ברקוד": "barcode", "מזהה מבצע": "promo_id", "תיאור מבצע": "description",
    "בתוקף עד": "end_date", "כמות מינימום": "min_qty",
    "מחיר מבצע (₪)": "discounted_price", "שיעור הנחה": "discount_rate",
    "מועדון": "club", "קופון": "is_coupon", "סוג הטבה": "reward_type",
}

DATA_DIR = "data"
SITE_DATA_PATH = os.path.join("site", "data", "products.json.gz")

# promo flags bitmask (also decoded in site/app.js)
PROMO_CLUB, PROMO_COUPON, PROMO_CONDITIONAL = 1, 2, 4

# marketing tags embedded in product names, e.g. "*מבצע* גבינת פקורינו"
_TAG_RE = re.compile(r"\*[^*]*\*")
_WS_RE = re.compile(r"\s+")


def latest_snapshot(data_dir=DATA_DIR, kind="prices"):
    """Newest snapshot CSV in ``data_dir`` (date is embedded in the filename)."""
    paths = glob.glob(os.path.join(data_dir, f"israeli_{kind}_*.csv*"))
    return max(paths) if paths else None


def snapshot_date(path):
    """Extract YYYY-MM-DD from a snapshot filename (also accepts YYYYMMDD)."""
    name = os.path.basename(path or "")
    m = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", name)
    return "-".join(m.groups()) if m else ""


def load_snapshot_rows(path, header_map=None):
    """Read a snapshot CSV (.csv or .csv.gz) into dicts with internal column names."""
    header_map = header_map or HEB_TO_COL
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8-sig")
    rows = []
    for rec in csv.DictReader(io.StringIO(text)):
        rows.append({header_map.get(k, k): (v or "").strip()
                     for k, v in rec.items() if k})
    return rows


def load_promo_rows(path):
    """Read a promos snapshot CSV into dicts with internal column names."""
    return load_snapshot_rows(path, header_map=PROMO_HEB_TO_COL)


def clean_name(name):
    """Strip ``*tag*`` marketing markers and collapse whitespace."""
    cleaned = _WS_RE.sub(" ", _TAG_RE.sub(" ", name or "")).strip()
    return cleaned or (name or "").strip()


def strip_chain_name(name, chain):
    """Drop the retailer's own name from a product name.

    Chains tag their private/loose items with their brand ("עגבניות שרי כתום
    רמי לוי"), which blocks the cross-chain name merge and reads as noise in a
    UI that already shows the chain. Only a trailing occurrence is removed, so
    a genuine brand mid-name survives.
    """
    cleaned = clean_name(name)
    parts = [p.strip() for p in (chain or "").split("/") if p.strip()]
    for part in sorted(parts, key=len, reverse=True):
        if len(part) < 3:
            continue
        if cleaned.endswith(" " + part):
            trimmed = cleaned[: -len(part)].strip()
            if len(trimmed.split()) >= 1 and trimmed:
                cleaned = trimmed
    return cleaned or clean_name(name)


# Package size in comparable terms: "1 ק\"ג", "1 קילוגרם" and "1000 גרם" are the
# same size and must land in the same merge bucket. ml is checked before ליטר
# because "מיליליטר" contains it, and ק"ג before גרם for the same reason.
_UNIT_KINDS = (
    (re.compile(r'ק"?ג\b|קילוגרם|קילו\b'), "g", 1000.0),
    (re.compile(r'מ"?ל\b|מיליליטר'), "ml", 1.0),
    (re.compile(r"ליטר|\bל'?\b"), "ml", 1000.0),
    (re.compile(r"גרם|\bגר'?\b|\bג'?\b"), "g", 1.0),
    (re.compile(r"יחיד|\bיח'?\b|\bקרטון\b|\bמארז\b"), "unit", 1.0),
)
_QTY_RE = re.compile(r"[\d.]+")


def unit_signature(unit):
    """Canonical (kind, amount) for a display unit, or None when unrecognised.

    Returns e.g. ('g', 1000.0) for both '1 ק"ג' and '1000 גרם'. None means the
    unit carries no comparable size, and callers must not merge on it.
    """
    text = (unit or "").strip()
    if not text:
        return None
    m = _QTY_RE.search(text)
    try:
        amount = float(m.group()) if m else 1.0
    except ValueError:
        amount = 1.0
    if amount <= 0:
        return None                       # "0 יחידות" tells us nothing
    for pattern, kind, factor in _UNIT_KINDS:
        if pattern.search(text):
            return kind, round(amount * factor, 3)
    return None


def barcode_key(barcode):
    """Cross-chain merge key for a real (EAN-like) barcode, else None.

    Internal PLU/short codes (< 8 digits) collide between chains and must not
    be merged. Leading zeros are normalized so the same EAN matches even when
    one chain zero-pads it.
    """
    b = (barcode or "").strip()
    if b.isdigit() and len(b) >= 8:
        stripped = b.lstrip("0")
        return stripped if stripped else None    # all-zero pseudo-barcodes stay chain-scoped
    return None


def format_unit(quantity, unit_qty, unit_of_measure):
    """Human display of package size, e.g. ('1.00', 'קילוגרם', ...) -> '1 קילוגרם'."""
    qty = (quantity or "").strip()
    if qty:
        try:
            f = float(qty)
            qty = str(int(f)) if f == int(f) else ("%g" % f)
        except ValueError:
            pass
    unit = (unit_qty or "").strip() or (unit_of_measure or "").strip()
    return " ".join(p for p in (qty, unit) if p)


def _parse_price(value):
    try:
        p = float(value)
    except (TypeError, ValueError):
        return None
    return round(p, 2) if p > 0 else None


# ---------------------------------------------------------------------------
# Product categories — the transparency files carry no category field, so we
# classify by name keywords. Two passes: multi-word rules first (most
# specific: "רסק עגבניות" is pantry, not produce), then single-word rules in
# category order (earlier category wins: "שוקולד חלב" is a snack, not dairy).
# Index 0 is the uncategorized fallback.
CATEGORIES = ["אחר", "פירות וירקות", "חלב, ביצים וגבינות", "בשר, עוף ודגים",
              "לחם ומאפים", "שימורים ובישול", "חטיפים ומתוקים", "משקאות",
              "קפואים", "ניקיון וחד־פעמי", "טואלטיקה והיגיינה"]

_CATEGORY_RULES = [
    (8, ["מלוואח", "גחנון"],
        ["קפוא", "קפואה", "קפואים", "קפואות", "מוקפא", "מוקפאת", "מוקפאים",
         "שלגון", "שלגוני", "גלידה", "גלידת", "ארטיק"]),
    (9, ["נייר טואלט", "אבקת כביסה", "מרכך כביסה", "נוזל כלים", "שקיות אשפה",
         "מגבות נייר", "חד פעמי"],
        ["אקונומיקה", "מטליות", "מטלית", "ספוג", "אסלה", "ניקוי", "לניקוי",
         "מנקה", "מסיר", "כביסה", "אשפה", "מפיות", "מפות", "קשיות", "קשית",
         "רדיד", "נצמד", "גפרורים", "נרות", "כוסות", "כוס", "צלחות", "צלחת",
         "פלסטיק", "סיליקון", "שקיות", "שקית", "כפפות", "תבנית", "תבניות",
         "מגש", "מגשים", "נייר", "סנו", "סכו", "אלבד"]),
    (10, ["משחת שיניים", "מברשת שיניים", "מי פה"],
        ["שמפו", "מרכך", "סבון", "דאודורנט", "חיתולים", "טיטולים", "מגבונים",
         "גילוח", "תחבושות", "טמפונים", "קרם", "תחליב", "בושם", "מטרנה",
         "סימילק", "שיניים", "שיער", "לשיער", "אמבט", "שפתון", "שפתיים",
         "עפרון", "סרום", "מסכה", "מסקרה", "סומק", "קונסילר", "גבות", "לק",
         "איפור", "אודם", "דאו", "בשמים", "אצטון", "ציפורניים", "לחות",
         "שיזוף", "פנים", "טישו"]),
    (6, ["ממרח שוקולד"],
        ["שוקולד", "במבה", "ביסלי", "חטיף", "חטיפי", "ציפס", "תפוציפס",
         "אפרופו", "דוריטוס", "ציטוס", "פרינגלס", "פופקורן",
         "מסטיק", "סוכריות", "סוכריה", "ופל", "וופל", "ופלים", "עוגיות",
         "עוגיה", "ביסקוויט", "קרקר", "קרקרים", "חלבה", "חלווה", "טופי",
         "מרשמלו", "פיצוחים", "בוטנים", "גרעינים", "אגוזי", "שקדים",
         "צימוקים", "בייגלה", "מיובשים", "מיובשות", "מיובש"]),
    (7, ["מים מינרלים", "מי עדן", "משקה אנרגיה", "קפסולות קפה", "נס קפה"],
        ["מים", "סודה", "קולה", "מיץ", "נקטר", "תרכיז", "בירה", "יין",
         "וודקה", "ויסקי", "ערק", "ליקר", "משקה", "שתיה", "קפה", "תה",
         "שוקו", "אספרסו", "קפסולות", "חליטה", "חליטת", "חליטות", "תפוזינה",
         "מוגז",
         "מוגזים", "מירינדה", "ספרינג", "נורדיק", "פריגת", "פיוז", "נביעות",
         "נסטי", "שוופס", "פאנטה", "ספרייט", "מונסטר", "אקסל"]),
    (3, [],
        ["עוף", "פרגית", "פרגיות", "חזה", "שניצל", "כרעיים", "כנפיים",
         "הודו", "בקר", "טחון", "סטייק", "אנטריקוט", "צלעות", "כבש", "טלה",
         "קבב", "המבורגר", "נקניק", "נקניקיות", "פסטרמה", "קורנדביף",
         "סלמון", "דג", "דגים", "אמנון", "בורי", "לברק", "דניס", "פילה",
         "מושט", "הרינג", "מטיאס"]),
    (4, [],
        ["לחם", "לחמניה", "לחמניות", "פיתה", "פיתות", "חלה", "חלות", "בגט",
         "טורטיה", "קרואסון", "מאפה", "מאפים", "בורקס", "טוסט", "עוגה",
         "עוגת", "עוגות", "מצות", "בייגל"]),
    (2, ["ביצי חופש"],
        ["חלב", "גבינה", "גבינת", "גבינות", "קוטג", "יוגורט", "שמנת",
         "חמאה", "אשל", "גיל", "מעדן", "מעדני", "מילקי", "פודינג",
         "ביצים", "ביצי", "מוצרלה", "בולגרית", "צפתית", "פטה", "ריקוטה",
         "קשקבל", "גאודה", "עמק", "סקי", "קממבר", "לאבנה"]),
    (5, ["פלפל שחור", "פלפל לבן", "מלפפון חמוץ", "מלפפונים חמוצים",
         "מלפפון בחומץ", "עגבניות מרוסקות", "עגבניה מרוסקת", "רסק עגבניות",
         "וילי פוד", "ויליפוד",
         "רוטב עגבניות", "אבקת מרק", "אבקת רוטב", "שימורי",
         "מלפפון במלח", "מלפפונים במלח", "מלפפונים בחומץ", "אבקת אפיה",
         "דגני בוקר", "שיבולת שועל", "פירורי לחם", "רסק עגבניות"],
        ["אורז", "פסטה", "ספגטי", "פתיתים", "קוסקוס", "בורגול", "קינואה",
         "עדשים", "גרגרי", "חומוס", "טחינה", "קמח", "סוכר", "מלח", "תבלין",
         "תבליני", "פפריקה", "כמון", "כורכום", "קינמון", "שמן", "חומץ",
         "רוטב", "רטבים", "קטשופ", "מיונז", "חרדל", "שימורי", "שימורים",
         "תירס", "אפונה", "זיתים", "טונה", "סרדינים", "שמרים", "וניל",
         "קורנפלקס", "גרנולה", "דייסה", "סילאן", "דבש", "ריבה", "ממרח",
         "אבקת", "מרק", "אינסטנט", "נודלס", "אטריות", "שעועית", "תערובת",
         "פירה", "פצפוצי", "פריכיות", "כבוש", "כבושים"]),
    (1, [],
        ["עגבני", "עגבניות", "מלפפון", "מלפפונים", "פלפל", "בצל", "שום",
         "גזר", "חסה", "כרוב", "קישוא", "חציל", "בננה", "בננות", "אבטיח",
         "מלון", "ענבים", "תות", "אגס", "אפרסק", "שזיף", "נקטרינה", "מנגו",
         "אננס", "לימון", "תפוז", "קלמנטינה", "מנדרינה", "אבוקדו",
         "פטרוזיליה", "כוסברה", "שמיר", "נענע", "בזיליקום", "פטריות",
         "פטריה", "סלרי", "צנונית", "סלק", "דלעת", "בטטה", "קיווי", "רימון",
         "תמר", "תפוח", "ירקות", "פירות", "ירק"]),
]

_QUOTES_RE = re.compile(r"['\"׳״`]")

# produce matches only at the START of a name: actual produce leads with the
# fruit/vegetable ("תות שדה", "עגבניות שרי") while flavored products lead with
# the product type ("מולר מנגו", "לוקיטוס תותי") and must not land in produce.
_PRODUCE_CONTAINERS = {"מארז", "זוג", "שקית", "ארגז", "מגש", "קרטון", "חבילת",
                       "שלישיית", "רביעיית", "צרור"}


def classify_category(name):
    """Category index (into CATEGORIES) for a product name; 0 = uncategorized.

    Flavor/scent suffixes are ignored ("תפוציפס בטעם שמנת בצל" must not become
    produce because of בצל), and the most generic rules (produce) run last.
    """
    norm = _QUOTES_RE.sub("", (name or "").lower())
    for cut in ("בטעם", "בניחוח"):
        idx = norm.find(cut)
        if idx > 0:
            norm = norm[:idx]
    words = norm.split()
    for cat, multi, _ in _CATEGORY_RULES:          # pass 1: specific phrases
        for phrase in multi:
            if phrase in norm:
                return cat
    for cat, _, singles in _CATEGORY_RULES:        # pass 2: word prefixes
        if cat == 1:                               # produce: first word only
            positions = [0]
            if words and words[0] in _PRODUCE_CONTAINERS and len(words) > 1:
                positions.append(1)
            for kw in singles:
                if any(words[i].startswith(kw) for i in positions if i < len(words)):
                    return cat
        else:
            for kw in singles:
                if any(w.startswith(kw) for w in words):
                    return cat
    return 0


_SIG_STRIP_RE = re.compile(r"[^\w%]+", re.UNICODE)

# Measurement words inside a NAME, folded to one spelling so that
# "כוסמת 500 ג" and "כוסמת 500 גרם" reach the same signature. Only the unit word
# is folded — a name that differs by a real descriptive word ("עוגת שמרים" vs
# "עוגת שמרים במילוי") still has a different signature and will not merge.
_SIG_UNIT_WORDS = {
    "גרם": "g", "גר": "g", "ג": "g", "גרמים": "g",
    "קג": "kg", "קילוגרם": "kg", "קילו": "kg", "קילוגרמים": "kg",
    "מל": "ml", "מיליליטר": "ml",
    "ל": "l", "ליטר": "l", "ליטרים": "l",
    "יח": "un", "יחידה": "un", "יחידות": "un", "יחי": "un",
}


def name_signature(name):
    """Order-independent name signature: 'חלב תנובה 3%' == '3% חלב תנובה'.

    Lowercases, strips punctuation/geresh, sorts the tokens. Returns None for
    names too short to be a safe merge key. A single token is a weak key on its
    own — consolidate_by_name accepts it only for loose produce, where it is
    the norm ("אבוקדו", "אבטיח") — see _is_loose_produce_unit.
    """
    cleaned = _SIG_STRIP_RE.sub(" ", (name or "").lower().replace("'", " "))
    tokens = sorted(_SIG_UNIT_WORDS.get(t, t) for t in cleaned.split() if t)
    if not tokens:
        return None
    return " ".join(tokens)


def _is_loose_produce_unit(unit_sig):
    """True for the by-weight / by-piece units loose produce is sold in.

    Gates the single-word merge: 'אבוקדו' priced per kilo in four chains is one
    product, while a one-word packaged name (a bare brand like 'DOVE 150 מ"ל')
    could be any of that brand's items and must not collapse.
    """
    return bool(unit_sig) and (unit_sig[0] == "unit" or
                               (unit_sig[0] == "g" and unit_sig[1] >= 1000))


def consolidate_by_name(products):
    """Merge products whose names carry the same token signature.

    This is the cross-chain consolidation model: the same product listed under
    different barcodes / word orders per chain ("חלב תנובה 3%" vs "3% חלב
    תנובה") becomes one entry. Safety rule: a group merges only when no two
    members are priced in the same chain — same-chain twins are genuinely
    different SKUs. Original keys are kept as aliases so saved lists survive.
    """
    by_bucket = {}
    for key, prod in products.items():
        sig = name_signature(prod["n"])
        if not sig:
            continue
        usig = unit_signature(prod.get("u"))
        if len(sig.split()) < 2 and not _is_loose_produce_unit(usig):
            continue                      # weak one-word key on a packaged item
        # Size is part of identity: two chains listing "עגבניות שרי" at 460g and
        # at 1kg are different products, so only same-size entries share a
        # bucket. An unreadable unit buckets on its own raw text rather than
        # merging blind.
        by_bucket.setdefault((sig, usig or ("?", prod.get("u") or "")), []).append(key)

    merged = dict(products)
    for (sig, usig), keys in by_bucket.items():
        if len(keys) < 2:
            continue
        # the size is part of the bucket, so it has to be part of the key too —
        # otherwise the 400g and the 700g bucket of one name overwrite each other
        merged_key = "n:{}|{}{}".format(sig, usig[0], usig[1])

        # A chain listing this name+size twice has two genuinely different SKUs
        # (same name, same size, different price happens across the catalogue),
        # so we cannot pick one to stand for that chain. Drop only the contested
        # chains and merge what is left: one retailer's duplicate row must not
        # cost every OTHER retailer its merge, which is what refusing the whole
        # bucket used to do.
        per_chain = {}
        for k in keys:
            for chain in products[k]["p"]:
                per_chain[chain] = per_chain.get(chain, 0) + 1
        contested = {c for c, n in per_chain.items() if n > 1}
        if contested:
            keys = [k for k in keys if not (set(products[k]["p"]) & contested)]
            if len(keys) < 2:
                continue
        members = [products[k] for k in keys]
        combined = {
            "n": max((m["n"] for m in members), key=len),
            "u": next((m["u"] for m in members if m["u"]), ""),
            "b": next((m["b"] for m in members if m["b"]), ""),
            "p": {c: p for m in members for c, p in m["p"].items()},
            "aliases": sorted(keys),
        }
        for k in keys:
            merged.pop(k, None)
        merged[merged_key] = combined
    return merged


def _promo_flags(promo):
    flags = 0
    if promo.get("club") in ("1", 1, True):
        flags |= PROMO_CLUB
    if promo.get("is_coupon") in ("1", 1, True):
        flags |= PROMO_COUPON
    try:
        if float(promo.get("min_qty") or 0) > 1:
            flags |= PROMO_CONDITIONAL
    except ValueError:
        pass
    return flags


def _promo_min_qty(promo):
    try:
        return max(1, int(float(promo.get("min_qty") or 1)))
    except ValueError:
        return 1


_DEAL_DESC_RE = re.compile(r"\d+\s*ב\s*-?\s*(\d+(?:\.\d+)?)")


def _unit_promo_price(raw, min_qty, desc, base):
    """Normalize a promo price to PER-UNIT at the promo quantity.

    Empirically (checked across all 6 chains' 2026-08 files) DiscountedPrice
    for min-qty deals is the TOTAL for min_qty units: descriptions "N ב־X"
    always carry X == DiscountedPrice, and the value usually exceeds the unit
    base price. Rules, most reliable first:
    1. description "N ב־X" with X == raw  -> total  -> raw / min_qty
    2. raw > base unit price              -> must be a total -> raw / min_qty
    3. otherwise ambiguous                -> None (badge only, never a wrong price)
    """
    if raw is None or min_qty <= 1:
        return raw
    m = _DEAL_DESC_RE.search(desc or "")
    if m and abs(float(m.group(1)) - raw) < 0.05:
        return round(raw / min_qty, 2)
    if base is not None and raw > base + 0.01:
        return round(raw / min_qty, 2)
    return None


def attach_promos(promo_rows, date="", base_lookup=None):
    """Index promos by product key and pick one promo per (product, chain).

    Preference order: promos usable in totals (a real per-unit price, no club/
    coupon restriction — min-qty deals included, the client does the bundle
    math), then restricted promos with a price, then badge-only.
    Returns {product_key: {chain: [unit_price|None, desc, flags, min_qty]}}.
    """
    base_lookup = base_lookup or {}
    by_key = {}
    for r in promo_rows:
        chain = r.get("chain", "")
        desc = clean_name(r.get("description", ""))[:80]
        if not chain or not desc:
            continue
        end = (r.get("end_date") or "").strip()
        if end and date and end < date:
            continue                      # expired
        key = barcode_key(r.get("barcode"))
        if key is None:
            key = f"{chain}:{(r.get('barcode') or '').strip()}"
        min_qty = _promo_min_qty(r)
        price = _unit_promo_price(_parse_price(r.get("discounted_price")),
                                  min_qty, desc, base_lookup.get((key, chain)))
        flags = _promo_flags(r)
        cur = by_key.setdefault(key, {}).get(chain)
        cand = [price, desc, flags, min_qty]
        if cur is None or _promo_rank(cand) < _promo_rank(cur):
            by_key[key][chain] = cand
    return by_key


def _promo_rank(promo):
    """Lower is better: usable-in-totals < restricted-with-price < badge-only."""
    price, _desc, flags, _min_qty = promo
    restricted = flags & (PROMO_CLUB | PROMO_COUPON)
    if price is not None and not restricted:
        return (0, price)
    if price is not None:
        return (1, price)
    return (2, 0)


def build_site_data(rows, date="", promo_rows=None):
    """Aggregate snapshot rows into the site's JSON structure.

    Products sharing a real barcode merge across chains; internal codes stay
    scoped to their chain; a second pass merges same-name-signature products
    (see consolidate_by_name). Duplicate (product, chain) rows keep the lowest
    price. The longest cleaned name wins (files often truncate names).
    """
    chains = []          # first-appearance order (snapshot is written per-chain)
    products = {}        # key -> {"n": name, "u": unit, "b": brand, "p": {chain: price}}
    for r in rows:
        chain = r.get("chain", "")
        name = strip_chain_name(r.get("item_name", ""), chain)
        price = _parse_price(r.get("price"))
        if not chain or not name or price is None:
            continue
        if chain not in chains:
            chains.append(chain)
        key = barcode_key(r.get("barcode"))
        if key is None:
            key = f"{chain}:{(r.get('barcode') or '').strip() or name}"
        prod = products.setdefault(key, {"n": name, "u": "", "b": "", "p": {}})
        if len(name) > len(prod["n"]):
            prod["n"] = name
        if not prod["u"]:
            prod["u"] = format_unit(r.get("quantity"), r.get("unit_qty"),
                                    r.get("unit_of_measure"))
        if not prod["b"]:
            prod["b"] = clean_name(r.get("manufacturer", "")) if r.get("manufacturer") else ""
        prev = prod["p"].get(chain)
        if prev is None or price < prev:
            prod["p"][chain] = price

    products = consolidate_by_name(products)

    # base unit prices per (key, chain) — promo keys may be pre-merge aliases
    base_lookup = {}
    for key, prod in products.items():
        for src in [key] + prod.get("aliases", []):
            for c, p in prod["p"].items():
                base_lookup[(src, c)] = p

    promos_by_key = attach_promos(promo_rows or [], date=date, base_lookup=base_lookup)

    def _promos_for(key, prod, chain_list):
        """Per-chain promo array for a product, resolving merged aliases."""
        sources = [key] + prod.get("aliases", [])
        per_chain = {}
        for src in sources:
            for c, promo in promos_by_key.get(src, {}).items():
                if c not in per_chain or _promo_rank(promo) < _promo_rank(per_chain[c]):
                    per_chain[c] = promo
        if not per_chain:
            return None
        return [per_chain.get(c) for c in chain_list]

    out_products = []
    for key, prod in sorted(products.items(), key=lambda kv: kv[1]["n"]):
        entry = [key, prod["n"], prod["u"], prod["b"],
                 [prod["p"].get(c) for c in chains],
                 prod.get("aliases") or None,
                 _promos_for(key, prod, chains),
                 classify_category(prod["n"])]
        out_products.append(entry)
    return {
        "date": date,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "chains": chains,
        "categories": CATEGORIES,
        "products": out_products,
    }


def write_site_data(data, out_path=SITE_DATA_PATH):
    """Write the dataset as gzipped JSON (or plain JSON without a .gz suffix)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False,
                         separators=(",", ":")).encode("utf-8")
    if out_path.endswith(".gz"):
        with open(out_path, "wb") as fh:
            fh.write(gzip.compress(payload, mtime=0))
    else:
        with open(out_path, "wb") as fh:
            fh.write(payload)
    return len(payload)
