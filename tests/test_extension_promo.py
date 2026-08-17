# -*- coding: utf-8 -*-
"""The Chrome Web Store promo on the site.

Chrome Web Store extensions install on desktop Chromium browsers and nowhere
else — not Safari, not Firefox, and not Chrome on Android or iOS, which have no
extension support at all. Offering the install anywhere else is a dead end, and
it cannot be checked by driving a Chromium test runner with a spoofed user
agent (the engine still reports Chromium in navigator.userAgentData), so the
check takes an injectable navigator and is exercised directly.
"""
import json
import os
import re
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.join(ROOT, "site", "app.js")


@pytest.fixture(scope="module")
def out():
    proc = subprocess.run(["node", os.path.join(HERE, "ext_harness.js")],
                          capture_output=True, text=True, cwd=HERE)
    if proc.returncode != 0:
        pytest.fail(f"harness failed:\n{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def test_offered_on_desktop_chromium(out):
    c = out["cases"]
    assert c["chromeWithHints"], "desktop Chrome reporting userAgentData"
    assert c["chromeUaOnly"], "desktop Chrome without the hints API"
    assert c["edgeUaOnly"] and c["braveUaOnly"], "other desktop Chromium browsers"


def test_hidden_where_it_cannot_be_installed(out):
    c = out["cases"]
    for key in ("safari", "firefox", "androidChromeHints", "androidChromeUaOnly",
                "iphoneSafari", "ipadSafari", "chromeOnIOS", "empty"):
        assert c[key] is False, f"the promo must not be offered to {key}"


def test_store_url_is_the_published_listing(out):
    url = out["url"]
    assert url, "EXTENSION_URL is still empty"
    assert url.startswith("https://chromewebstore.google.com/detail/"), url
    # the id Google assigned; the bare /detail/<id> form redirects to the slug
    assert re.fullmatch(r"[a-p]{32}", url.rsplit("/", 1)[-1]), \
        f"not a Chrome extension id: {url}"


def test_no_personal_params_shipped():
    """The dashboard hands you ?authuser=…&hl=…; authuser identifies the signed-in
    Google account and must never appear in a public page."""
    app = open(APP, encoding="utf-8").read()
    urls = re.findall(r"https://chromewebstore\.google\.com[^\s'\"`)]*", app)
    assert urls, "no Chrome Web Store URL in the site"
    for u in urls:
        assert "authuser" not in u, f"an authuser param leaked into {u}"
        assert "hl=" not in u, f"a forced-locale param leaked into {u}"


def test_promo_is_gated_in_every_render_path():
    app = open(APP, encoding="utf-8").read()
    block = app[app.index("function extensionPromoH"):]
    block = block[:block.index("\n}")]
    assert "canInstallExtension()" in block, \
        "extensionPromoH must consult canInstallExtension before rendering"
    assert "hasExtension()" in block, "and still hide itself once installed"


def test_handoff_sends_the_target_chains_own_code(out):
    """A merged product carries every source key as an alias; the code the
    TARGET chain files it under must win over another chain's EAN. Rami Levy's
    own site resolves its banana as 134, not as Shufersal's 7290000964775."""
    codes = out["codes"]
    assert codes["ramiLevy"] == "134"
    assert codes["yochananof"] == "623"
    assert codes["shufersal"] == "7290000964775", "no scoped alias -> fall back to the EAN"
    assert codes["nameScopedIgnored"] is None, "a name-keyed scoped alias is not a code"
    assert codes["noCodeAtAll"] is None
