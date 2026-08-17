# -*- coding: utf-8 -*-
"""The extension's barcode handling on the chains' own sites.

Shufersal's search key is its INTERNAL product code. For most items that equals
the EAN, but for a legacy family it is a short number instead, and the
transparency file publishes the full EAN either way — so searching the barcode
returned nothing for those products. Verified live before the fix:
text=7290000066295 produced no tiles, text=66295 returned "במבה מתוקה בטעם תות".
"""
import json
import os
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PANEL = os.path.join(ROOT, "extension", "panel.js")


@pytest.fixture(scope="module")
def out():
    proc = subprocess.run(["node", os.path.join(HERE, "ext_chain_harness.js")],
                          capture_output=True, text=True, cwd=HERE)
    if proc.returncode != 0:
        pytest.fail(f"harness failed:\n{proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def test_legacy_barcodes_get_a_short_alternative(out):
    assert out["altCodes"]["legacyFamily"] == ["66295"], \
        "7290000066295 must also be searched as 66295"


def test_short_alternatives_below_four_digits_are_refused(out):
    """"22" stops being a code lookup and becomes a text search — Shufersal
    answers it with מוצרלה 22% and "22 chic לק עמיד"."""
    assert out["altCodes"]["tooShortToBeSafe"] == []
    assert out["altCodes"]["threeDigits"] == []


def test_ordinary_barcodes_are_left_alone(out):
    """The EAN already works for 13,045 of Shufersal's 13,953 barcoded rows;
    the alternative must never fire for them."""
    for key in ("normalBarcode", "otherIsraeliPrefix", "notThirteenDigits", "garbage"):
        assert out["altCodes"][key] == [], f"{key} should get no alternative"


def test_tile_code_reads_the_internal_code(out):
    t = out["tileCode"]
    assert t["onSelf"] == "66295", "the P_ prefix must be stripped"
    assert t["nested"] == "7290019014614"
    assert t["noPrefix"] == "66295"
    assert t["absent"] is None


def test_every_adapter_still_meets_the_panel_contract(out):
    for name, c in out["contract"].items():
        assert c["label"] and c["searchUrl"] and c["tiles"], f"{name} lost a required field"
    # the optional hooks are opt-in; only the chain that needs them declares them
    assert out["contract"]["shufersal.js"]["altCodes"]
    assert out["contract"]["shufersal.js"]["tileCode"]


def test_panel_walks_the_term_ladder_and_verifies_the_tile():
    panel = open(PANEL, encoding="utf-8").read()
    assert "function searchTerms(" in panel, "the term ladder is gone"
    assert "cfg.altCodes" in panel, "the panel no longer consults altCodes"
    assert "function pickTile(" in panel, "tile verification is gone"
    # a chain that exposes no code must keep the old first-tile behaviour
    assert "if (typeof cfg.tileCode !== 'function') return tiles[0];" in panel
    # and a mismatch must refuse rather than add the wrong product
    assert "return sawAnyCode ? null : tiles[0];" in panel


def test_panel_prefers_the_chain_code_and_guards_the_name_step():
    panel = open(PANEL, encoding="utf-8").read()
    block = panel[panel.index("function searchTerms("):]
    block = block[:block.index("\n  }") + 4]
    assert block.index("item.code") < block.index("item.ean"), \
        "the chain's own code must be tried before the generic EAN"
    assert "function nameMatchesTile(" in panel, "the name-step guard is gone"
    assert "onNameStep && typeof cfg.tileCode !== 'function'" in panel, \
        "the guard must apply exactly where nothing else verifies the tile"
