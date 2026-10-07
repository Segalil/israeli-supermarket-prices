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


def sitemap_entries(site):
    tree = ET.parse(os.path.join(site["dir"], "sitemap-prices.xml"))
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    out = []
    for u in tree.getroot().findall("s:url", ns):
        mod = u.find("s:lastmod", ns)
        out.append((u.find("s:loc", ns).text, mod.text if mod is not None else None))
    return out


def test_sitemap_lists_every_page_with_valid_lastmod(site, pages, model):
    entries = sitemap_entries(site)
    locs = [loc for loc, _ in entries]
    assert len(locs) == len(set(locs)) == len(pages)
    for loc, lastmod in entries:
        assert loc.startswith(BASE + "/") and loc.endswith("/")
        rel = loc[len(BASE):].strip("/")
        assert os.path.isfile(os.path.join(site["dir"], rel, "index.html")), loc
        if lastmod is None:                      # only a never-changed product page
            assert loc[len(BASE):].startswith("/prices/p/"), loc
            continue
        assert DATE_RE.match(lastmod) and lastmod <= model.date, (loc, lastmod)
    # product lastmod is the date the shown content last changed, and is what
    # the page's JSON-LD dateModified says — both absent when no change was seen
    for loc, lastmod in entries:
        url = loc[len(BASE):]
        if url.startswith("/prices/p/"):
            assert graph_types(pages[url])["WebPage"].get("dateModified") == lastmod, url


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


# --- regressions from the 2026-10 output review -----------------------------------
def page_text(html):
    return unescape(re.sub(r"<[^>]+>", " ", html))


def promo_cells(html):
    return [unescape(re.sub(r"<[^>]+>", " ", c))
            for c in re.findall(r'(?s)<td class="pr-promo">(.*?)</td>', html)]


def lede_value(html, label):
    lede = unescape(re.sub(r"<[^>]+>", "", re.search(r'(?s)<p class="art-lede">(.*?)</p>', html).group(1)))
    m = re.search(re.escape(label) + r": ([^·]+)", lede)
    return m and m.group(1).strip()


# 1. alcohol ------------------------------------------------------------------------
def test_alcohol_vocabulary_brands_varieties_and_promo_text():
    for name in ('סומרסבי מנגו ליים 330מ"ל', 'סטלה ארטואה - פחית 440 מ"ל',
                 'קורונה מארז שישיה 6*355 מ"ל', "ברקן קלאסיק א.ריזלינג750",
                 'ברקן קלאסיק מרלו 750 מ"ל', 'סגל אדום יבש 750 מ"ל 2013',
                 "מרלו אימפרשן 750 מ''ל", 'מרלו הר תבור 750 מ"ל', "ייגרמייסטר 700 מ\"ל",
                 "גוני ווקר בלאק לייב", "גק דניאלס טנסי 700 מ\"ל"):
        assert sp.is_alcohol(name), name
    # the promo text alone flags a wine whose name carries no alcohol word
    assert not sp.is_alcohol("שישיית 1664 בלאנק בק 330 מ\"ל")
    assert sp.is_alcohol("שישיית 1664 בלאנק בק 330 מ\"ל", "",
                         ['41.10 פקדון בירה 1664 בלאנק 330*6מ-"ישיר'])
    assert sp.is_alcohol("X", "", ["יינות תבור 2 ב 64"])
    # ... but a chain's own name in its promo text is not a product word
    assert not sp.is_alcohol("במבה 80 גרם", "", ["יינות ביתן מבצע 2 ב 10"])
    # false positives found in the real catalogue stay out
    for name in ("קיט אנטיגן קורונה+שפעת5י", "ג'ינס ליוייס 511 מקורי שחור 30",
                 "פלפל אדום יבש ( חריף)", "שפתון מאט פיור קולור סגל",
                 "משקה קל מרלו ענבים פריגת 1.5 ליטר", "מיץ תירוש ענבים 700 מ\"ל יקבי כרמל",
                 "נקניק סלמי קוניאק זוגלובק 300 גרם", "מימונס תמצית רום 50 מ\"ל",
                 "שוופס מוגז עדין ענבי ריזלינג 1.5 ליטר", "אבסולוט ריפר לשיער מארז",
                 "גבינת קממבר מכבי 20% 250 גרם", "אגוז מוסקט טחון 40 גרם",
                 "חליטת סיידר תפוחים 250גר", "212 ויפ רוזה אלקסיר 80מל",
                 "גבינה לאפיה תבור לל\"מ 5% משק צוריאל 500 גרם"):
        assert not sp.is_alcohol(name), name


def test_no_promo_cell_where_name_brand_or_promo_text_is_alcohol(pages, model, products_path):
    """Over the REAL output: a page that shows a promo cell names no alcohol in
    its h1, its manufacturer line or any promo text (shown or not)."""
    with gzip.open(products_path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    raw = {e[0]: e for e in data["products"]}
    checked = 0
    for url, html in product_pages(pages).items():
        cells = promo_cells(html)
        if not cells:
            continue
        key = url.split("/")[3]
        name = unescape(re.search(r"<h1>מחיר (.*?)</h1>", html).group(1))
        maker = lede_value(html, "יצרן / יבואן") or ""
        texts = cells + [pm[1] for pm in (raw[key][6] or []) if pm and pm[1]]
        assert not sp.is_alcohol(name, maker, texts), (url, name, texts[:3])
        checked += 1
    assert checked > 100
    # the pages the review found showing deals stay without a promo column
    for key in ("3858887585205", "5410228217732", "7290019398233", "7501064191527",
                "7290000023816", "7290000023977", "7290000521008", "7290015781114",
                "7290103681180"):
        if key in model.products:
            assert model.products[key].alcohol, key
            assert '<th scope="col">מבצע</th>' not in pages[f"/prices/p/{key}/"]


# 2. store-wide offers ---------------------------------------------------------------
def test_storewide_promo_rules():
    for desc in ("599שח ומעלה-מתנה לבחירה-אונליין", 'מתנה בקנייה מעל 200 ש"ח',
                 "בקנייה של מעל 300 ₪ - משלוח חינם", 'ע. סיבוס קופון 50ש"ח מתנה',
                 "גימלאי 50 ש ח מתנה לחג 2026"):
        assert sp.promo_is_storewide("x", desc), desc
    for desc in ("2 ב 20", "2ב12.40 פקדון מירינדה", "בי 30% הנחה איפור וטיפוח פנים",
                 "1+1 מתנה", "קנה 3 שלם 2"):
        assert not sp.promo_is_storewide("x", desc), desc
    # the count rule: more than STOREWIDE_PROMO_MIN products in one chain
    n = sp.STOREWIDE_PROMO_MIN
    deal = [None, "הטבה כללית", 0, 1]
    data = {"chains": ["a", "b"], "products": (
        [[str(i), "p", "", "", [1.0, 1.0], None, [deal, deal if i < n else None], 0]
         for i in range(n + 1)])}
    assert sp.storewide_promos(data) == {("a", "הטבה כללית")}   # b carries it n times
    assert sp.filter_promos([deal, deal], ["a", "b"], sp.storewide_promos(data)) == [None, deal]
    facts = sp.hub_facts(data, sp.storewide_promos(data))
    assert facts["with_promo"] == n                  # the b-side deals still count


def test_storewide_offers_never_shown_or_counted(pages, model, products_path):
    with gzip.open(products_path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    common = sp.storewide_promos(data)
    assert common == model.common_promos
    chains = data["chains"]
    hidden = {d for _c, d in common}
    for url, html in product_pages(pages).items():
        for cell in promo_cells(html):
            assert not sp.STOREWIDE_PROMO_RE.search(cell), (url, cell)
            assert not any(cell.startswith(d.strip(" *")) for d in hidden), (url, cell)
        assert "599שח ומעלה" not in html, url
    expect = sum(1 for e in data["products"]
                 if e[6] and any(pm and not sp.promo_is_storewide(chains[i], pm[1], common)
                                 for i, pm in enumerate(e[6])))
    hub = pages["/prices/"]
    shown = re.search(r'ל־<span dir="ltr">([\d,]+)</span> מהם יש לפחות מבצע', hub).group(1)
    assert int(shown.replace(",", "")) == expect


# 3. the visible "last change" line ----------------------------------------------------
def test_last_change_carries_values_across_absent_days():
    lc = sp.last_change
    assert lc([("d1", {"a": 1.0}), ("d2", {"a": 1.0})]) is None
    # a chain missing from a partial file, back at the same price: no change
    assert lc([("d1", {"a": 1.0, "b": 2.0}), ("d2", {"a": 1.0}),
               ("d3", {"a": 1.0, "b": 2.0})]) is None
    # first appearance is not a change either
    assert lc([("d1", {"a": 1.0}), ("d2", {"a": 1.0, "b": 2.0})]) is None
    # a real change, then quiet days
    assert lc([("d1", {"a": 1.0}), ("d2", {"a": 1.5}), ("d3", {"a": 1.5})]) == "d2"
    # a different price after an absence is compared with the carried value
    assert lc([("d1", {"a": 1.0}), ("d2", {}), ("d3", {"a": 1.2})]) == "d3"


def _synthetic_history():
    days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
    prices = {
        "2026-01-01": {"K": {"a": 10.0, "b": 10.5}},
        "2026-01-02": {"K": {"a": 10.0}},                 # b: partial file
        "2026-01-03": {"K": {"a": 10.0, "b": 10.5}},      # b reappears, same price
        "2026-01-04": {"K": {"a": 10.0, "b": 10.5}},
    }
    promo = {"chain": "a", "barcode": "K", "end_date": "", "min_qty": "1",
             "discounted_price": "", "club": "", "is_coupon": ""}
    promos = {d: [] for d in days}
    promos["2026-01-04"] = [dict(promo, description="2 ב 18")]   # promo text only
    return {"dates": days, "prices": prices, "promos": promos}


def _synthetic_product(alcohol=False):
    pr = sp.Product()
    pr.key, pr.name, pr.unit, pr.brand, pr.cat = "K", "מוצר", "", "", 0
    pr.prices, pr.shown, pr.promos = [10.0, 10.5], [10.0, 10.5], [None, None]
    pr.alcohol, pr.size_conflict, pr.title_name = alcohol, False, "מוצר"
    return pr


def test_promo_only_and_reappearance_do_not_move_the_price_change_line(monkeypatch):
    monkeypatch.setattr(sp, "barcode_key", lambda b: b)        # "K" as a key
    import israeli_prices.basket as basket
    monkeypatch.setattr(basket, "barcode_key", lambda b: b)
    hist = _synthetic_history()
    pr = _synthetic_product()
    sp.attach_history({"K": pr}, ["a", "b"], hist, "2026-01-04")
    assert pr.price_changed is None                  # no shelf price changed
    assert pr.content_modified == "2026-01-04"       # but the promo text did
    data = {"date": "2026-01-04", "chains": ["a", "b"], "products": []}
    html = sp.render_product(pr, ["a", "b"], data, {}, False)
    assert "שינוי אחרון במחירים המוצגים" not in html
    assert "השתנו בעדכון הזה" not in html
    # a real shelf change two days back is what the line reports
    hist["prices"]["2026-01-03"]["K"]["a"] = 9.0
    hist["prices"]["2026-01-04"]["K"]["a"] = 9.0
    pr = _synthetic_product()
    sp.attach_history({"K": pr}, ["a", "b"], hist, "2026-01-04")
    assert pr.price_changed == "2026-01-03" and pr.content_modified == "2026-01-04"
    html = sp.render_product(pr, ["a", "b"], data, {}, False)
    assert 'שינוי אחרון במחירים המוצגים: <time datetime="2026-01-03">' in html


def test_visible_change_line_matches_shelf_prices(pages, model):
    """Over the REAL output: the visible line is the newest day a shown
    chain's shelf price differed from its previous known price."""
    hist = model.hist
    for url, html in product_pages(pages).items():
        key = url.split("/")[3]
        shown = [c for c, p, _cell in price_rows(html) if p is not None]
        last, newest = {}, None
        for d in hist["dates"]:
            day = hist["prices"][d].get(key, {})
            for c in shown:
                if c in day:
                    if c in last and last[c] != day[c]:
                        newest = d
                    last[c] = day[c]
        m = re.search(r'שינוי אחרון במחירים המוצגים: <time datetime="([\d-]+)"', html)
        visible = m.group(1) if m else (model.date if "השתנו בעדכון הזה" in html else None)
        assert visible == newest, (url, visible, newest)


# 4. "days in the file" ------------------------------------------------------------------
def test_history_counts_days_present_in_the_raw_file(pages, model):
    hist = model.hist
    start = sp._hist_start(model.date)
    window = [d for d in hist["dates"] if start <= d <= model.date]
    dash = 0
    for url, html in product_pages(pages).items():
        key = url.split("/")[3]
        present = {}
        for d in window:
            for c in hist["prices"][d].get(key, {}):
                present[c] = present.get(c, 0) + 1
        m = re.search(r'(?s)<h2 id="history">.*?<tbody>(.*?)</tbody>', html)
        rows = re.findall(r'<tr><th scope="row">(.*?)</th><td>(.*?)</td><td>(\d+)</td></tr>',
                          m.group(1)) if m else []
        table = {unescape(c): int(n) for c, _r, n in rows}
        assert table == present, (url, table, present)
        dash += sum(1 for _c, r, _n in rows if r == "—")
    assert dash >= 0


def test_history_lists_a_chain_whose_values_were_all_filtered(monkeypatch):
    monkeypatch.setattr(sp, "barcode_key", lambda b: b)
    days = ["2026-01-01", "2026-01-02"]
    hist = {"dates": days, "promos": {d: None for d in days},
            "prices": {d: {"K": {"a": 10.0, "b": 10.5, "c": 50.0, "d": 10.2}} for d in days}}
    hist["prices"]["2026-01-01"]["K"].pop("d")         # d: one day only
    chains = ["a", "b", "c", "d"]
    pr = _synthetic_product()
    pr.prices, pr.shown, pr.promos = [10.0, 10.5, 50.0, 10.2], [10.0, 10.5, None, 10.2], [None] * 4
    sp.attach_history({"K": pr}, chains, hist, "2026-01-02")
    assert pr.history == [("a", 10.0, 10.0, 2), ("b", 10.5, 10.5, 2), ("c", None, None, 2),
                          ("d", 10.2, 10.2, 1)]
    data = {"date": "2026-01-02", "chains": chains, "products": []}
    html = sp.render_product(pr, chains, data, {}, False)
    assert '<tr><th scope="row">c</th><td>—</td><td>2</td></tr>' in html


# 5. CLI never deletes the live pages on a failed run ---------------------------------------
def test_cli_keeps_existing_output_when_there_is_nothing_to_build(products_path, tmp_path):
    site_dir = tmp_path / "site"
    sentinel = site_dir / "prices" / "p" / "123" / "index.html"
    sentinel.parent.mkdir(parents=True)
    sentinel.write_text("live page", encoding="utf-8")
    for data_dir in (str(tmp_path / "nonexistent"), str(tmp_path)):   # missing / empty
        res = subprocess.run([sys.executable, os.path.join(ROOT, "build_static_pages.py"),
                              "--site", str(site_dir), "--products", products_path,
                              "--data-dir", data_dir],
                             cwd=ROOT, capture_output=True, text=True)
        assert res.returncode == 1, res.stdout + res.stderr
        assert "KeyError" not in res.stderr and "Traceback" not in res.stderr
        assert sentinel.read_text(encoding="utf-8") == "live page"
        assert not (site_dir / "prices" / "index.html").exists()


def test_write_pages_refuses_an_empty_selection(model, tmp_path):
    import copy
    empty = copy.copy(model)
    empty.products = {}
    (tmp_path / "prices").mkdir()
    (tmp_path / "prices" / "keep.txt").write_text("x")
    with pytest.raises(sp.GenerationError):
        sp.write_pages(empty, str(tmp_path))
    assert (tmp_path / "prices" / "keep.txt").exists()


# 6. a per-unit promo price that contradicts "N ב X" -----------------------------------------
def test_promo_unit_price_never_contradicts_the_deal_text(pages):
    assert sp.deal_price_agrees("2 ב 20", 10.0)
    assert sp.deal_price_agrees("מגוון רטבים קנור 2 ב 20", 10.004)
    assert not sp.deal_price_agrees("2ב12.40 פקדון מירינדה/סבן אפ 1.5 לי-ישיר", 6.50)
    assert not sp.deal_price_agrees("3 ב-24.10", 8.50)
    assert sp.deal_price_agrees("750 מ ל 2202 ב 110", 55.0)       # no clean "N ב X"
    assert sp.deal_price_agrees("30% הנחה", 7.0)
    desc, details = sp._promo_text([6.50, "2ב12.40 פקדון מירינדה", 0, 2], 6.90)
    assert not any("ליחידה" in d for d in details) and "בקנייה של 2" in details
    n = 0
    for url, html in product_pages(pages).items():
        for cell in promo_cells(html):
            m = re.search(r"(\d+\.\d\d) ₪ ליחידה", cell)
            if m:
                n += 1
                assert sp.deal_price_agrees(cell[:cell.find(m.group(0))], float(m.group(1))), \
                    (url, cell)
    assert n > 50


# 8. a name and a size field that disagree ----------------------------------------------------
def test_size_conflict_rules():
    assert sp.size_conflict('עגבניות מרוסקות 600 גרם בד"ץ יכין', "800 גרם")
    assert sp.size_conflict("גלידת בליסימו צרפתי 850 מל", "425 גרם")
    assert not sp.size_conflict("עגבניות מרוסקות 800 גרם", "800 גרם")
    assert not sp.size_conflict("סבן אפ 1.5 ליטר שישייה", "9 ליטר")          # a pack
    assert not sp.size_conflict('בירה 6*330 מ"ל', "1980 מ\"ל")
    assert not sp.size_conflict("אורביט באבל מינט בקבוקון 64.4ג", "64 גרם")   # rounding
    assert not sp.size_conflict('יוגורט דנונה תות 3% שומן 150 מ"ל', "150 גרם")
    assert not sp.size_conflict("צמד חמד סלמי 350גר+פסט 350ג", "700 גרם")
    assert not sp.size_conflict("במבה", "80 גרם")                        # no size in name
    assert not sp.size_conflict("שוקולד 100 גרם", "6 יחידות")             # not a measure


def test_conflicting_size_pages_show_no_size_or_per_unit(pages, model):
    conflicts = [pr for pr in model.products.values() if pr.size_conflict]
    assert conflicts, "expected drained-vs-gross weights in the real data"
    for pr in conflicts:
        html = pages[pr.url()]
        assert "גודל:" not in html and "מחיר ליחידת מידה" not in html, pr.key
    for url, html in product_pages(pages).items():
        size = lede_value(html, "גודל")
        if size:
            name = unescape(re.search(r"<h1>מחיר (.*?)</h1>", html).group(1))
            assert not sp.size_conflict(name, size), (url, name, size)


# 9. titles -------------------------------------------------------------------------------
def test_titles_never_end_on_a_cut_number(pages):
    t = sp.product_title("משקה שוופס אפרסק מוגז דיאט מופחת סוכר בבקבוק פלסטיק 1.5 ליטר", "2026-10-06")
    assert len(t) <= sp.TITLE_MAX and not re.search(r"\d…? — ", t), t
    t = sp.product_title("בירה קורונה 4.5% עם שם ארוך במיוחד לבדיקה 355", "2026-10-06")
    assert not re.search(r"\d…? — ", t), t
    for url, html in pages.items():
        title = unescape(re.search(r"<title>(.*?)</title>", html).group(1))
        head = title.split(" — ")[0]
        assert not re.search(r"\d…?$", head), (url, title)
        assert len(title) <= sp.TITLE_MAX or not url.startswith("/prices/p/"), title


# 10. category tables -------------------------------------------------------------------------
def test_category_rows_hide_trivial_sizes_and_count_chains_in_the_file(pages, model):
    rows = 0
    for idx, items in model.by_cat.items():
        if idx not in sp.CATEGORY_SLUGS:
            continue
        html = pages[f"/prices/category/{sp.CATEGORY_SLUGS[idx]}/"]
        found = re.findall(r'<tr><th scope="row"><a href="/prices/p/(\d+)/">.*?</a></th>'
                           r"<td>(.*?)</td><td>(\d+)</td>", html)
        for key, size, n in found:
            pr = model.products[key]
            assert unescape(size) != "1 יחידות", key
            assert unescape(size) == (sp.display_size(pr) or "—"), key
            assert int(n) == sum(1 for p in pr.prices if p is not None), key
            rows += 1
    assert rows == sum(len(v) for k, v in model.by_cat.items() if k in sp.CATEGORY_SLUGS)


# 11. unknown lastmod is omitted ----------------------------------------------------------------
def test_unchanged_pages_carry_no_lastmod_or_date_modified(site, pages, model):
    unchanged = [pr for pr in model.products.values() if pr.content_modified is None]
    entries = dict(sitemap_entries(site))
    oldest = model.hist["dates"][0]
    for pr in unchanged:
        assert entries[BASE + pr.url()] is None
        assert "dateModified" not in graph_types(pages[pr.url()])["WebPage"]
    for loc, mod in entries.items():
        if "/prices/p/" in loc and mod is not None:
            assert mod > oldest or model.products[loc.split("/")[-2]].content_modified == oldest
    xml = sp.render_sitemap([("/prices/", "2026-01-02"), ("/prices/p/1/", None)], False)
    assert "<url><loc>https://slim-super.com/prices/p/1/</loc></url>" in xml
    assert "<lastmod>2026-01-02</lastmod>" in xml


# 12. manufacturer, not brand -------------------------------------------------------------------
def test_manufacturer_is_not_presented_as_the_brand(pages, model):
    with_maker = 0
    for url, html in product_pages(pages).items():
        prod = graph_types(html)["Product"]
        assert "brand" not in prod, url
        assert "מותג" not in page_text(html), url
        pr = model.products[url.split("/")[3]]
        if pr.brand:
            assert prod["manufacturer"] == {"@type": "Organization", "name": pr.brand}
            assert lede_value(html, "יצרן / יבואן") == pr.brand
            with_maker += 1
    assert with_maker > 100


# 13. minor: related links, tobacco words, thresholds in text, store types ------------------------
def test_uncategorised_pages_link_no_unrelated_products(pages, model):
    zero = [pr for pr in model.products.values() if pr.cat not in sp.CATEGORY_SLUGS]
    assert zero
    for pr in zero:
        assert 'id="related"' not in pages[pr.url()], pr.key
    assert any('id="related"' in pages[pr.url()] for pr in model.products.values()
               if pr.cat in sp.CATEGORY_SLUGS)


def test_tobacco_brand_words():
    for name in ("קנט ארוך פאקט", "כאמל צהוב ארוך פאקט", "L&M בלו", "אל אם בלו ארוך פאקט",
                 "ניר קצר לגלגול ללא פילטר", "פאלמאל אדום פאקט", "ווג מנטה פאקט",
                 "טיים רד ארוך פאקט", "פילטר לסיגריות 30 יח"):
        assert sp.exclusion_reason(name) == "tobacco", name
    for name in ("גרעיני תירס מתוק 335 גרם פרי ניר בדץ עדה חרדית", "מארז לילי ניר לח רביעייה",
                 "פרוט אנד ווג' תפוח שזיף 1ל קרטונית", "פרוט&ווג מנגו תפוח 1 ליטר",
                 "ביסלי פארטי מיקס 150 גרם", "נייר אפייה"):
        assert sp.exclusion_reason(name) is None, name


def test_thresholds_in_text_follow_the_constants(pages, monkeypatch):
    hub = page_text(pages["/prices/"])
    assert sp.selection_rule_he() in hub
    assert "בשלושה ימים" in sp.selection_rule_he() and "בשתי רשתות" in sp.selection_rule_he()
    monkeypatch.setattr(sp, "ENTER_MIN_DAYS", 4)
    monkeypatch.setattr(sp, "KEEP_MIN_CHAINS", 3)
    monkeypatch.setattr(sp, "MIN_ENTER_CHAINS", 6)
    rule = sp.selection_rule_he()
    assert "בארבעה ימים" in rule and "בשלוש רשתות" in rule and "שש רשתות" in rule
    assert sp.he_count(12, False) == "12"


def test_store_type_tuples_for_reuse():
    assert sp.ONLINE_STORE == ("שופרסל", "רמי לוי", "יינות ביתן / קרפור", "ויקטורי", "חצי חינם")
    assert sp.BRANCH_STORE == ("יוחננוף", "אושר עד")
    assert set(sp.ONLINE_STORE) | set(sp.BRANCH_STORE) == set(sp.FIXED_CHAINS)
    assert all(sp.chain_store_type(c) == sp.ONLINE for c in sp.ONLINE_STORE)
    assert all(sp.chain_store_type(c) == sp.BRANCH for c in sp.BRANCH_STORE)
