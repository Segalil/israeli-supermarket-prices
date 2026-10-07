# -*- coding: utf-8 -*-
"""Static, crawlable price pages generated at deploy time.

The app is a hash-routed SPA that decodes a gzipped JSON in the browser, so
crawlers and AI answer engines that do not run JavaScript never see a single
price. This module writes plain HTML pages with real, dated, sourced shelf
prices under the site directory:

    /prices/                         daily hub
    /prices/category/<slug>/         one page per category (1..10)
    /prices/p/<barcode>/             one page per selected product
    /en/                             English summary
    /sitemap-prices.xml              every generated URL with its lastmod

Content rules (enforced by tests/test_static_pages.py): chains always appear in
the fixed order of the dataset, no chain is ever crowned, no table is sorted by
price, every number comes from the data, and every page carries the snapshot
date, the official source and the no-affiliation line.

Selection is stateless hysteresis recomputed from data/ on every run: a
barcode ENTERS when it was priced in >= MIN_ENTER_CHAINS chains on >= 3
snapshot days within the last 180 days, and is KEPT while today's file prices
it cleanly in >= 2 chains. So a page does not flicker away the day one chain
drops it, but a product that genuinely left the market does fall out.

Stdlib only — the Pages build installs nothing.
"""
import csv
import glob
import gzip
import html
import io
import json
import os
import re
import shutil
import statistics
from collections import Counter, defaultdict
from datetime import date as _date, timedelta

from .basket import (
    CATEGORIES,
    HEB_TO_COL,
    PROMO_CLUB,
    PROMO_COUPON,
    PROMO_HEB_TO_COL,
    attach_promos,
    barcode_key,
    snapshot_date,
    unit_signature,
)

BASE = "https://slim-super.com"
GOV_URL = "https://www.gov.il/he/pages/cpfta_prices_regulations"
ORG_ID = BASE + "/#org"
SITE_ID = BASE + "/#site"

# One-switch rollback: GitHub Pages cannot answer 410, so to withdraw the pages
# from search set this to True — every page gets "noindex, follow" and the
# sitemap is written empty.
STATIC_PAGES_NOINDEX = False

MIN_ENTER_CHAINS = 5        # chains a barcode needs on an entry day
ENTER_MIN_DAYS = 3          # entry days needed ...
ENTER_WINDOW_DAYS = 180     # ... within this many days
KEEP_MIN_CHAINS = 2         # clean prices today needed to keep a page
CLEAN_LOW, CLEAN_HIGH = 0.5, 2.0   # vs the median of the OTHER chains
HISTORY_DAYS = 30           # the per-chain range table
CHANGES_CAP = 30            # products listed under "changed since last update"
RELATED_MAX = 8
ITEMLIST_MAX = 100
PARTIAL_FILE_RATIO = 0.8    # today's rows vs the median of the last 7 files

CATEGORY_SLUGS = {1: "produce", 2: "dairy", 3: "meat-fish", 4: "bakery",
                  5: "pantry", 6: "snacks", 7: "drinks", 8: "frozen",
                  9: "cleaning", 10: "toiletries"}

# The chains the project follows, in the order the hub lists missing ones.
FIXED_CHAINS = ["שופרסל", "רמי לוי", "ויקטורי", "יינות ביתן / קרפור",
                "יוחננוף", "אושר עד", "חצי חינם"]
ONLINE, BRANCH = "online", "branch"
STORE_TYPES = {"שופרסל": ONLINE, "רמי לוי": ONLINE, "יינות ביתן / קרפור": ONLINE,
               "ויקטורי": ONLINE, "חצי חינם": ONLINE,
               "יוחננוף": BRANCH, "אושר עד": BRANCH}
STORE_TYPE_HE = {ONLINE: "אונליין", BRANCH: "סניף"}
STORE_TYPE_HE_LONG = {ONLINE: "חנות אונליין", BRANCH: "סניף מייצג"}
STORE_TYPE_EN = {ONLINE: "online store", BRANCH: "representative branch"}
CHAIN_EN = {"שופרסל": "Shufersal", "רמי לוי": "Rami Levy",
            "יינות ביתן / קרפור": "Yeinot Bitan / Carrefour", "ויקטורי": "Victory",
            "חצי חינם": "Hatzi Hinam", "יוחננוף": "Yochananof", "אושר עד": "Osher Ad"}

# English page staples: well-known barcodes measured to be priced in every
# chain of the 2026-10 files. A staple missing from today's pages is skipped.
EN_STAPLES = {
    "7290004131074": "Tnuva milk 3% fat, 1 L carton",
    "7290000056845": "Tnuva milk 3% fat, 1.5 L carton",
    "7290004127329": "Tnuva cottage cheese 5%, 250 g",
    "7290000048185": "Tnuva soft white cheese 5%, 250 g",
    "7290116932033": "Tnuva butter, 200 g",
    "7290018500361": "Standard sliced bread, 900 g",
    "7290000066318": "Osem Bamba peanut snack, 80 g",
    "7290000066141": "Osem Bissli grill flavour, 70 g",
    "7290000074184": "Osem Petit Beurre biscuits, 500 g",
    "8076800195057": "Barilla spaghetti No. 5, 500 g",
    "7290000060880": "Osem spaghetti No. 8, 500 g",
    "7290000060200": "Osem baked ptitim (couscous shape), 500 g",
    "7290000211442": "Sugat Persian rice, 1 kg",
    "7290000144474": "Etz HaZait canola oil, 1 L",
    "7290106577282": "Tzabar tahini, 400 g",
    "7290000072623": "Osem ketchup squeeze bottle, 750 g",
    "7290000111186": "Telma real mayonnaise, 500 g",
    "8000500426494": "Nutella hazelnut spread, 350 g",
    "7290000176420": "Elite instant coffee, 200 g",
    "7290000176079": "Elite Turkish coffee with cardamom, 100 g",
    "7290013585394": "Coca-Cola, 1 L bottle",
    "7290000136141": "Pepsi, 1.5 L bottle",
    "7290110114855": "Neviot mineral water, 6 x 1.5 L",
}

# --- content filters --------------------------------------------------------
# Whole-word matching on normalised tokens (quotes/geresh removed, lowercased),
# so "יין" never hits "מעיין" and "בירה" never hits "גבירה". Multi-word
# entries match as consecutive tokens.
# "סיגר"/"סיגרים" are left out on purpose: in a supermarket they are filled
# pastries ("סיגרים במילוי בשר", "עלי סיגר").
TOBACCO_WORDS = ("סיגריות", "סיגריה", "טבק", "סיגריליות",
                 "סיגרילוס", "נרגילה", "נרגילות", "מלבורו", "מרלבורו", "וינסטון",
                 "נובלס", "פרלמנט", "דובק", "פיליפ מוריס", "אייקוס", "iqos",
                 "heets", "הייטס", "ניירות גלגול", "טבק לגלגול")
INFANT_FORMULA_WORDS = ("תמ\"ל", "תמל", "מטרנה", "סימילאק", "סימילק", "נוטרילון",
                        "אפטמיל", "נוטרימיגן", "אנפמיל", "רמדיה", "תחליף חלב אם",
                        "פורמולת תינוקות")
PSEUDO_ITEM_WORDS = ("פיקדון", "פקדון", "דמי משלוח", "משלוח", "שקית קניות",
                     "שקית נשיאה", "שקית ניילון", "שקית רב פעמית", "שקיות קניות")
PSEUDO_ITEM_EXACT = ("שקית", "שקיות")      # a name that is ONLY a bag
ALCOHOL_WORDS = ("יין", "בירה", "בירות", "וודקה", "ודקה", "וויסקי", "ויסקי",
                 "ערק", "ליקר", "ג'ין", "רום", "טקילה", "קאווה", "שמפניה",
                 "קוניאק", "ברנדי", "מרטיני", "סאקה", "אלכוהול", "פרוסקו",
                 "למברוסקו", "מוסקטו", "שרדונה", "סוביניון", "קברנה", "יקב",
                 "יקבי", "אפרול", "קמפרי")

# Strings no generated file may contain (tests scan every file for them).
BANNED_HE = ("הכי זול", "הזול ביותר", "הזולה", "זול ביותר", "המשתלם")
BANNED_EN = ("cheapest", "best price", "best", "lowest")
BANNED_META = ("github", "open source", "open-source", "il-supermarket-scraper",
               "scraper", "repository", "קוד פתוח")
BANNED_ALL = BANNED_HE + BANNED_EN + BANNED_META

NO_AFFILIATION_HE = ("סלים אינו קשור לרשתות ואינו מייצג אותן; "
                     "שמות הרשתות מוזכרים לצורך זיהוי בלבד.")
NO_AFFILIATION_EN = ("Slim is not affiliated with the chains and does not "
                     "represent them; chain names are used for identification only.")

_UNKNOWN_BRANDS = {"", "לא ידוע", "לא-ידוע", "כללי", "unknown"}

_QUOTES_RE = re.compile(r"['\"׳״`]")
_TOKEN_SPLIT_RE = re.compile(r"[^\w%]+", re.UNICODE)


def name_tokens(text):
    """Lowercased word tokens with quotes/geresh removed ('תמ"ל' -> 'תמל')."""
    return [t for t in _TOKEN_SPLIT_RE.split(_QUOTES_RE.sub("", (text or "").lower())) if t]


def _norm_terms(words):
    return tuple(" ".join(name_tokens(w)) for w in words if name_tokens(w))


_TOBACCO = _norm_terms(TOBACCO_WORDS)
_INFANT = _norm_terms(INFANT_FORMULA_WORDS)
_PSEUDO = _norm_terms(PSEUDO_ITEM_WORDS)
_ALCOHOL = _norm_terms(ALCOHOL_WORDS)


def _has_term(text, terms):
    padded = " " + " ".join(name_tokens(text)) + " "
    return any(" " + t + " " in padded for t in terms)


def has_banned_text(text):
    low = (text or "").lower()
    return any(b in low for b in BANNED_ALL)


NOT_TOBACCO_PHRASES = ("אנטי טבק", "נגד טבק", "ריח טבק")   # air fresheners
_NOT_TOBACCO = _norm_terms(NOT_TOBACCO_PHRASES)


def _is_tobacco(text):
    padded = " " + " ".join(name_tokens(text)) + " "
    for phrase in _NOT_TOBACCO:
        padded = padded.replace(" " + phrase + " ", " ")
    return any(" " + t + " " in padded for t in _TOBACCO)


def exclusion_reason(name, brand=""):
    """Why a product gets no page at all, or None."""
    both = (name or "") + " " + (brand or "")
    if _is_tobacco(both):
        return "tobacco"
    if _has_term(both, _INFANT):
        return "infant_formula"
    toks = name_tokens(name)
    if _has_term(name, _PSEUDO) or (toks and all(t in PSEUDO_ITEM_EXACT for t in toks)):
        return "pseudo_item"
    if has_banned_text(name) or has_banned_text(brand):
        return "banned_term"
    return None


def is_alcohol(name, brand=""):
    return _has_term((name or "") + " " + (brand or ""), _ALCOHOL)


# --- small formatting helpers ------------------------------------------------
_HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי",
              "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
_EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December"]


def _ymd(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return y, m, d


def date_he(iso):
    y, m, d = _ymd(iso)
    return f"{d} ב{_HE_MONTHS[m - 1]} {y}"


def date_he_short(iso):
    y, m, d = _ymd(iso)
    return f"{d}.{m}.{y}"


def date_en(iso):
    y, m, d = _ymd(iso)
    return f"{_EN_MONTHS[m - 1]} {d}, {y}"


def fmt_price(p):
    return f"{p:.2f}"


def esc(s):
    """Text-node escape (quotes stay readable: 1 ל' / בד"צ)."""
    return html.escape(str(s), quote=False)


def attr(s):
    """Attribute-value escape (always used inside double quotes)."""
    return html.escape(str(s), quote=False).replace('"', "&quot;")


def num(text):
    """Digits isolated left-to-right inside RTL text (ranges, codes, prices).
    A dir attribute makes the UA isolate the span (unicode-bidi: isolate)."""
    return f'<span dir="ltr">{text}</span>'


def shekel(p):
    """A single price. In RTL text the logical order "7.35 ₪" already renders
    the way Hebrew prints prices, so only ranges need an LTR isolate."""
    return f"{fmt_price(p)} ₪"


def price_range(lo, hi):
    if abs(lo - hi) < 0.005:
        return shekel(lo)
    return num(f"{fmt_price(lo)}–{fmt_price(hi)} ₪")


def time_tag(iso, text):
    return f'<time datetime="{iso}">{esc(text)}</time>'


def fmt_int(n):
    return f"{n:,}"


def gtin13(key):
    """Zero-padded GTIN-13 for a barcode key, only if its check digit is valid."""
    if not key or not key.isdigit() or len(key) > 13:
        return None
    s = key.zfill(13)
    digits = [int(c) for c in s]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
    return s if (10 - total % 10) % 10 == digits[12] else None


def chain_store_type(chain):
    return STORE_TYPES.get(chain)


def per_measure(price, unit):
    """(value, label) of the shelf price per kg / liter / unit, or None."""
    sig = unit_signature(unit)
    if not sig or not price:
        return None
    kind, amount = sig
    if amount <= 0 or (kind == "unit" and amount <= 1):
        return None                     # per-piece: would just repeat the price
    if kind == "g":
        return price / amount * 1000.0, "לק״ג"
    if kind == "ml":
        return price / amount * 1000.0, "לליטר"
    return price / amount, "ליחידה"


def is_single_unit(unit):
    """True for the '1 יחידות' pseudo-size: sold per piece, no pack size."""
    sig = unit_signature(unit)
    return bool(sig) and sig[0] == "unit" and sig[1] <= 1


def name_with_size(name, unit):
    """Name plus pack size — unless the name already carries a number (the
    files often print the size in the name, sometimes a different one than the
    size field) or the size is just '1 יחידות'."""
    if not unit or re.search(r"\d", name or "") or is_single_unit(unit):
        return name
    return f"{name} {unit}"


def _trim_words(text, limit):
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,·-–—") + "…"


DESC_MIN, DESC_MAX = 110, 185


def fit_description(core, pads):
    """A meta description of DESC_MIN..DESC_MAX chars: core, padded with
    factual phrases while short, trimmed at a word boundary when long."""
    text = core.strip()
    for pad in pads:
        if len(text) >= DESC_MIN:
            break
        if len(text) + 1 + len(pad) <= DESC_MAX:
            text = f"{text} {pad}"
    if len(text) > DESC_MAX:
        text = _trim_words(text, DESC_MAX)
    return text


# --- reading the data --------------------------------------------------------
def load_products_json(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _csv_reader(path, header_map):
    """(csv.reader, internal column names) for a snapshot CSV (.csv / .csv.gz)."""
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig")))
    header = next(reader, None) or []
    return reader, [header_map.get(h.strip(), h.strip()) for h in header]


class _KeyMemo(dict):
    """barcode string -> barcode_key(), memoised (the same EANs recur daily)."""

    def __missing__(self, barcode):
        key = self[barcode] = barcode_key(barcode)
        return key


_PROMO_COLS = ("chain", "barcode", "description", "end_date", "min_qty",
               "discounted_price", "club", "is_coupon")


def _snapshot_paths(data_dir, kind):
    out = {}
    for p in glob.glob(os.path.join(data_dir, f"israeli_{kind}_*.csv*")):
        d = snapshot_date(p)
        if d:
            out[d] = max(out.get(d, p), p)
    return out


def load_price_history(data_dir, today, candidates, window_days=ENTER_WINDOW_DAYS,
                       min_enter=MIN_ENTER_CHAINS):
    """Read every price snapshot within the window once.

    Returns {"dates": [...ascending], "enter_counts": {date: {key: n_chains}}
    (only keys at >= min_enter), "prices": {date: {key: {chain: min price}}}
    (candidate keys only; the lowest row per chain, as build_site_data does),
    "rows": {date: Counter(chain)}}. A row counts toward a key's chains when it
    has a parseable price > 0.
    """
    start = (_date.fromisoformat(today) - timedelta(days=window_days)).isoformat()
    paths = _snapshot_paths(data_dir, "prices")
    memo = _KeyMemo()
    hist = {"dates": [], "enter_counts": {}, "prices": {}, "rows": {}, "promos": {}}
    for d in sorted(paths):
        if d <= start or d > today:
            continue
        reader, names = _csv_reader(paths[d], HEB_TO_COL)
        try:
            ci, bi, pi = (names.index(c) for c in ("chain", "barcode", "price"))
        except ValueError:
            continue                      # not a price snapshot we understand
        need = max(ci, bi, pi)
        chains_by_key = defaultdict(set)
        prices = defaultdict(dict)
        rows = Counter()
        for rec in reader:
            if len(rec) <= need:
                continue
            chain = rec[ci].strip()
            if not chain:
                continue
            rows[chain] += 1
            try:
                p = round(float(rec[pi]), 2)
            except ValueError:
                continue
            if not p > 0:
                continue
            key = memo[rec[bi]]
            if key is None:
                continue
            chains_by_key[key].add(chain)
            if key in candidates:
                cur = prices[key]
                prev = cur.get(chain)
                if prev is None or p < prev:
                    cur[chain] = p
        hist["dates"].append(d)
        hist["enter_counts"][d] = {k: len(s) for k, s in chains_by_key.items()
                                   if len(s) >= min_enter}
        hist["prices"][d] = dict(prices)
        hist["rows"][d] = rows
    return hist


def load_promo_history(data_dir, dates, keys):
    """{date: [promo row dict] | None} for the given barcode keys (None: no
    promo snapshot that day)."""
    paths = _snapshot_paths(data_dir, "promos")
    memo = _KeyMemo()
    out = {}
    for d in dates:
        if d not in paths:
            out[d] = None
            continue
        reader, names = _csv_reader(paths[d], PROMO_HEB_TO_COL)
        if "barcode" not in names:
            out[d] = None
            continue
        bi = names.index("barcode")
        idx = [names.index(c) if c in names else None for c in _PROMO_COLS]
        rows = []
        for rec in reader:
            if len(rec) <= bi or memo[rec[bi]] not in keys:
                continue
            n = len(rec)
            rows.append({c: (rec[i].strip() if i is not None and i < n else "")
                         for c, i in zip(_PROMO_COLS, idx)})
        out[d] = rows
    return out


# --- selection ----------------------------------------------------------------
def clean_prices(prices):
    """{chain: price} -> the subset within CLEAN_LOW..CLEAN_HIGH x the median
    of the OTHER chains' prices. A price with nothing to compare against is
    not shown."""
    out = {}
    for c, p in prices.items():
        if p is None:
            continue
        others = [q for c2, q in prices.items() if c2 != c and q is not None]
        if not others:
            continue
        med = statistics.median(others)
        if CLEAN_LOW * med <= p <= CLEAN_HIGH * med:
            out[c] = p
    return out


def select_keys(enter_counts, today, today_clean_counts, min_enter=MIN_ENTER_CHAINS,
                min_days=ENTER_MIN_DAYS, window_days=ENTER_WINDOW_DAYS,
                keep_min=KEEP_MIN_CHAINS):
    """Stateless hysteresis over the snapshot history.

    enter_counts: {date: {key: chains priced that day}}; today_clean_counts:
    {key: chains with a CLEAN price in today's file}. Returns (entered, kept):
    entered = priced in >= min_enter chains on >= min_days days within the
    window; kept = entered keys still cleanly priced in >= keep_min chains.
    """
    start = (_date.fromisoformat(today) - timedelta(days=window_days)).isoformat()
    hits = Counter()
    for d, counts in enter_counts.items():
        if d <= start or d > today:
            continue
        for k, n in counts.items():
            if n >= min_enter:
                hits[k] += 1
    entered = {k for k, n in hits.items() if n >= min_days}
    kept = {k for k in entered if today_clean_counts.get(k, 0) >= keep_min}
    return entered, kept


# --- the page model -----------------------------------------------------------
def _promo_text(promo, shelf=None):
    """(desc, details) for a promo entry, or None. Details: the per-unit promo
    price (only when it is below the shelf price) and the conditions."""
    if not promo:
        return None
    price, desc, flags, min_qty = promo
    desc = (desc or "").strip(" *")
    if not desc or has_banned_text(desc):
        desc = "מבצע"
    details = []
    if price is not None and (shelf is None or price < shelf - 0.004):
        details.append(f"{shekel(price)} ליחידה")
    if min_qty and min_qty > 1:
        details.append(f"בקנייה של {int(min_qty)}")
    if flags & PROMO_CLUB:
        details.append("למועדון")
    if flags & PROMO_COUPON:
        details.append("בקופון")
    return desc, details


class Product:
    __slots__ = ("key", "name", "unit", "brand", "cat", "prices", "shown",
                 "promos", "alcohol", "lastmod", "changed", "history", "title_name")

    def url(self):
        return f"/prices/p/{self.key}/"


def today_candidates(data):
    """{key: (entry, clean {chain: price})} for barcode keys priced in at
    least KEEP_MIN_CHAINS chains in today's dataset."""
    chains = data["chains"]
    out = {}
    for entry in data["products"]:
        key = entry[0]
        if not key.isdigit():          # barcode keys only in this version
            continue
        prices = {c: p for c, p in zip(chains, entry[4]) if p is not None}
        if len(prices) >= KEEP_MIN_CHAINS:
            out[key] = (entry, clean_prices(prices))
    return out


def select_products(data, hist, cands):
    """Apply the hysteresis selection and the content exclusions.

    Returns ({key: Product}, stats Counter)."""
    chains = data["chains"]
    today = data["date"]
    clean_counts = {k: len(clean) for k, (_e, clean) in cands.items()}
    entered, kept = select_keys(hist["enter_counts"], today, clean_counts)
    in_today = {k for k in entered if k in cands}
    stats = Counter()
    stats["entered"] = len(entered)
    stats["entered_in_today_file"] = len(in_today)
    stats["kept"] = len(kept)
    stats["dropped_below_keep"] = len(in_today - kept)
    stats["entered_missing_today"] = len(entered) - len(in_today)

    products = {}
    for key in sorted(kept):
        entry, clean = cands[key]
        reason = exclusion_reason(entry[1], entry[3])
        if reason is None and has_banned_text(entry[2]):
            reason = "banned_term"
        if reason:
            stats["excluded_" + reason] += 1
            continue
        pr = Product()
        pr.key = key
        pr.name = entry[1]
        pr.unit = entry[2] or ""
        pr.title_name = name_with_size(pr.name, pr.unit)
        pr.brand = "" if (entry[3] or "").strip() in _UNKNOWN_BRANDS else entry[3].strip()
        pr.cat = entry[7] if len(entry) > 7 and isinstance(entry[7], int) else 0
        pr.prices = list(entry[4])
        pr.shown = [clean.get(c) for c in chains]
        pr.promos = list(entry[6]) if entry[6] else [None] * len(chains)
        pr.alcohol = is_alcohol(entry[1], entry[3])
        pr.history, pr.lastmod, pr.changed = [], today, False
        if pr.alcohol:
            stats["alcohol_no_promo_text"] += 1
        stats["outlier_prices_hidden"] += sum(
            1 for p, s in zip(pr.prices, pr.shown) if p is not None and s is None)
        products[key] = pr
    stats["product_pages"] = len(products)
    return products, stats


def _promo_descs_by_day(products, hist):
    """{date: {key: {chain: desc}}} as attach_promos would pick them that day
    (None: no promo snapshot that day)."""
    out = {}
    for d in hist["dates"]:
        rows = hist["promos"].get(d)
        if rows is None:
            out[d] = None
            continue
        base = {(k, c): p for k, cp in hist["prices"][d].items() if k in products
                for c, p in cp.items()}
        picked = attach_promos(rows, date=d, base_lookup=base)
        out[d] = {k: {c: v[1] for c, v in per.items()} for k, per in picked.items()}
    return out


def attach_history(products, chains, hist, today):
    """Per product: the 30-day range table and lastmod. Returns the hub's
    list of (key, [(chain, old, new)]) shelf-price changes since the previous
    snapshot, sorted by name, and that previous snapshot's date."""
    dates = [d for d in hist["dates"] if d <= today]
    promo_days = _promo_descs_by_day(products, hist)
    window_start = _hist_start(today)
    window = [d for d in dates if d >= window_start]
    prev_day = max((d for d in dates if d < today), default=None)
    order_base = list(chains) + [c for c in FIXED_CHAINS if c not in chains]

    for key, pr in products.items():
        shown_chains = [c for c, s in zip(chains, pr.shown) if s is not None]

        # 30-day per-chain ranges from raw rows, clean values only
        acc = defaultdict(list)
        for d in window:
            day = hist["prices"][d].get(key)
            if day:
                for c, p in clean_prices(day).items():
                    acc[c].append(p)
        order = order_base + sorted(c for c in acc if c not in order_base)
        pr.history = [(c, min(acc[c]), max(acc[c]), len(acc[c])) for c in order if acc.get(c)]

        # lastmod: newest snapshot on which a shown chain's shelf price or
        # promo description differs from the previous snapshot
        def state(d):
            day = hist["prices"][d].get(key, {})
            promos = None if pr.alcohol else promo_days.get(d)
            per = promos.get(key, {}) if promos is not None else None
            return [(day.get(c), per.get(c) if per is not None else None, per is not None)
                    for c in shown_chains]

        pr.lastmod, pr.changed = None, False
        cur = state(dates[-1]) if dates else None
        for i in range(len(dates) - 1, 0, -1):
            prev = state(dates[i - 1])
            if any(a[0] != b[0] or (a[2] and b[2] and a[1] != b[1])
                   for a, b in zip(cur, prev)):
                pr.lastmod, pr.changed = dates[i], True
                break
            cur = prev
        if pr.lastmod is None:
            # unchanged across all loaded history: the content dates from the
            # oldest snapshot that vouches for it (today when there is none)
            pr.lastmod = dates[0] if dates else today

    changes = []
    if prev_day:
        for key in sorted(products, key=lambda k: _sort_key(products[k])):
            pr = products[key]
            prev = clean_prices(hist["prices"][prev_day].get(key, {}))
            diffs = [(c, prev[c], s) for c, s in zip(chains, pr.shown)
                     if s is not None and c in prev and abs(prev[c] - s) > 0.004]
            if diffs:
                changes.append((key, diffs))
    return changes, prev_day


_FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def he_sort_key(text):
    """Collation-ish key for Hebrew names: Hebrew-initial names first, then
    Latin, then names starting with digits/symbols; final letters sort as
    their regular forms."""
    t = (text or "").strip()
    first = next((ch for ch in t if ch.isalpha()), "")
    lead = t[:1]
    if "\u05d0" <= lead <= "\u05ea":
        group = 0
    elif lead.isalpha():
        group = 1
    else:
        group = 2 if "\u05d0" <= first <= "\u05ea" or not first else 3
    return (group, t.translate(_FINALS).lower(), t)


def _sort_key(pr):
    """Stable sort key for products: name (he_sort_key), size, barcode."""
    return (he_sort_key(pr.name), pr.unit, pr.key)


# --- HTML shell ----------------------------------------------------------------
_BRAND_SVG = (
    '<svg viewBox="0 0 128 104" width="30" height="24" fill="none" aria-hidden="true">'
    '<path d="M46 12 L34 40" stroke="#35858e" stroke-width="6" stroke-linecap="round"/>'
    '<path d="M82 12 L94 40" stroke="#35858e" stroke-width="6" stroke-linecap="round"/>'
    '<path d="M46 12 H82" stroke="#35858e" stroke-width="6" stroke-linecap="round"/>'
    '<path d="M10 40 H118 L104 92 A6 6 0 0 1 98 96 H30 A6 6 0 0 1 24 92 Z" fill="#35858e"/>'
    '<path d="M6 40 H122" stroke="#256a73" stroke-width="9" stroke-linecap="round"/>'
    '<path d="M38 60 H90 M42 76 H86" stroke="#9fd0d6" stroke-width="5" stroke-linecap="round"/>'
    '</svg>')


def _json_ld(graph):
    payload = json.dumps({"@context": "https://schema.org", "@graph": graph},
                         ensure_ascii=False, separators=(",", ":"))
    return payload.replace("</", "<\\/")


def page_shell(*, lang, url, title, description, og_type, json_ld, crumbs, body,
               date_iso, noindex, after_main=""):
    he = lang == "he"
    robots = "noindex, follow" if noindex else "index, follow"
    full_url = BASE + url
    crumb_html = []
    for i, (label, href) in enumerate(crumbs):
        if href and i < len(crumbs) - 1:
            crumb_html.append(f'<a href="{href}">{esc(label)}</a>')
        else:
            crumb_html.append(f'<span aria-current="page">{esc(label)}</span>')
    year = date_iso[:4]
    if he:
        top_cta = '<a class="art-topbar-cta" href="/#/build">השוואת מחירים חינם ←</a>'
        skip = "דילוג לתוכן העיקרי"
        crumbs_label = "פירורי לחם"
        foot = (
            '<footer class="art-foot">'
            f'<p>{esc(NO_AFFILIATION_HE)}</p>'
            '<nav class="pr-foot-nav" aria-label="קישורים באתר"><a href="/">דף הבית</a> · '
            '<a href="/prices/">מחירים</a> · <a href="/articles/">מדריכים</a> · '
            '<a href="/about/">אודות והמתודולוגיה</a> · <a href="/privacy.html">פרטיות</a> · '
            '<a href="/en/" lang="en" hreflang="en">English</a></nav>'
            f'<p>© {year} סלים</p></footer>')
        locale = "he_IL"
    else:
        top_cta = '<a class="art-topbar-cta" href="/#/build">Open the free app →</a>'
        skip = "Skip to main content"
        crumbs_label = "Breadcrumbs"
        foot = (
            '<footer class="art-foot">'
            '<p>Prices come from the price-transparency files the chains publish by law. '
            'The price that binds is the one at the chain.</p>'
            f'<p>{esc(NO_AFFILIATION_EN)}</p>'
            f'<p lang="he" dir="rtl">{esc(NO_AFFILIATION_HE)}</p>'
            '<nav class="pr-foot-nav" aria-label="Site links"><a href="/">Home</a> · '
            '<a href="/prices/" hreflang="he">Prices (Hebrew)</a> · '
            '<a href="/articles/" hreflang="he">Guides (Hebrew)</a> · '
            '<a href="/about/">About &amp; methodology</a> · <a href="/privacy.html">Privacy</a></nav>'
            f'<p>© {year} Slim</p></footer>')
        locale = "en_US"
    head = (
        "<!doctype html>\n"
        f'<html lang="{lang}" dir="{"rtl" if he else "ltr"}">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{esc(title)}</title>\n"
        f'<meta name="description" content="{attr(description)}">\n'
        f'<link rel="canonical" href="{full_url}">\n'
        f'<meta name="robots" content="{robots}">\n'
        f'<meta property="og:type" content="{og_type}">\n'
        '<meta property="og:site_name" content="סלים">\n'
        f'<meta property="og:locale" content="{locale}">\n'
        f'<meta property="og:title" content="{attr(title)}">\n'
        f'<meta property="og:url" content="{full_url}">\n'
        '<meta name="twitter:card" content="summary">\n'
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Suez+One'
        '&family=Assistant:wght@400;600;700&display=swap">\n'
        '<link rel="stylesheet" href="/style.css">\n'
        '<link rel="stylesheet" href="/article.css">\n'
        f'<script type="application/ld+json">{_json_ld(json_ld)}</script>\n'
        "</head>\n")
    brand_label = "סלים — לעמוד הבית" if he else "Slim — home"
    return (
        head + "<body>\n"
        f'<a class="skip-link" href="#main">{skip}</a>\n'
        '<header class="art-topbar">'
        f'<a class="brand" href="/" aria-label="{brand_label}">{_BRAND_SVG}'
        '<span class="brand-name" dir="ltr">ליםSlim</span></a>'
        f"{top_cta}</header>\n"
        '<main id="main" class="art pr">\n'
        f'<nav class="art-crumbs" aria-label="{crumbs_label}">{" › ".join(crumb_html)}</nav>\n'
        f"{body}\n</main>\n{after_main}{foot}\n</body>\n</html>\n")


def source_block(date_iso, extra=""):
    """The date + source + methodology note every Hebrew page carries."""
    return (
        '<div class="art-note pr-src">'
        f"<p>המחירים בעמוד הם מחירי מדף כפי שפורסמו בקובצי המחירים של הרשתות לתאריך "
        f"{time_tag(date_iso, date_he(date_iso))} — לפני מבצעי מועדון וקופון ובלי דמי משלוח. "
        "המחיר המחייב הוא המחיר אצל הרשת.</p>"
        f'<p>המקור: <a href="{GOV_URL}">קובצי שקיפות המחירים שהרשתות מפרסמות לפי חוק</a> '
        '(תקנות שקיפות המחירים, חוק המזון). '
        '<a href="/about/">איך סלים אוסף ומציג את הנתונים</a>.'
        f"{extra}</p></div>")


def _crumb_ld(items):
    out = []
    for i, (name, url) in enumerate(items, 1):
        li = {"@type": "ListItem", "position": i, "name": name}
        if url:
            li["item"] = BASE + url
        out.append(li)
    return {"@type": "BreadcrumbList", "itemListElement": out}


def _webpage_ld(page_type, url, name, date_mod, lang="he-IL", extra=None):
    node = {"@type": page_type, "@id": BASE + url, "url": BASE + url, "name": name,
            "inLanguage": lang, "dateModified": date_mod,
            "isPartOf": {"@id": SITE_ID}, "publisher": {"@id": ORG_ID}}
    if extra:
        node.update(extra)
    return node


def _store_label(chain, long=False):
    t = chain_store_type(chain)
    if not t:
        return ""
    return (STORE_TYPE_HE_LONG if long else STORE_TYPE_HE)[t]


# --- product page ----------------------------------------------------------------
def render_product(pr, chains, data, products_by_cat, noindex):
    today = data["date"]
    cat_name = CATEGORIES[pr.cat] if 0 <= pr.cat < len(CATEGORIES) else ""
    cat_slug = CATEGORY_SLUGS.get(pr.cat)
    cat_url = f"/prices/category/{cat_slug}/" if cat_slug else None
    shown = [(c, s) for c, s in zip(chains, pr.shown) if s is not None]

    # <title>
    suffix = f" — {date_he_short(today)} | סלים"
    core = f"מחיר {pr.title_name} בחנויות הרשתות"
    if len(core) + len(suffix) > 72:
        core = f"מחיר {pr.title_name}"
    if len(core) + len(suffix) > 72:
        core = _trim_words(core, 72 - len(suffix))
    title = core + suffix

    # meta description: dated, fixed chain order, as many chains as fit
    head = f"מחירי המדף של {pr.title_name} לפי קבצי המחירים מ־{date_he_short(today)}: "
    tail = " (ללא מבצעים ומשלוח)."
    if len(head) > 120:
        head = f"מחירי המדף של {_trim_words(pr.title_name, 90)} לפי קבצי המחירים מ־{date_he_short(today)}: "
    parts = []
    for c, s in shown:
        cand = " · ".join(parts + [f"{c} {fmt_price(s)} ₪"])
        if len(head) + len(cand) + len(tail) > DESC_MAX:
            break
        parts.append(f"{c} {fmt_price(s)} ₪")
    if len(parts) < len(shown):
        tail = " ועוד" + tail
        while parts and len(head) + len(" · ".join(parts)) + len(tail) > DESC_MAX:
            parts.pop()
    description = fit_description(head + " · ".join(parts) + tail, (
        "מקור: קובצי שקיפות המחירים של הרשתות.",
        "המחיר המחייב הוא המחיר אצל הרשת.",
        "מחירי מדף לפני מבצעי מועדון וקופון."))

    # lede
    facts = []
    if pr.unit and not is_single_unit(pr.unit):
        facts.append(f"גודל: {esc(pr.unit)}")
    if pr.brand:
        facts.append(f"יצרן / מותג: {esc(pr.brand)}")
    facts.append(f"מק״ט / ברקוד: {num(pr.key)}")
    if cat_url:
        facts.append(f'קטגוריה: <a href="{cat_url}">{esc(cat_name)}</a>')

    # price table
    show_promo = not pr.alcohol
    show_measure = any(per_measure(s, pr.unit) for _c, s in shown)
    rows = []
    for i, c in enumerate(chains):
        label = _store_label(c)
        raw, s = pr.prices[i], pr.shown[i]
        cells = [f'<th scope="row">{esc(c)}</th>', f"<td>{esc(label)}</td>"]
        if s is not None:
            cells.append(f"<td>{shekel(s)}</td>")
            if show_measure:
                pm = per_measure(s, pr.unit)
                cells.append(f"<td>{fmt_price(pm[0])} ₪ {pm[1]}</td>" if pm else "<td>—</td>")
            if show_promo:
                pt = _promo_text(pr.promos[i] if i < len(pr.promos) else None, s)
                if pt:
                    desc, details = pt
                    det = f'<span class="pr-promo-det">{" · ".join(details)}</span>' if details else ""
                    cells.append(f'<td class="pr-promo">{esc(desc)}{det}</td>')
                else:
                    cells.append("<td>—</td>")
        else:
            note = ("לא נמצא בקובץ היום" if raw is None
                    else "המחיר בקובץ חריג מול שאר הרשתות ולכן אינו מוצג")
            span = 1 + show_measure + show_promo
            cells.append(f'<td class="pr-miss" colspan="{span}">{note}</td>')
        rows.append("<tr>" + "".join(cells) + "</tr>")
    heads = (["רשת", "סוג חנות", "מחיר מדף"] + (["מחיר ליחידת מידה"] if show_measure else [])
             + (["מבצע"] if show_promo else []))
    table = (
        '<div class="art-table-wrap"><table class="pr-table">'
        f"<caption>מחירי המדף של {esc(pr.name)} לפי רשת, "
        f"{time_tag(today, date_he(today))}</caption>"
        "<thead><tr>" + "".join(f'<th scope="col">{h}</th>' for h in heads) + "</tr></thead>"
        "<tbody>" + "".join(rows) + "</tbody></table></div>")
    notes = ["הרשתות מופיעות תמיד באותו סדר, לא לפי מחיר."]
    if show_measure:
        notes.append("המחיר ליחידת מידה מחושב מהכמות שהרשת רשמה בקובץ.")
    if show_promo:
        notes.append("בעמודת המבצע: מבצע אחד לכל רשת, כפי שפורסם בקובץ המבצעים.")
    measure_note = f'<p class="pr-fine">{" ".join(notes)}</p>'

    # 30-day history
    if pr.history:
        hist_rows = "".join(
            f'<tr><th scope="row">{esc(c)}</th><td>{price_range(lo, hi)}</td>'
            f"<td>{n}</td></tr>" for c, lo, hi, n in pr.history)
        hist_html = (
            '<h2 id="history">טווח מחירי המדף ב־30 הימים האחרונים</h2>'
            "<p>המחיר הנמוך והגבוה שנרשמו בקובצי המחירים היומיים של כל רשת, ובכמה ימים "
            "המוצר הופיע בקובץ.</p>"
            '<div class="art-table-wrap"><table>'
            f"<caption>טווח מחירי המדף לפי רשת, {time_tag(_hist_start(today), date_he(_hist_start(today)))}"
            f" עד {time_tag(today, date_he(today))}</caption>"
            '<thead><tr><th scope="col">רשת</th><th scope="col">טווח מחיר המדף</th>'
            '<th scope="col">ימים בקובץ</th></tr></thead>'
            f"<tbody>{hist_rows}</tbody></table></div>")
    else:
        hist_html = ""

    # related
    related = _related(pr, products_by_cat.get(pr.cat, []))
    rel_html = ""
    if related:
        rel_title = f"מוצרים נוספים בקטגוריה {esc(cat_name)}" if cat_url else "מוצרים נוספים"
        rel_html = (f'<h2 id="related">{rel_title}</h2><ul class="pr-related">' + "".join(
            f'<li><a href="{r.url()}">{esc(r.title_name)}</a></li>' for r in related) + "</ul>")

    updated = (f'<p class="art-meta">נתוני המחירים: {time_tag(today, date_he(today))}')
    if pr.changed and pr.lastmod != today:
        updated += f" · שינוי אחרון במחירים המוצגים: {time_tag(pr.lastmod, date_he(pr.lastmod))}"
    elif pr.changed:
        updated += " · המחירים המוצגים השתנו בעדכון הזה"
    updated += "</p>"

    body = (
        f"<article><h1>מחיר {esc(pr.name)}</h1>"
        f'<p class="art-lede">{" · ".join(facts)}</p>'
        f"{updated}"
        f"{source_block(today)}"
        f'<h2 id="prices">מחיר לפי רשת</h2>{table}{measure_note}'
        '<div class="art-cta"><p>רוצים לראות כמה עולה כל הרשימה שלכם בכל רשת, כולל מבצעים?</p>'
        f'<a class="btn-primary" href="/#/add/{pr.key}">הוספה לרשימה והשוואת הסל המלא ←</a></div>'
        f"{hist_html}{rel_html}</article>")

    crumbs = [("סלים", "/"), ("מחירים", "/prices/")]
    if cat_url:
        crumbs.append((cat_name, cat_url))
    crumbs.append((pr.name, None))
    product_ld = {"@type": "Product", "name": pr.title_name,
                  "sku": pr.key, "url": BASE + pr.url()}
    g = gtin13(pr.key)
    if g:
        product_ld["gtin13"] = g
    if pr.brand:
        product_ld["brand"] = {"@type": "Brand", "name": pr.brand}
    if cat_name and cat_url:
        product_ld["category"] = cat_name
    vals = [s for _, s in shown]
    product_ld["offers"] = {"@type": "AggregateOffer", "priceCurrency": "ILS",
                            "lowPrice": round(min(vals), 2), "highPrice": round(max(vals), 2),
                            "offerCount": len(vals)}
    ld = [_crumb_ld([(n, u) for n, u in crumbs[:-1]] + [(pr.name, None)]),
          _webpage_ld("WebPage", pr.url(), title, pr.lastmod),
          product_ld]
    return page_shell(lang="he", url=pr.url(), title=title, description=description,
                      og_type="website", json_ld=ld, crumbs=crumbs, body=body,
                      date_iso=today, noindex=noindex)


def _hist_start(today):
    return (_date.fromisoformat(today) - timedelta(days=HISTORY_DAYS - 1)).isoformat()


def _related(pr, siblings):
    """Up to RELATED_MAX neighbours by name order, deterministic."""
    if len(siblings) < 2:
        return []
    i = next((n for n, s in enumerate(siblings) if s.key == pr.key), None)
    if i is None:
        return []
    picked = []
    step = 1
    while len(picked) < RELATED_MAX and (i - step >= 0 or i + step < len(siblings)):
        for j in (i - step, i + step):
            if 0 <= j < len(siblings) and len(picked) < RELATED_MAX:
                picked.append(siblings[j])
        step += 1
    return sorted(picked, key=_sort_key)


# --- category page ----------------------------------------------------------------
def render_category(idx, items, chains, data, noindex):
    today = data["date"]
    name = CATEGORIES[idx]
    url = f"/prices/category/{CATEGORY_SLUGS[idx]}/"
    title = f"מחירי {name} ברשתות — {date_he_short(today)} | סלים"
    description = fit_description(
        f"מחירי המדף של {fmt_int(len(items))} מוצרים בקטגוריה {name} לפי קובצי המחירים "
        f"של הרשתות מ־{date_he_short(today)}: טווח מחיר וקישור למחיר בכל רשת.",
        ("מחירי מדף לפני מבצעים ובלי משלוח.", "מקור: קובצי שקיפות המחירים.",
         "המחיר המחייב הוא המחיר אצל הרשת."))
    rows = []
    for pr in items:
        vals = [s for s in pr.shown if s is not None]
        rows.append(
            f'<tr><th scope="row"><a href="{pr.url()}">{esc(pr.name)}</a></th>'
            f"<td>{esc(pr.unit) or '—'}</td><td>{len(vals)}</td>"
            f"<td>{price_range(min(vals), max(vals))}</td></tr>")
    body = (
        f"<h1>מחירי {esc(name)} ברשתות — {esc(date_he(today))}</h1>"
        f'<p class="art-lede">{num(fmt_int(len(items)))} מוצרים בקטגוריה {esc(name)} שנמכרים '
        "ברוב הרשתות, עם טווח מחירי המדף שלהם בקובצי המחירים של היום. "
        "לכל מוצר יש עמוד עם המחיר בכל רשת ועם טווח המחירים בחודש האחרון.</p>"
        f"{source_block(today)}"
        f'<h2 id="products">כל המוצרים בקטגוריה</h2>'
        '<div class="art-table-wrap"><table>'
        f"<caption>מוצרים בקטגוריה {esc(name)}, לפי סדר האלף־בית</caption>"
        '<thead><tr><th scope="col">מוצר</th><th scope="col">גודל</th>'
        '<th scope="col">רשתות עם מחיר</th><th scope="col">טווח מחירי מדף</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></div>'
        '<p class="pr-fine">הטבלה ממוינת לפי שם המוצר. הטווח כולל את מחירי המדף של '
        "הרשתות שבקובץ היום; מחיר שרחוק מאוד משאר הרשתות לא נכלל.</p>")
    crumbs = [("סלים", "/"), ("מחירים", "/prices/"), (name, None)]
    ld = [
        _webpage_ld("CollectionPage", url, title, today),
        _crumb_ld([("סלים", "/"), ("מחירים", "/prices/"), (name, None)]),
        {"@type": "ItemList", "name": f"מחירי {name}", "numberOfItems": len(items),
         "itemListElement": [{"@type": "ListItem", "position": i, "url": BASE + pr.url(),
                              "name": pr.title_name}
                             for i, pr in enumerate(items[:ITEMLIST_MAX], 1)]},
    ]
    return page_shell(lang="he", url=url, title=title, description=description,
                      og_type="website", json_ld=ld, crumbs=crumbs, body=body,
                      date_iso=today, noindex=noindex)


# --- hub ---------------------------------------------------------------------------
def hub_facts(data):
    chains = data["chains"]
    per_chain = [0] * len(chains)
    by_n = Counter()
    with_promo = 0
    for entry in data["products"]:
        n = 0
        for i, p in enumerate(entry[4]):
            if p is not None:
                per_chain[i] += 1
                n += 1
        by_n[min(n, 3)] += 1
        if entry[6] and any(entry[6]):
            with_promo += 1
    return {"total": len(data["products"]), "with_promo": with_promo,
            "by_n": by_n, "per_chain": per_chain}


def partial_chains(hist, chains, today):
    """Chains whose row count today is below PARTIAL_FILE_RATIO x the median
    of their previous 7 snapshots."""
    if today not in hist["rows"]:
        return []
    prev = [d for d in hist["dates"] if d < today][-7:]
    out = []
    for c in chains:
        counts = [hist["rows"][d][c] for d in prev if hist["rows"][d].get(c)]
        if counts and hist["rows"][today].get(c, 0) < PARTIAL_FILE_RATIO * statistics.median(counts):
            out.append(c)
    return out


def render_hub(products, by_cat, chains, data, hist, changes, prev_day, noindex):
    today = data["date"]
    url = "/prices/"
    facts = hub_facts(data)
    title = f"מחירי סופרמרקט ברשתות — עדכון {date_he_short(today)} | סלים"
    description = fit_description(
        f"מחירי המדף ב־{len(chains)} רשתות לפי קובצי שקיפות המחירים מ־{date_he_short(today)}: "
        f"{fmt_int(len(products))} עמודי מוצר, טבלאות לפי קטגוריה וטווח מחירים ב־30 הימים האחרונים.",
        ("המחיר המחייב הוא המחיר אצל הרשת.", "מחירי מדף לפני מבצעים ובלי משלוח."))

    chain_rows = "".join(
        f'<tr><th scope="row">{esc(c)}</th><td>{esc(_store_label(c, True))}</td>'
        f"<td>{num(fmt_int(facts['per_chain'][i]))}</td></tr>" for i, c in enumerate(chains))
    missing = [c for c in FIXED_CHAINS if c not in chains]
    missing_html = ""
    if missing:
        missing_html = "<ul>" + "".join(
            f"<li>{esc(c)} — לא נכללה בעדכון הזה</li>" for c in missing) + "</ul>"
    partial = partial_chains(hist, chains, today)
    partial_html = "".join(
        f'<p class="pr-warn">הקובץ של {esc(c)} לא נקלט במלואו היום.</p>' for c in partial)
    branch_chains = [c for c in chains if chain_store_type(c) == BRANCH]
    branch_note = ""
    if branch_chains:
        names = (", ".join(branch_chains[:-1]) + " ו" + branch_chains[-1]
                 if len(branch_chains) > 1 else branch_chains[0])
        branch_note = (f"<p>אצל {esc(names)} לא זוהתה חנות אונליין בקובץ החנויות, "
                       "ולכן המחירים שלהן לקוחים מסניף מייצג אחד.</p>")

    by_n = facts["by_n"]
    facts_html = (
        "<ul>"
        f"<li>{num(fmt_int(facts['total']))} מוצרים בקובצי המחירים של היום, אחרי איחוד של "
        "אותו מוצר בין הרשתות.</li>"
        f"<li>ל־{num(fmt_int(facts['with_promo']))} מהם יש לפחות מבצע אחד בתוקף בקובצי המבצעים.</li>"
        f"<li>{num(fmt_int(by_n[1]))} מוצרים מתומחרים ברשת אחת בלבד, {num(fmt_int(by_n[2]))} "
        f"בשתי רשתות ו־{num(fmt_int(by_n[3]))} בשלוש רשתות או יותר.</li>"
        f"<li>{num(fmt_int(len(products)))} מוצרים, שנמכרים ברוב הרשתות, מקבלים כאן עמוד מחיר "
        "משלהם.</li></ul>")

    cat_items = "".join(
        f'<li><a href="/prices/category/{CATEGORY_SLUGS[i]}/">{esc(CATEGORIES[i])}</a> — '
        f"{num(fmt_int(len(by_cat[i])))} מוצרים</li>"
        for i in sorted(CATEGORY_SLUGS) if by_cat.get(i))
    other = len(by_cat.get(0, []))
    if other:
        cat_items += f"<li>ללא קטגוריה — {num(fmt_int(other))} מוצרים (עמודי המוצר עצמם זמינים)</li>"

    changes_html = ""
    if prev_day:
        if changes:
            shown = changes[:CHANGES_CAP]
            rows = []
            for key, diffs in shown:
                pr = products[key]
                for c, old, new in diffs:
                    rows.append(f'<tr><th scope="row"><a href="{pr.url()}">{esc(pr.name)}</a></th>'
                                f"<td>{esc(c)}</td><td>{shekel(old)}</td><td>{shekel(new)}</td></tr>")
            more = ""
            if len(changes) > CHANGES_CAP:
                more = (f"<p>בסך הכול השתנה מחיר המדף של {num(fmt_int(len(changes)))} מוצרים "
                        f"מעמודי המחירים; מוצגים {num(CHANGES_CAP)} הראשונים לפי סדר האלף־בית.</p>")
            else:
                more = (f"<p>בסך הכול השתנה מחיר המדף של {num(fmt_int(len(changes)))} מוצרים "
                        "מעמודי המחירים.</p>")
            changes_html = (
                '<h2 id="changes">מוצרים שמחיר המדף שלהם השתנה מאז העדכון הקודם</h2>'
                f"<p>השוואה בין קובצי המחירים מ־{time_tag(prev_day, date_he(prev_day))} "
                f"ומ־{time_tag(today, date_he(today))}.</p>{more}"
                '<div class="art-table-wrap"><table>'
                "<caption>מחיר המדף בעדכון הקודם ובעדכון הנוכחי</caption>"
                '<thead><tr><th scope="col">מוצר</th><th scope="col">רשת</th>'
                f'<th scope="col">{esc(date_he_short(prev_day))}</th>'
                f'<th scope="col">{esc(date_he_short(today))}</th></tr></thead>'
                f'<tbody>{"".join(rows)}</tbody></table></div>')
        else:
            changes_html = (
                '<h2 id="changes">מוצרים שמחיר המדף שלהם השתנה מאז העדכון הקודם</h2>'
                f"<p>בין {time_tag(prev_day, date_he(prev_day))} ל־{time_tag(today, date_he(today))} "
                "לא השתנה מחיר המדף של אף מוצר מעמודי המחירים.</p>")

    body = (
        f"<h1>מחירי סופרמרקט בחנויות הרשתות — עדכון {esc(date_he(today))}</h1>"
        '<p class="art-lede">מחירי המדף של המוצרים הנפוצים ברשתות המזון, ישר מהקבצים '
        "שהרשתות מחויבות לפרסם מדי יום. כל מוצר מוצג עם המחיר בכל רשת, באותו סדר רשתות "
        "תמיד, ועם טווח המחירים שלו בחודש האחרון.</p>"
        f"{source_block(today)}"
        '<h2 id="chains">הרשתות בעדכון הזה</h2>'
        '<div class="art-table-wrap"><table>'
        f"<caption>רשתות בקובצי המחירים מ־{time_tag(today, date_he(today))}</caption>"
        '<thead><tr><th scope="col">רשת</th><th scope="col">סוג חנות</th>'
        '<th scope="col">מוצרים עם מחיר בקובץ</th></tr></thead>'
        f"<tbody>{chain_rows}</tbody></table></div>"
        f"{branch_note}{missing_html}{partial_html}"
        f'<h2 id="facts">מספרים מהעדכון</h2>{facts_html}'
        f'<h2 id="categories">מחירים לפי קטגוריה</h2><ul>{cat_items}</ul>'
        f"{changes_html}"
        '<h2 id="method">איך לקרוא את המחירים</h2>'
        "<p>עמוד מחיר נפתח למוצר שהופיע לפחות בשלושה ימים בקובצים של רוב הרשתות, ונשאר "
        "פתוח כל עוד יש לו מחיר בשתי רשתות לפחות. מחיר שרחוק מאוד מהמחירים של אותו מוצר "
        "ברשתות האחרות לא מוצג, כי לרוב מדובר בטעות בקובץ או ביחידת מידה אחרת. "
        '<a href="/about/">המתודולוגיה המלאה</a>.</p>'
        '<div class="art-cta"><p>מחיר של מוצר אחד הוא רק חלק מהתמונה: הסל כולו, המבצעים '
        "ודמי המשלוח קובעים כמה תשלמו.</p>"
        '<a class="btn-primary" href="/#/build">להשוואת הרשימה שלכם ←</a></div>')
    crumbs = [("סלים", "/"), ("מחירים", None)]
    dataset_desc = (
        f"מחירי המדף היומיים של {fmt_int(facts['total'])} מוצרים ב־{len(chains)} רשתות מזון "
        f"בישראל, מתוך קובצי שקיפות המחירים שהרשתות מפרסמות לפי חוק המזון, לתאריך {today}. "
        "המחירים הם לפני מבצעי מועדון וקופון ובלי דמי משלוח.")
    ld = [
        _webpage_ld("CollectionPage", url, title, today),
        _crumb_ld([("סלים", "/"), ("מחירים", None)]),
        {"@type": "Dataset", "name": f"מחירי סופרמרקט ברשתות — {today}",
         "description": dataset_desc, "url": BASE + url, "inLanguage": "he-IL",
         "creator": {"@id": ORG_ID}, "temporalCoverage": today,
         "spatialCoverage": "Israel", "isAccessibleForFree": True,
         "isBasedOn": GOV_URL, "dateModified": today},
    ]
    return page_shell(lang="he", url=url, title=title, description=description,
                      og_type="website", json_ld=ld, crumbs=crumbs, body=body,
                      date_iso=today, noindex=noindex)


# --- English page ------------------------------------------------------------------
def render_en(products, chains, data, noindex):
    today = data["date"]
    url = "/en/"
    title = f"Israeli supermarket prices, compared — {date_en(today)} | Slim"
    description = fit_description(
        f"Shelf prices from the official price files of {len(chains)} Israeli supermarket "
        f"chains for {date_en(today)}: staples per chain, the law behind the data, and the "
        "free Hebrew app Slim.",
        ("No signup.", "Prices before promotions and delivery."))
    chain_rows = "".join(
        f'<tr><th scope="row">{esc(CHAIN_EN.get(c, c))} <span lang="he" dir="rtl">({esc(c)})</span></th>'
        f"<td>{esc(STORE_TYPE_EN.get(chain_store_type(c), '—'))}</td></tr>" for c in chains)
    staples = [(b, en) for b, en in EN_STAPLES.items() if b in products]
    staples.sort(key=lambda be: (be[1].lower(), be[0]))
    rows = []
    for b, en in staples:
        pr = products[b]
        cells = "".join(f"<td>{fmt_price(s) if s is not None else '—'}</td>" for s in pr.shown)
        rows.append(f'<tr><th scope="row"><a href="{pr.url()}" hreflang="he">'
                    f'<span lang="he" dir="rtl">{esc(pr.name)}</span></a>'
                    f'<span class="pr-gloss">{esc(en)}</span></th>{cells}</tr>')
    chain_heads = "".join(f'<th scope="col">{esc(CHAIN_EN.get(c, c))}</th>' for c in chains)
    staples_html = ""
    if rows:
        staples_html = (
            '<h2 id="staples">Staple prices in today\'s files</h2>'
            f"<p>Shelf prices in shekels (₪) for {len(rows)} everyday products, as published "
            f"for {esc(date_en(today))}. Chains are always listed in the same order, not by price; "
            "a dash means no price is shown for that chain. Each product name links to its Hebrew "
            "price page with a 30-day range per chain.</p>"
            '<div class="art-table-wrap"><table>'
            f"<caption>Shelf prices (₪) by chain, {time_tag(today, date_en(today))}</caption>"
            f'<thead><tr><th scope="col">Product</th>{chain_heads}</tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></div>')
    missing = [c for c in FIXED_CHAINS if c not in chains]
    missing_html = ""
    if missing:
        missing_html = ("<p>Not included in this update: " + ", ".join(
            esc(CHAIN_EN.get(c, c)) for c in missing) + ".</p>")
    body = (
        f"<h1>Israeli supermarket prices, compared — official price-file data for "
        f"{esc(date_en(today))}</h1>"
        '<p class="art-lede">Slim (סלים) is a free Hebrew web app that prices one grocery list '
        "across the online stores of Israel's leading supermarket chains — including promotions "
        "and estimated delivery fees. No signup.</p>"
        f'<p class="art-meta">Data date: {time_tag(today, date_en(today))}</p>'
        '<div class="art-note pr-src"><p>These are shelf prices as published in the chains\' '
        f"price files for {time_tag(today, date_en(today))} — before club and coupon promotions, "
        "without delivery. The price that binds is the one at the chain. "
        f'Source: <a href="{GOV_URL}" hreflang="he">the price-transparency regulations '
        "(Israel's Food Act)</a>. "
        '<a href="/about/">How Slim collects and presents the data</a>.</p></div>'
        '<h2 id="law">Where the prices come from</h2>'
        "<p>Under Israel's Food Act price-transparency regulations, large grocery chains must "
        "publish their full price files — every product, every store — in a standard format, "
        "updated daily. Slim reads those files each day; the prices on this page are not "
        "estimated or typed in by hand.</p>"
        '<h2 id="chains">Chains in this update</h2>'
        '<div class="art-table-wrap"><table>'
        f"<caption>Chains in the price files of {time_tag(today, date_en(today))}</caption>"
        '<thead><tr><th scope="col">Chain</th><th scope="col">Store type</th></tr></thead>'
        f"<tbody>{chain_rows}</tbody></table></div>{missing_html}"
        "<p>Where a chain's stores file names no online store, its prices come from one "
        "representative branch.</p>"
        f"{staples_html}"
        '<h2 id="method">Methodology in short</h2>'
        "<ul><li>The same product is matched across chains by its barcode.</li>"
        "<li>A price far out of line with the same product's price at the other chains is not "
        "shown — it is usually a file error or a different unit.</li>"
        "<li>No totals and no rankings here: a basket's cost depends on the whole list, the "
        "promotions and the delivery fee, which is what the app works out.</li></ul>"
        '<p><a href="/">Open Slim</a> (Hebrew) · <a href="/prices/" hreflang="he">Daily price '
        'pages</a> (Hebrew) · <a href="/about/">About and methodology</a></p>')
    crumbs = [("Slim", "/"), ("English", None)]
    ld = [
        _webpage_ld("WebPage", url, title, today, lang="en"),
        _crumb_ld([("Slim", "/"), ("English", None)]),
    ]
    return page_shell(lang="en", url=url, title=title, description=description,
                      og_type="website", json_ld=ld, crumbs=crumbs, body=body,
                      date_iso=today, noindex=noindex)


# --- sitemap & orchestration ---------------------------------------------------------
def render_sitemap(entries, noindex):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    if not noindex:
        for url, lastmod in entries:
            lines.append(f"<url><loc>{html.escape(BASE + url)}</loc><lastmod>{lastmod}</lastmod></url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def _write(site_dir, url, content):
    rel = url.strip("/")
    path = os.path.join(site_dir, rel, "index.html") if not rel.endswith(".xml") \
        else os.path.join(site_dir, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = content.encode("utf-8")
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data)


class Model:
    """Everything the writers need: computed once, rendered any number of times."""

    def __init__(self, data, products, stats, hist, changes, prev_day):
        self.data, self.products, self.stats = data, products, stats
        self.hist, self.changes, self.prev_day = hist, changes, prev_day
        self.chains, self.date = data["chains"], data["date"]
        self.by_cat = defaultdict(list)
        for pr in products.values():
            self.by_cat[pr.cat].append(pr)
        for items in self.by_cat.values():
            items.sort(key=_sort_key)


def prepare(data_dir="data", products_path=os.path.join("site", "data", "products.json.gz")):
    """Read today's dataset and the snapshot history; select and annotate."""
    data = load_products_json(products_path)
    if not data.get("date"):
        raise ValueError(f"{products_path} carries no snapshot date")
    today = data["date"]
    cands = today_candidates(data)
    keepable = {k for k, (_e, clean) in cands.items() if len(clean) >= KEEP_MIN_CHAINS}
    hist = load_price_history(data_dir, today, keepable)
    products, stats = select_products(data, hist, cands)
    hist["promos"] = load_promo_history(data_dir, hist["dates"], set(products))
    changes, prev_day = attach_history(products, data["chains"], hist, today)
    stats["snapshot_days"] = len(hist["dates"])
    stats["changed_since_previous"] = len(changes)
    return Model(data, products, stats, hist, changes, prev_day)


def write_pages(model, site_dir="site", noindex=None):
    """Render and write every page plus the sitemap. Returns a stats dict."""
    noindex = STATIC_PAGES_NOINDEX if noindex is None else noindex
    m, today, chains = model, model.date, model.chains

    # fresh output: a product that left the selection must lose its page
    shutil.rmtree(os.path.join(site_dir, "prices"), ignore_errors=True)
    total_bytes = 0
    sitemap = [("/prices/", today)]
    total_bytes += _write(site_dir, "/prices/", render_hub(
        m.products, m.by_cat, chains, m.data, m.hist, m.changes, m.prev_day, noindex))
    n_cat = 0
    for idx in sorted(CATEGORY_SLUGS):
        if not m.by_cat.get(idx):
            continue
        url = f"/prices/category/{CATEGORY_SLUGS[idx]}/"
        total_bytes += _write(site_dir, url,
                              render_category(idx, m.by_cat[idx], chains, m.data, noindex))
        sitemap.append((url, today))
        n_cat += 1
    total_bytes += _write(site_dir, "/en/", render_en(m.products, chains, m.data, noindex))
    sitemap.append(("/en/", today))
    for key in sorted(m.products):
        pr = m.products[key]
        total_bytes += _write(site_dir, pr.url(),
                              render_product(pr, chains, m.data, m.by_cat, noindex))
        sitemap.append((pr.url(), pr.lastmod))
    total_bytes += _write(site_dir, "/sitemap-prices.xml", render_sitemap(sitemap, noindex))

    stats = dict(m.stats)
    stats["category_pages"] = n_cat
    stats["files"] = 1 + n_cat + 1 + len(m.products) + 1
    stats["bytes"] = total_bytes
    stats["date"] = today
    stats["noindex"] = bool(noindex)
    return stats


def generate(site_dir="site", data_dir="data", products_path=None, noindex=None):
    """prepare() + write_pages(): build every static price page."""
    products_path = products_path or os.path.join(site_dir, "data", "products.json.gz")
    return write_pages(prepare(data_dir, products_path), site_dir, noindex)
