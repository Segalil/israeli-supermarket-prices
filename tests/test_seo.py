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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
ARTICLES = os.path.join(SITE, "articles")
BASE = "https://slim-super.com"


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
    """deploy-pages.yml rewrites the home <lastmod> with the snapshot date.

    It matches on this exact shape, so a reformat of sitemap.xml would break the
    stamp. Keep the pattern here identical to the one in the workflow.
    """
    pattern = r"(<loc>https://slim-super\.com/</loc>\s*<lastmod>)[^<]+"
    sitemap = read(os.path.join(SITE, "sitemap.xml"))
    assert len(re.findall(pattern, sitemap)) == 1, \
        "home <loc>/<lastmod> pair not in the shape deploy-pages.yml stamps"

    workflow = read(os.path.join(ROOT, ".github", "workflows", "deploy-pages.yml"))
    assert pattern in workflow, \
        "deploy-pages.yml no longer stamps the sitemap with this exact pattern"


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
