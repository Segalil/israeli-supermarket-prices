# -*- coding: utf-8 -*-
"""SEO/structure tests for the static pages (no network required).

The app is hash-routed, so only real files under site/ are crawlable. These
tests guard the invariants that make them rank and stay consistent: one <h1>
per page, no skipped heading levels, live anchors, matching canonical/og:url,
valid JSON-LD, and a sitemap that actually lists every guide.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
ARTICLES = os.path.join(SITE, "articles")
BASE = "https://slim-super.com"

sys.path.insert(0, ROOT)
import stamp_static  # noqa: E402
import indexnow_ping  # noqa: E402


def article_pages():
    """(slug, path) for every guide page plus the hub, hub last."""
    pages = [(os.path.basename(os.path.dirname(p)), p)
             for p in sorted(glob.glob(os.path.join(ARTICLES, "*", "index.html")))]
    return pages + [("", os.path.join(ARTICLES, "index.html"))]


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def headings(html):
    return [(int(m.group(1)), re.sub(r"<[^>]+>", "", m.group(2)).strip())
            for m in re.finditer(r"(?is)<h([1-6])[^>]*>(.*?)</h\1>", html)]


def json_ld(html):
    return [json.loads(b) for b in
            re.findall(r'(?is)<script type="application/ld\+json">(.*?)</script>', html)]


def sitemap_target(url):
    """The file a sitemap URL resolves to, or None.

    Two shapes are in use: clean directory URLs served by their index.html
    (/articles/foo/), and flat pages (/privacy.html).
    """
    rel = url[len(BASE):].strip("/")
    if not rel:
        return os.path.join(SITE, "index.html")
    for candidate in (os.path.join(SITE, rel, "index.html"), os.path.join(SITE, rel)):
        if os.path.isfile(candidate):
            return candidate
    return None


def test_article_pages_exist():
    slugs = {slug for slug, _ in article_pages() if slug}
    assert slugs, "no article pages found under site/articles/"
    assert os.path.exists(os.path.join(ARTICLES, "index.html")), "missing articles hub"


def test_single_h1_and_no_level_jumps():
    for slug, path in article_pages():
        heads = headings(read(path))
        h1s = [t for lvl, t in heads if lvl == 1]
        assert len(h1s) == 1, f"{slug or 'hub'}: expected one <h1>, got {h1s}"
        prev = 0
        for lvl, txt in heads:
            assert not (prev and lvl > prev + 1), \
                f"{slug or 'hub'}: heading jump h{prev}->h{lvl} at {txt[:40]!r}"
            prev = lvl


def test_app_screens_have_exactly_one_h1():
    """Each screen template in app.js renders a single <h1>."""
    app = read(os.path.join(SITE, "app.js"))
    # page-title is the per-screen h1; it must never be another level
    assert not re.search(r'<h[2-6][^>]*class="page-title"', app), \
        "a .page-title is not an <h1>"
    assert re.search(r'<h1[^>]*class="page-title"', app), "no .page-title <h1> found"


def test_no_leftover_template_placeholders():
    for slug, path in article_pages():
        left = re.findall(r"\{\{[^}]{0,60}\}\}", read(path))
        assert not left, f"{slug or 'hub'}: leftover placeholders {left}"


def test_anchors_resolve():
    for slug, path in article_pages():
        html = read(path)
        ids = set(re.findall(r'\bid="([^"]+)"', html))
        for anchor in re.findall(r'href="#([^"]+)"', html):
            assert anchor in ids, f"{slug or 'hub'}: dead anchor #{anchor}"


def test_canonical_matches_path_and_og_url():
    for slug, path in article_pages():
        html = read(path)
        want = f"{BASE}/articles/" + (f"{slug}/" if slug else "")
        canon = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        ogurl = re.search(r'<meta property="og:url" content="([^"]+)"', html)
        assert canon, f"{slug or 'hub'}: no canonical"
        assert canon.group(1) == want, \
            f"{slug or 'hub'}: canonical {canon.group(1)} != {want}"
        assert ogurl and ogurl.group(1) == want, \
            f"{slug or 'hub'}: og:url does not match canonical"


def test_meta_description_present_and_sized():
    for slug, path in article_pages():
        m = re.search(r'<meta name="description" content="([^"]+)"', read(path))
        assert m, f"{slug or 'hub'}: no meta description"
        assert 110 <= len(m.group(1)) <= 185, \
            f"{slug or 'hub'}: meta description is {len(m.group(1))} chars"


def test_json_ld_is_valid_and_typed():
    for slug, path in article_pages():
        blocks = json_ld(read(path))  # raises on malformed JSON
        assert blocks, f"{slug or 'hub'}: no JSON-LD"
        types = set()
        for data in blocks:
            for node in data.get("@graph", [data]):
                types.add(node.get("@type"))
        expected = {"CollectionPage"} if not slug else {"Article"}
        assert expected <= types, f"{slug or 'hub'}: JSON-LD types {types} missing {expected}"
        assert "BreadcrumbList" in types, f"{slug or 'hub'}: no BreadcrumbList"


def test_internal_article_links_resolve():
    for slug, path in article_pages():
        for href in sorted(set(re.findall(r'href="(/articles/[^"#]*)"', read(path)))):
            target = os.path.join(SITE, href.strip("/"))
            assert os.path.exists(os.path.join(target, "index.html")) or os.path.exists(target), \
                f"{slug or 'hub'}: link to missing page {href}"


def test_sitemap_lists_every_page():
    sitemap = read(os.path.join(SITE, "sitemap.xml"))
    locs = set(re.findall(r"<loc>([^<]+)</loc>", sitemap))
    assert f"{BASE}/" in locs, "sitemap missing the home page"
    for slug, _ in article_pages():
        url = f"{BASE}/articles/" + (f"{slug}/" if slug else "")
        assert url in locs, f"sitemap missing {url}"
    for url in locs:
        assert url.startswith(BASE), f"sitemap has a foreign URL: {url}"
    # and nothing listed that does not exist — a 404 in the sitemap is a crawl error
    for url in locs:
        assert sitemap_target(url), f"sitemap lists {url} but the file does not exist"


def test_sitemap_home_lastmod_is_stampable():
    """stamp_static.py (run by deploy-pages.yml) rewrites the home <lastmod>
    with the snapshot date. It matches on this exact shape, so a reformat of
    sitemap.xml would silently stop the stamp."""
    sitemap = read(os.path.join(SITE, "sitemap.xml"))
    assert len(re.findall(stamp_static.SITEMAP_HOME_RE, sitemap)) == 1, \
        "home <loc>/<lastmod> pair not in the shape stamp_static.py stamps"
    workflow = read(os.path.join(ROOT, ".github", "workflows", "deploy-pages.yml"))
    assert "python stamp_static.py" in workflow, "deploy-pages.yml no longer runs the stamp"


def test_robots_allows_crawling_and_points_at_sitemap():
    robots = read(os.path.join(SITE, "robots.txt"))
    assert f"Sitemap: {BASE}/sitemap.xml" in robots
    # Googlebot's renderer honours robots.txt for subresources; blocking the
    # dataset would make the crawler render a broken app.
    directives = [l.strip() for l in robots.splitlines()
                  if l.strip().lower().startswith("disallow:")]
    assert all(l.split(":", 1)[1].strip() == "" for l in directives), \
        f"robots.txt must not disallow anything: {directives}"


def test_home_page_seo_tags():
    html = read(os.path.join(SITE, "index.html"))
    assert f'<link rel="canonical" href="{BASE}/">' in html
    assert re.search(r'<meta name="description" content="[^"]{110,185}"', html), \
        "home meta description missing or badly sized"
    types = {node.get("@type") for data in json_ld(html)
             for node in data.get("@graph", [data])}
    assert {"WebSite", "Organization", "WebApplication"} <= types, types
    # the cache-busting step in deploy-pages.yml rewrites these exact strings
    assert '<script src="app.js" defer></script>' in html
    assert '<link rel="stylesheet" href="style.css">' in html


def test_walkthrough_video_never_precedes_the_main_cta():
    """The onboarding CTA sits above the fold on stacked layouts; a video section
    rendered before the form silently pushed it back down (518 -> 852 on a
    phone), so pin where the video lives.

    It belongs to .ob-side, which is the left column on desktop and stacks BELOW
    .ob-main everywhere else — that is what puts it top-left on a wide screen and
    still after the CTA on a narrow one.
    """
    app = read(os.path.join(SITE, "app.js"))
    assert app.index("ob-cta-main") < app.index("${videoH()}"), \
        "videoH() must render after the primary CTA"
    side = app.index('class="ob-side"')
    assert side < app.index("${videoH()}"), "videoH() must sit inside .ob-side"
    assert app.index("${videoH()}") < app.index('class="ob-hero"'), \
        "the video goes above the basket card, not below it"


def test_video_assets_exist_and_are_reasonable():
    media = os.path.join(SITE, "media")
    for name, cap_mb in [("slim-explainer-short.mp4", 4),
                         ("slim-explainer.mp4", 12),
                         ("slim-explainer-mobile.mp4", 8),
                         ("poster.jpg", 1)]:
        path = os.path.join(media, name)
        assert os.path.exists(path), f"missing {name}"
        mb = os.path.getsize(path) / 1e6
        assert mb <= cap_mb, f"{name} is {mb:.1f}MB, over the {cap_mb}MB budget"


def test_full_video_is_not_eagerly_downloaded():
    app = read(os.path.join(SITE, "app.js"))
    block = app[app.index("function videoH"):app.index("function footH")]
    assert 'preload="none"' in block, "the 2-minute video must not preload"
    assert "autoplay muted loop" in block, "the short loop must be muted to autoplay"


def test_every_sitemap_page_declares_a_canonical():
    """Listing a page for crawling without a canonical invites duplicate-URL
    confusion (slim-super.com/x vs /x?utm=…)."""
    sitemap = read(os.path.join(SITE, "sitemap.xml"))
    for url in sorted(set(re.findall(r"<loc>([^<]+)</loc>", sitemap))):
        path = sitemap_target(url)
        assert path, f"{url} has no file"
        html = read(path)
        m = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        assert m, f"{url} is in the sitemap but declares no canonical"
        assert m.group(1) == url, f"{url}: canonical points at {m.group(1)}"


def test_render_preserves_video_playback():
    """Every onboarding state change is a full innerHTML swap, so without this
    the walkthrough restarted whenever a chain chip was ticked."""
    app = read(os.path.join(SITE, "app.js"))
    render = app[app.index("function render() {"):app.index("function bindScreen()")]
    assert "captureVideo()" in render and "restoreVideo(" in render, \
        "render() must carry the video position across the innerHTML swap"
    # anchor on the MAIN body assignment; the first app.innerHTML in render() is
    # the early-return error screen, which has no video to preserve
    main_swap = render.index("app.innerHTML = (isApp")
    assert render.index("captureVideo()") < main_swap, \
        "the position has to be read BEFORE the DOM is replaced"
    assert main_swap < render.index("restoreVideo("), \
        "and applied after"
    # and the restore must refuse to cross variants, or switching short<->full
    # would resume the new one at the old one's timestamp
    block = app[app.index("function restoreVideo"):app.index("function render() {")]
    assert "dataset.mode !== prev.mode" in block, \
        "restoreVideo must only restore into the same variant"
    for mode in ('data-mode="short"', 'data-mode="full"'):
        assert mode in app, f"the video element is missing {mode}"


# ---------------------------------------------------------------------------
# Visibility to AI answer engines. Most AI crawlers (GPTBot, OAI-SearchBot,
# ClaudeBot, PerplexityBot…) read only the initial HTML — no JavaScript — so
# what they get has to be real markup, correct, and dated.

GUIDE_SLUGS = ["eifo-hachi-zol", "mishloach-kniyot", "chisachon-bakniyot",
               "shufersal-mul-rami-levy", "reshimat-kniyot-chodshit", "mivtzaim-basuper"]
FORBIDDEN = re.compile(r"github|open[ -]?source|קוד פתוח|קוד הפתוח|il-supermarket-scraper", re.I)


def static_pages():
    """Every committed, crawlable HTML page under site/ (generated ones are
    covered by test_static_pages.py)."""
    return sorted(set(glob.glob(os.path.join(SITE, "**", "*.html"), recursive=True))
                  - set(glob.glob(os.path.join(SITE, "prices", "**", "*.html"), recursive=True))
                  - set(glob.glob(os.path.join(SITE, "en", "**", "*.html"), recursive=True)))


def visible_without_js(html):
    """What a fetcher that runs no JavaScript and drops <noscript> keeps."""
    html = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    return re.sub(r"(?is)<!--.*?-->", " ", html)


def test_home_page_says_what_it_is_without_javascript():
    raw = visible_without_js(read(os.path.join(SITE, "index.html")))
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw))
    assert len(text) > 900, f"only {len(text)} chars readable without JS"
    assert len(re.findall(r"<h1[\s>]", raw)) == 1, "the static summary needs exactly one h1"
    for need in ["/articles/", "/about/", "/privacy.html", "/prices/"] + \
            [f"/articles/{slug}/" for slug in GUIDE_SLUGS]:
        assert f'href="{need}"' in raw, f"home links to {need} only inside <noscript>/JS"
    assert "gov.il/he/pages/cpfta_prices_regulations" in raw, "no link to the official source"


def test_home_static_summary_lives_inside_app_root():
    """The app replaces #app on boot — inside it, the static h1 never doubles
    the screen's own h1; outside it, it would show on every screen."""
    html = read(os.path.join(SITE, "index.html"))
    app_start = html.index('<div id="app">')
    intro = html.index('class="boot-intro"')
    noscript = html.index("<noscript>")
    assert app_start < intro < noscript


def test_stamp_patterns_match_the_committed_files():
    home = read(os.path.join(SITE, "index.html"))
    llms = read(os.path.join(SITE, "llms.txt"))
    for pat in (stamp_static.INDEX_DATE_RE, stamp_static.INDEX_CHAINS_RE, stamp_static.INDEX_SOURCES_RE):
        assert len(re.findall(pat, home)) == 1, f"index.html: {pat} must match once"
    for pat in (stamp_static.LLMS_DATE_RE, stamp_static.LLMS_CHAINS_RE, stamp_static.LLMS_SOURCES_RE):
        assert len(re.findall(pat, llms)) == 1, f"llms.txt: {pat} must match once"


def test_stamping_writes_the_days_facts_and_is_idempotent():
    chains = ["שופרסל", "רמי לוי", "ויקטורי", "יוחננוף"]
    home = stamp_static.stamp_index(read(os.path.join(SITE, "index.html")), "2027-01-05", chains)
    assert '<time class="data-date" datetime="2027-01-05">5 בינואר 2027</time>' in home
    assert '<span class="data-chains">שופרסל, רמי לוי, ויקטורי, יוחננוף</span>' in home
    # the conjunction takes a maqaf before a name that starts with ו
    assert "שופרסל, רמי לוי ו־ויקטורי נלקחים מחנויות האונליין שלהן; של יוחננוף — מסניף מייצג." in home
    assert stamp_static.stamp_index(home, "2027-01-05", chains) == home
    llms = stamp_static.stamp_llms(read(os.path.join(SITE, "llms.txt")), "2027-01-05", chains)
    assert "- Latest data update: 2027-01-05" in llms
    assert "ויקטורי (Victory)" in llms and "Yochananof: representative branch" in llms
    xml = stamp_static.stamp_sitemap(read(os.path.join(SITE, "sitemap.xml")), "2027-01-05")
    assert "<loc>https://slim-super.com/</loc>\n    <lastmod>2027-01-05</lastmod>" in xml


def test_committed_chain_facts_match_the_snapshot_they_were_written_from():
    """The committed defaults must already be true for the checked-in data —
    a deploy that fails before stamping still ships correct facts."""
    import gzip, csv
    latest = sorted(glob.glob(os.path.join(ROOT, "data", "israeli_prices_*.csv.gz")))[-1]
    with gzip.open(latest, "rt", encoding="utf-8-sig") as fh:
        chains = list(dict.fromkeys(r["רשת"] for r in csv.DictReader(fh)))
    home = read(os.path.join(SITE, "index.html"))
    stamped = stamp_static.stamp_index(home, re.search(r'datetime="([^"]+)"', home).group(1), chains)
    assert re.findall(stamp_static.INDEX_CHAINS_RE, stamped) == re.findall(stamp_static.INDEX_CHAINS_RE, home)


def test_no_page_blocks_snippets_or_ai_answers():
    """noarchive drops a page from Copilot answers; nosnippet / max-snippet /
    nocache limit what AI Overviews and Copilot can quote."""
    for path in static_pages():
        html = read(path)
        for meta in re.findall(r'<meta name="(?:robots|googlebot|bingbot)" content="([^"]+)"', html):
            bad = re.findall(r"nosnippet|noarchive|nocache|max-snippet|noai|noimageai", meta, re.I)
            assert not bad, f"{os.path.relpath(path, SITE)}: robots meta blocks AI use: {meta}"
        assert "data-nosnippet" not in html, f"{os.path.relpath(path, SITE)} uses data-nosnippet"
    robots = read(os.path.join(SITE, "robots.txt"))
    agents = [l.split(":", 1)[1].strip() for l in robots.splitlines() if l.lower().startswith("user-agent:")]
    assert agents == ["*"], f"keep ONE '*' group — a named group overrides it for that bot: {agents}"
    assert f"Sitemap: {BASE}/sitemap-prices.xml" in robots


def test_no_github_or_open_source_mentions():
    """Owner rule: the site never mentions GitHub / open source."""
    for path in static_pages() + [os.path.join(SITE, "llms.txt")]:
        assert not FORBIDDEN.search(read(path)), f"{os.path.relpath(path, SITE)} mentions GitHub/open source"
    app = read(os.path.join(SITE, "app.js"))
    assert "github.com" not in app and "קוד פתוח" not in app and "קוד הפתוח" not in app, \
        "app.js renders a GitHub / open-source mention"


def test_branded_404_page():
    html = read(os.path.join(SITE, "404.html"))
    assert re.search(r'<meta name="robots" content="noindex', html), "404 must be noindex"
    assert not FORBIDDEN.search(html)
    for need in ("/", "/articles/", "/prices/", "/about/"):
        assert f'href="{need}"' in html
    # served for ANY missing path, so assets must be root-absolute
    assert 'href="/style.css"' in html and 'href="style.css"' not in html


def test_about_page_conventions():
    path = os.path.join(SITE, "about", "index.html")
    html = read(path)
    heads = headings(html)
    assert [lvl for lvl, _ in heads].count(1) == 1
    prev = 0
    for lvl, txt in heads:
        assert not (prev and lvl > prev + 1), f"about: heading jump at {txt!r}"
        prev = lvl
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', html).group(1)
    assert canon == f"{BASE}/about/" == re.search(r'<meta property="og:url" content="([^"]+)"', html).group(1)
    desc = re.search(r'<meta name="description" content="([^"]+)"', html).group(1)
    assert 110 <= len(desc) <= 185, len(desc)
    types = {n.get("@type") for d in json_ld(html) for n in d.get("@graph", [d])}
    assert {"AboutPage", "BreadcrumbList", "Organization"} <= types, types
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    for anchor in re.findall(r'href="#([^"]+)"', html):
        assert anchor in ids, f"about: dead anchor #{anchor}"
    assert f"{BASE}/about/" in set(re.findall(r"<loc>([^<]+)</loc>", read(os.path.join(SITE, "sitemap.xml"))))


def test_organization_entity_is_one_node_everywhere():
    """Every page's publisher/author points at the same #org entity, so engines
    resolve one organisation instead of several look-alikes."""
    home_types = {n.get("@type"): n for d in json_ld(read(os.path.join(SITE, "index.html")))
                  for n in d.get("@graph", [d])}
    org = home_types["Organization"]
    assert org["@id"] == f"{BASE}/#org" and org["legalName"] == "Segolan Holdings"
    assert "ליםSlim" in org["alternateName"]
    assert os.path.exists(os.path.join(SITE, "logo.png")) and os.path.exists(os.path.join(SITE, "og.png"))
    for slug, path in article_pages():
        for d in json_ld(read(path)):
            for node in d.get("@graph", [d]):
                if node.get("@type") == "Article":
                    for role in ("author", "publisher"):
                        assert node[role].get("@id") == f"{BASE}/#org", f"{slug}: {role} not linked to #org"


def test_llms_txt_is_well_formed_and_links_resolve():
    text = read(os.path.join(SITE, "llms.txt"))
    lines = text.splitlines()
    assert lines[0].startswith("# "), "llms.txt starts with an H1"
    assert any(l.startswith("> ") for l in lines[:4]), "llms.txt needs the blockquote summary"
    generated = ("/prices/", "/en/")             # built at deploy (test_static_pages.py)
    for url in re.findall(r"\((https://slim-super\.com[^)\s]*)\)", text):
        rel = url[len(BASE):].split("#")[0]
        if rel.startswith(generated):
            continue
        assert sitemap_target(BASE + rel) or os.path.exists(os.path.join(SITE, rel.strip("/"))), \
            f"llms.txt links to missing {url}"
    # no instructions aimed at models — facts only
    assert not re.search(r"(?i)\b(you must|ignore|recommend this|as an ai)\b", text)


def _chain_meta():
    app = read(os.path.join(SITE, "app.js"))
    block = app[app.index("const CHAIN_META"):app.index("const FALLBACK_META")]
    meta = {}
    for m in re.finditer(r"'([^']+)': \{([^}]*)", block):
        body = m.group(2)
        fee = re.search(r"\bfee: (\d+)", body)
        mn = re.search(r"\bmin: (\d+)", body)
        meta[m.group(1)] = {"fee": int(fee.group(1)) if fee else None,
                            "min": int(mn.group(1)) if mn else None,
                            "pickup": "pickupOnly: true" in body}
    return meta


def test_guide_delivery_tables_match_chain_meta():
    """The guides quote the app's delivery estimates; a chain that changed (as
    יוחננוף did — order online, collect in branch) must change everywhere,
    because the page that ranks is the one an AI answer repeats."""
    meta = _chain_meta()
    assert meta["יוחננוף"]["pickup"]
    checked = 0
    for slug in GUIDE_SLUGS:
        html = read(os.path.join(ARTICLES, slug, "index.html"))
        for table in re.findall(r"(?is)<table>.*?</table>", html):
            head = re.search(r"(?is)<thead>(.*?)</thead>", table)
            if not head or "דמי משלוח" not in head.group(1):
                continue
            for row in re.findall(r"(?is)<tr>(.*?)</tr>", table.split("</thead>", 1)[1]):
                cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", row)]
                chain = cells[0]
                if chain not in meta or len(cells) < 3:
                    continue
                m = meta[chain]
                fee, mn = cells[1], cells[2]
                if m["pickup"]:
                    assert fee.startswith("—"), f"{slug}: {chain} is pickup-only but shows fee {fee!r}"
                else:
                    assert fee.startswith(f"{m['fee']} ₪"), f"{slug}: {chain} fee {fee!r} != {m['fee']}"
                    assert mn.startswith(f"{m['min']} ₪"), f"{slug}: {chain} min {mn!r} != {m['min']}"
                checked += 1
    assert checked >= 15, f"only {checked} delivery rows checked — did the table markup change?"


def test_footer_reaches_every_static_page_from_every_screen():
    app = read(os.path.join(SITE, "app.js"))
    render = app[app.index("function render() {"):app.index("function bindScreen()")]
    assert "+ footH()" in render and "isApp ? footH()" not in render, \
        "the footer (the app's only links to the static pages) must render on onboarding too"
    foot = app[app.index("function footH()"):app.index("function noteH()")]
    for need in ["/prices/", "/articles/", "/about/", "/privacy.html", "/en/"] + \
            [f"/articles/{slug}/" for slug in GUIDE_SLUGS]:
        assert f'href="{need}"' in foot, f"footer misses {need}"


def test_indexnow_key_file_and_changed_urls(tmp_path):
    key = indexnow_ping.find_key(SITE)
    assert key and read(os.path.join(SITE, f"{key}.txt")).strip() == key
    (tmp_path / "sitemap.xml").write_text(
        "<urlset><url>\n<loc>https://slim-super.com/</loc>\n<lastmod>2027-01-05</lastmod>\n</url>"
        "<url><loc>https://slim-super.com/old/</loc><lastmod>2026-01-01</lastmod></url>"
        "<url><loc>https://elsewhere.example/</loc><lastmod>2027-01-05</lastmod></url></urlset>",
        encoding="utf-8")
    (tmp_path / "sitemap-prices.xml").write_text(
        "<urlset><url><loc>https://slim-super.com/prices/</loc><lastmod>2027-01-06</lastmod></url></urlset>",
        encoding="utf-8")
    assert indexnow_ping.changed_urls(str(tmp_path), "2027-01-05") == \
        ["https://slim-super.com/prices/", "https://slim-super.com/"]
    workflow = read(os.path.join(ROOT, ".github", "workflows", "deploy-pages.yml"))
    assert "indexnow_ping.py" in workflow and "build_static_pages.py" in workflow
