# -*- coding: utf-8 -*-
"""Product-image ladder: chain CDN by EAN first, OpenFoodFacts second.

Measured 2026-10-07 over 120 random catalogue barcodes: OFF had an image for 1%
of them, רמי לוי's public product CDN for 52% — so the CDN runs first and OFF is
only consulted when every CDN candidate errors. The node harness replays the
real resolveImage() with stubbed Image/fetch; the string tests pin the wiring
that the harness cannot see (slot markup, cache versioning, referrer policy).
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "site", "app.js")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def test_image_ladder_behaviour():
    r = subprocess.run(["node", os.path.join(ROOT, "tests", "images_harness.js")],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout, r.stdout


def test_image_requests_never_announce_the_site():
    """Hotlink-shyness and privacy both want no Referer on image hosts."""
    app = read(APP)
    assert app.count("referrerPolicy = 'no-referrer'") >= 2, \
        "both the probe Image() and the slot <img> must send no referrer"


def test_stale_all_none_cache_is_dropped():
    """v1 caches predate the chain CDN and say 'none' for half the catalogue;
    keeping them would hide every image the CDN can now serve."""
    app = read(APP)
    assert "localStorage.removeItem('slim-img-cache-v1')" in app
    assert "slim-img-cache-v2" in app
    assert "setItem('slim-img-cache-v1'" not in app


def test_disclosures_name_the_chain_cdn():
    """Terms (in-app) and privacy.html must say where images load from."""
    app = read(APP)
    assert "משירותי התמונות הציבוריים של" in app, "terms no longer disclose the chain CDNs"
    privacy = read(os.path.join(ROOT, "site", "privacy.html"))
    assert "שירותי התמונות הציבוריים של הרשתות" in privacy
    assert "Open Food Facts" in privacy
