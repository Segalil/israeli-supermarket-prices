# -*- coding: utf-8 -*-
"""Tests for the generated static price pages (israeli_prices/static_pages.py).

The generator runs once per session over the checked-in data/ snapshots into a
tmp dir; every content rule is then checked on every generated file: one h1
and no heading jumps, canonical == og:url == path, valid JSON-LD with the
required types, AggregateOffer == the visible prices, fixed chain order, no
crowning / no GitHub, the dated source block on every page, exclusions,
outlier hiding, the noindex switch, and byte-for-byte determinism.
"""
import glob
import gzip
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from israeli_prices import static_pages as sp  # noqa: E402
from israeli_prices.basket import (  # noqa: E402
    build_site_data,
    latest_snapshot,
    load_promo_rows,
    load_snapshot_rows,
    snapshot_date,
    write_site_data,
)

DATA = os.path.join(ROOT, "data")
BASE = sp.BASE
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def headings(html):
    return [(int(m.group(1)), re.sub(r"<[^>]+>", "", m.group(2)).strip())
            for m in re.finditer(r"(?is)<h([1-6])[^>]*>(.*?)</h\1>", html)]


def json_ld(html):
    return [json.loads(b) for b in
            re.findall(r'(?is)<script type="application/ld\+json">(.*?)</script>', html)]


def graph_types(html):
    return {node["@type"]: node for block in json_ld(html) for node in block["@graph"]}


def meta(html, attr, name):
    m = re.search(r'<meta %s="%s" content="([^"]*)">' % (attr, re.escape(name)), html)
    return m and m.group(1)


def unescape(s):
    import html as _h
    return _h.unescape(s)


# --- fixtures ------------------------------------------------------------------
@pytest.fixture(scope="session")
def products_path(tmp_path_factory):
    path = latest_snapshot(DATA)
    if not path:
        pytest.skip("no checked-in snapshot under data/")
    promos = latest_snapshot(DATA, kind="promos")
    data = build_site_data(load_snapshot_rows(path), date=snapshot_date(path),
                           promo_rows=load_promo_rows(promos) if promos else [])
    out = str(tmp_path_factory.mktemp("dataset") / "products.json.gz")
    write_site_data(data, out)
    return out


@pytest.fixture(scope="session")
def model(products_path):
    return sp.prepare(DATA, products_path)


@pytest.fixture(scope="session")
def site(model, tmp_path_factory):
    out = str(tmp_path_factory.mktemp("site"))
    stats = sp.write_pages(model, out, noindex=False)
    return {"dir": out, "stats": stats}


@pytest.fixture(scope="session")
def pages(site):
    """{url path: html} for every generated page."""
    out = {}
    for path in sorted(glob.glob(os.path.join(site["dir"], "**", "index.html"), recursive=True)):
        rel = os.path.relpath(os.path.dirname(path), site["dir"]).replace(os.sep, "/")
        out["/" + rel + "/"] = read(path)
    return out


def product_pages(pages):
    return {u: h for u, h in pages.items() if u.startswith("/prices/p/")}


def price_rows(html):
    """[(chain, visible shelf price | None, cell text)] from the price table."""
    table = re.search(r'(?s)<table class="pr-table">(.*?)</table>', html).group(1)
    rows = []
    for m in re.finditer(r'(?s)<tr><th scope="row">(.*?)</th><td>[^<]*</td>(.*?)</tr>', table):
        cell = m.group(2)
        pm = re.match(r"<td>(\d+\.\d\d) ₪</td>", cell)
        rows.append((unescape(m.group(1)), float(pm.group(1)) if pm else None, cell))
    return rows


# --- structure -------------------------------------------------------------------
def test_page_set_and_counts(site, pages, model):
    stats = site["stats"]
    assert "/prices/" in pages and "/en/" in pages
    cats = [u for u in pages if u.startswith("/prices/category/")]
    assert 1 <= len(cats) <= 10
    assert set(cats) <= {f"/prices/category/{s}/" for s in sp.CATEGORY_SLUGS.values()}
    prods = product_pages(pages)
    assert len(prods) == stats["product_pages"] == len(model.products)
    # with the default thresholds the checked-in history yields ~1.5k pages
    assert 500 <= len(prods) <= 4000, len(prods)
    assert all(re.fullmatch(r"/prices/p/\d+/", u) for u in prods)
    assert stats["bytes"] < 25 * 1024 * 1024


def test_single_h1_and_no_heading_jumps(pages):
    for url, html in pages.items():
        heads = headings(html)
        assert [lvl for lvl, _ in heads].count(1) == 1, url
        prev = 0
        for lvl, txt in heads:
            assert not (prev and lvl > prev + 1), f"{url}: h{prev}->h{lvl} at {txt[:30]!r}"
            prev = lvl


def test_canonical_equals_og_url_equals_path(pages):
    for url, html in pages.items():
        canon = re.search(r'<link rel="canonical" href="([^"]+)">', html).group(1)
        assert canon == BASE + url, url
        assert meta(html, "property", "og:url") == canon, url
        assert canon.endswith("/")
        assert meta(html, "property", "og:site_name") == "סלים"
        assert meta(html, "name", "twitter:card") == "summary"
        assert meta(html, "property", "og:type")
        if url.startswith("/en/"):
            assert '<html lang="en" dir="ltr">' in html
        else:
            assert '<html lang="he" dir="rtl">' in html
            assert meta(html, "property", "og:locale") == "he_IL"
        assert re.search(r"<title>[^<]+</title>", html), url


def test_meta_description_length(pages):
    for url, html in pages.items():
        desc = unescape(meta(html, "name", "description") or "")
        assert 110 <= len(desc) <= 185, (url, len(desc), desc)


def test_sitemap_lists_every_page_with_valid_lastmod(site, pages, model):
    tree = ET.parse(os.path.join(site["dir"], "sitemap-prices.xml"))
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    entries = [(u.find("s:loc", ns).text, u.find("s:lastmod", ns).text)
               for u in tree.getroot().findall("s:url", ns)]
    locs = [loc for loc, _ in entries]
    assert len(locs) == len(set(locs)) == len(pages)
    for loc, lastmod in entries:
        assert loc.startswith(BASE + "/") and loc.endswith("/")
        rel = loc[len(BASE):].strip("/")
        assert os.path.isfile(os.path.join(site["dir"], rel, "index.html")), loc
        assert DATE_RE.match(lastmod) and lastmod <= model.date, (loc, lastmod)
    # product lastmod is the date the shown content last changed, and is what
    # the page's JSON-LD dateModified says
    for loc, lastmod in entries:
        url = loc[len(BASE):]
        if url.startswith("/prices/p/"):
            assert graph_types(pages[url])["WebPage"]["dateModified"] == lastmod


def test_json_ld_parses_and_has_required_types(pages):
    required = {"product": {"BreadcrumbList", "WebPage", "Product"},
                "category": {"CollectionPage", "BreadcrumbList", "ItemList"},
                "hub": {"CollectionPage", "BreadcrumbList", "Dataset"},
                "en": {"WebPage", "BreadcrumbList"}}
    for url, html in pages.items():
        kind = ("product" if url.startswith("/prices/p/") else
                "category" if url.startswith("/prices/category/") else
                "hub" if url == "/prices/" else "en")
        types = graph_types(html)
        assert required[kind] <= set(types), (url, set(types))
        for node in types.values():
            assert "Review" not in json.dumps(node) and "AggregateRating" not in json.dumps(node)
            assert "image" not in node and "priceValidUntil" not in json.dumps(node)
        page = types.get("WebPage") or types.get("CollectionPage")
        assert page["isPartOf"] == {"@id": BASE + "/#site"}
        assert page["publisher"] == {"@id": BASE + "/#org"}
        assert page["url"] == BASE + url
        if kind == "hub":
            ds = types["Dataset"]
            assert 50 <= len(ds["description"]) <= 5000
            assert ds["isAccessibleForFree"] is True and ds["spatialCoverage"] == "Israel"
            assert ds["creator"] == {"@id": BASE + "/#org"}
            assert ds["isBasedOn"] == sp.GOV_URL and "distribution" not in ds
        if kind == "category":
            items = types["ItemList"]["itemListElement"]
            assert 1 <= len(items) <= sp.ITEMLIST_MAX
            assert [i["position"] for i in items] == list(range(1, len(items) + 1))
        if kind == "en":
            assert types["WebPage"]["inLanguage"] == "en"


def test_product_offer_matches_visible_prices(pages, model):
    for url, html in product_pages(pages).items():
        rows = price_rows(html)
        visible = [p for _c, p, _cell in rows if p is not None]
        assert len(visible) >= sp.KEEP_MIN_CHAINS, url
        offer = graph_types(html)["Product"]["offers"]
        assert offer["@type"] == "AggregateOffer" and offer["priceCurrency"] == "ILS"
        assert offer["lowPrice"] == pytest.approx(min(visible))
        assert offer["highPrice"] == pytest.approx(max(visible))
        assert offer["offerCount"] == len(visible)


def test_chains_in_fixed_order(pages, model):
    chains = model.chains
    for url, html in product_pages(pages).items():
        assert [c for c, _p, _cell in price_rows(html)] == chains, url
        hist = re.search(r'(?s)<h2 id="history">.*?<tbody>(.*?)</tbody>', html)
        if hist:
            order = [unescape(c) for c in re.findall(r'<th scope="row">(.*?)</th>', hist.group(1))]
            ranks = [(chains + sp.FIXED_CHAINS).index(c) for c in order]
            assert ranks == sorted(ranks), url
    hub = pages["/prices/"]
    table = re.search(r'(?s)<h2 id="chains">.*?<tbody>(.*?)</tbody>', hub).group(1)
    assert [unescape(c) for c in re.findall(r'<th scope="row">(.*?)</th>', table)] == chains


def test_category_tables_sorted_by_name_not_price(pages, model):
    for idx, items in model.by_cat.items():
        if idx not in sp.CATEGORY_SLUGS:
            continue
        html = pages[f"/prices/category/{sp.CATEGORY_SLUGS[idx]}/"]
        keys = re.findall(r'<th scope="row"><a href="/prices/p/(\d+)/">', html)
        assert keys == [pr.key for pr in items]
        names = [model.products[k].name for k in keys]
        assert [sp.he_sort_key(n) for n in names] == sorted(sp.he_sort_key(n) for n in names)


# --- content rules -------------------------------------------------------------
BANNED = sp.BANNED_HE + sp.BANNED_EN + sp.BANNED_META + (
    "github", "קוד פתוח", "open source", "scraper", "repository")


def generated_files(site):
    for path in glob.glob(os.path.join(site["dir"], "**", "*"), recursive=True):
        if os.path.isfile(path):
            yield path


def test_no_crowning_and_no_github_strings_anywhere(site):
    n = 0
    for path in generated_files(site):
        text = read(path).lower()
        for term in BANNED:
            assert term.lower() not in text, (path, term)
        n += 1
    assert n > 10


def test_every_page_carries_date_source_about_and_no_affiliation(pages, model):
    date = model.date
    for url, html in pages.items():
        assert f'<time datetime="{date}">' in html, url
        assert f'href="{sp.GOV_URL}"' in html, url
        assert 'href="/about/"' in html, url
        assert sp.NO_AFFILIATION_HE in html, url
        for href in ("/", "/prices/", "/articles/", "/privacy.html"):
            assert f'href="{href}"' in html, (url, href)
        if url == "/en/":
            assert sp.NO_AFFILIATION_EN in html
            assert "shelf prices" in html and "before club and coupon promotions" in html
        else:
            assert "מחירי מדף" in html and "לפני מבצעי מועדון וקופון ובלי דמי משלוח" in html
            assert "המחיר המחייב הוא המחיר אצל הרשת" in html


def test_no_scripts_images_or_foreign_requests(site):
    allowed = ("https://slim-super.com/", "https://fonts.googleapis.com",
               "https://fonts.gstatic.com", sp.GOV_URL, "http://www.sitemaps.org/")
    for path in generated_files(site):
        text = read(path)
        if path.endswith(".html"):
            assert "<img" not in text
            scripts = re.findall(r"<script\b[^>]*>", text)
            assert scripts == ['<script type="application/ld+json">'], path
            body = re.sub(r'(?s)<script type="application/ld\+json">.*?</script>', "", text)
        else:
            body = text
        for url in re.findall(r'(?:href|src)="(https?://[^"]+)"', body):
            assert url.startswith(allowed), (path, url)


def test_tables_are_accessible(pages):
    for url, html in pages.items():
        for table in re.findall(r"(?s)<table\b.*?</table>", html):
            assert "<caption>" in table, url
            assert re.search(r'<th scope="col">', table), url
            assert not re.search(r"<th(?! scope=\"(?:col|row)\")[ >]", table), url


def test_hub_wording_is_neutral_and_lists_missing_chains(pages, model):
    hub = pages["/prices/"]
    words = set(sp.name_tokens(re.sub(r"<[^>]+>", " ", hub)))
    for w in ("ירד", "עלה", "התייקר", "הוזל", "ירידה", "עלייה", "זינק", "צנח"):
        assert w not in words, w
    for chain in sp.FIXED_CHAINS:
        if chain not in model.chains:
            assert f"{chain} — לא נכללה בעדכון הזה" in hub
    assert "סכום" not in hub and "סל של" not in hub    # no basket totals


def test_excluded_products_have_no_pages(pages, model, products_path):
    with gzip.open(products_path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    excluded = [e for e in data["products"]
                if e[0].isdigit() and sp.exclusion_reason(e[1], e[3])]
    assert any(sp.exclusion_reason(e[1], e[3]) == "infant_formula" for e in excluded)
    for e in excluded:
        assert f"/prices/p/{e[0]}/" not in pages, e[1]
    for url, html in product_pages(pages).items():
        name = unescape(re.search(r"<h1>מחיר (.*?)</h1>", html).group(1))
        assert sp.exclusion_reason(name) is None, (url, name)


def test_alcohol_pages_show_prices_without_promo_text(pages, model):
    alcohol = [pr for pr in model.products.values() if pr.alcohol]
    assert alcohol, "expected some wine/beer pages in the real data"
    for pr in alcohol:
        html = pages[pr.url()]
        assert price_rows(html)
        assert 'class="pr-promo"' not in html and '<th scope="col">מבצע</th>' not in html
        table = re.search(r'(?s)<table class="pr-table">.*?<tbody>(.*?)</tbody>', html).group(1)
        for promo in pr.promos:
            if promo and promo[1]:
                assert promo[1] not in table, (pr.key, promo[1])


def test_promo_column_present_for_non_alcohol(pages, model):
    with_promo = [pr for pr in model.products.values()
                  if not pr.alcohol and any(pr.promos)]
    assert with_promo
    assert any('class="pr-promo"' in pages[pr.url()] for pr in with_promo)


def test_outlier_prices_are_hidden(pages, model):
    hidden = [(pr, i) for pr in model.products.values()
              for i, (p, s) in enumerate(zip(pr.prices, pr.shown)) if p is not None and s is None]
    assert hidden, "expected at least one outlier in the real data"
    for pr, i in hidden:
        html = pages[pr.url()]
        chain, shown, cell = price_rows(html)[i]
        assert chain == model.chains[i] and shown is None
        assert "חריג" in cell and sp.fmt_price(pr.prices[i]) not in cell
        offer = graph_types(html)["Product"]["offers"]
        assert offer["lowPrice"] != pytest.approx(pr.prices[i]) or \
            pr.prices[i] in [s for s in pr.shown if s is not None]


def test_gtin_only_when_check_digit_validates(pages):
    assert sp.gtin13("7290004131074") == "7290004131074"
    assert sp.gtin13("4006381333931") == "4006381333931"
    assert sp.gtin13("4006381333932") is None
    assert sp.gtin13("36000291452") == "0036000291452"     # UPC-A, zero-padded
    assert sp.gtin13("12345678901234") is None              # too long for GTIN-13
    assert sp.gtin13("") is None and sp.gtin13("abc") is None
    for url, html in product_pages(pages).items():
        prod = graph_types(html)["Product"]
        key = url.split("/")[3]
        if "gtin13" in prod:
            assert prod["gtin13"] == sp.gtin13(key) == key.zfill(13)
        else:
            assert sp.gtin13(key) is None


# --- selection & filters (unit) --------------------------------------------------
def test_selection_hysteresis_on_synthetic_history():
    def run(days, today_clean):
        _entered, kept = sp.select_keys(days, max(days), today_clean)
        return kept

    days = {"2026-01-01": {"A": 5}, "2026-01-02": {"A": 5}}
    assert run(days, {"A": 5}) == set()                        # two days: not yet
    days["2026-01-03"] = {"A": 5}
    assert run(days, {"A": 5}) == {"A"}                        # third day: enters
    days["2026-01-04"] = {"A": 2}
    assert run(days, {"A": 2}) == {"A"}                        # stays at 2 chains
    days["2026-01-05"] = {"A": 1}
    assert run(days, {"A": 1}) == set()                        # drops at 1
    # 4 chains never enter, however many days
    assert run({f"2026-01-{d:02d}": {"B": 4} for d in range(1, 20)}, {"B": 4}) == set()
    # entry days older than the window no longer count
    old = {"2025-01-01": {"C": 6}, "2025-01-02": {"C": 6}, "2025-01-03": {"C": 6},
           "2026-01-10": {"C": 2}}
    assert run(old, {"C": 2}) == set()


def test_clean_prices_hide_outliers():
    assert sp.clean_prices({"a": 10.0, "b": 11.0, "c": 2.9}) == {"a": 10.0, "b": 11.0}
    assert sp.clean_prices({"a": 10.0, "b": 25.0, "c": 10.5}) == {"a": 10.0, "c": 10.5}
    assert sp.clean_prices({"a": 10.0}) == {}                  # nothing to compare to
    assert sp.clean_prices({"a": 4.0, "b": 8.0}) == {"a": 4.0, "b": 8.0}   # exactly 2x


def test_word_boundary_filters():
    assert sp.is_alcohol("יין אדום יבש 750 מ\"ל")
    assert sp.is_alcohol("בירה גולדסטאר 500")
    assert sp.is_alcohol("ג'ין גורדונס 700 מ\"ל")
    assert not sp.is_alcohol("מים מינרליים מעיין 1.5 ליטר")    # מעיין is not יין
    assert not sp.is_alcohol("גבירה תה ירוק")                  # גבירה is not בירה
    assert not sp.is_alcohol("חלב תנובה 3%")
    assert sp.exclusion_reason("סיגריות מלבורו גולד") == "tobacco"
    assert sp.exclusion_reason("טבק לגלגול 50 גרם") == "tobacco"
    assert sp.exclusion_reason("סיגרים במילוי בשר 1 ק\"ג") is None      # pastry
    assert sp.exclusion_reason("עלי סיגר מרוקאים 500 גרם") is None
    assert sp.exclusion_reason("מטהר אוויר אנטי-טבק 19 מל") is None
    assert sp.exclusion_reason("תמ\"ל שלב 1 700 גרם") == "infant_formula"
    assert sp.exclusion_reason("סימילאק שלב 2") == "infant_formula"
    assert sp.exclusion_reason("פיקדון בקבוק") == "pseudo_item"
    assert sp.exclusion_reason("דמי משלוח - אתר אינטרנט") == "pseudo_item"
    assert sp.exclusion_reason("שקית") == "pseudo_item"
    assert sp.exclusion_reason("קליק שקית קורנפלקס 65 גר") is None      # a real snack
    assert sp.exclusion_reason("במבה 80 גרם") is None


def test_partial_chain_note():
    from collections import Counter
    hist = {"dates": [f"2026-01-0{d}" for d in range(1, 9)],
            "rows": {f"2026-01-0{d}": Counter({"x": 1000, "y": 1000}) for d in range(1, 9)}}
    hist["rows"]["2026-01-08"] = Counter({"x": 700, "y": 990})
    assert sp.partial_chains(hist, ["x", "y"], "2026-01-08") == ["x"]


def test_he_sort_key_puts_hebrew_first_and_folds_finals():
    names = ["MUST קראנץ", "16 טמפונים", "צנון", "ץ", "אבוקדו", "כף", "ךא"]
    assert sorted(names, key=sp.he_sort_key) == [
        "אבוקדו", "ךא", "כף", "ץ", "צנון", "MUST קראנץ", "16 טמפונים"]


# --- switches & determinism --------------------------------------------------------
def test_noindex_switch(model, tmp_path, monkeypatch):
    assert sp.STATIC_PAGES_NOINDEX is False
    monkeypatch.setattr(sp, "STATIC_PAGES_NOINDEX", True)
    out = str(tmp_path / "site")
    sp.write_pages(model, out)                       # noindex=None -> the constant
    files = glob.glob(os.path.join(out, "**", "index.html"), recursive=True)
    n_cat = sum(1 for idx in sp.CATEGORY_SLUGS if model.by_cat.get(idx))
    assert len(files) == len(model.products) + n_cat + 2
    for path in files:
        assert '<meta name="robots" content="noindex, follow">' in read(path), path
    root = ET.parse(os.path.join(out, "sitemap-prices.xml")).getroot()
    assert len(list(root)) == 0


def test_default_pages_are_indexable(pages):
    for url, html in pages.items():
        assert '<meta name="robots" content="index, follow">' in html, url


def test_output_is_deterministic(site, products_path, tmp_path):
    """A second run in a fresh interpreter (different hash seed) writes
    byte-identical files."""
    out = str(tmp_path / "site2")
    env = dict(os.environ, PYTHONHASHSEED="12345")
    res = subprocess.run([sys.executable, os.path.join(ROOT, "build_static_pages.py"),
                          "--site", out, "--data-dir", DATA, "--products", products_path],
                         cwd=ROOT, env=env, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert "pages" in res.stdout and "MB" in res.stdout

    def snapshot(base):
        return {os.path.relpath(p, base): open(p, "rb").read()
                for p in glob.glob(os.path.join(base, "**", "*"), recursive=True)
                if os.path.isfile(p)}

    first, second = snapshot(site["dir"]), snapshot(out)
    assert first.keys() == second.keys()
    diff = [k for k in first if first[k] != second[k]]
    assert not diff, diff[:5]


def test_cli_fails_without_dataset(tmp_path):
    res = subprocess.run([sys.executable, os.path.join(ROOT, "build_static_pages.py"),
                          "--site", str(tmp_path), "--data-dir", DATA],
                         cwd=ROOT, capture_output=True, text=True)
    assert res.returncode != 0
