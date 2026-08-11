# -*- coding: utf-8 -*-
"""Search-box ranking (suggestMatches in site/app.js).

A multi-word query used to be tested as one contiguous run of characters, so
"3% חלב תנובה" and "פרוס לחם אחיד" returned nothing while the product sat in the
catalogue. Per-token matching is APPENDED below every contiguous match, which is
what makes it safe: it can only add rows, never reorder or drop what the search
already returned. These tests pin that property.
"""
import json
import os
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "search_harness.js")


@pytest.fixture(scope="module")
def out():
    proc = subprocess.run(["node", HARNESS], capture_output=True, text=True, cwd=HERE)
    if proc.returncode != 0:
        pytest.fail(f"harness failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def test_contiguous_match_set_is_untouched(out):
    broken = {q: v for q, v in out["appendOnly"].items() if not v["sameContiguousSet"]}
    assert not broken, f"token matching changed which products match: {broken}"


def test_contiguous_matches_always_rank_first(out):
    """Scoring token-only hits from 6 up is what makes this additive: they can
    never push a product the search already returned out of the visible eight."""
    broken = {q: v for q, v in out["appendOnly"].items() if not v["contiguousRankFirst"]}
    assert not broken, f"a token-only match outranked a contiguous one: {broken}"


def test_single_word_queries_are_untouched(out):
    for q, v in out["appendOnly"].items():
        if " " not in q:
            assert v["countBefore"] == v["countAfter"], \
                f"single-word query {q!r} changed: {v}"


def test_real_milk_outranks_socalled_milk(out):
    """חלב ranks actual milk above חלבה above סחלב.

    nameTier's bottom rung is a raw substring match, so סחלב/חלבה DO appear —
    that predates per-token matching and is unchanged by it. What the ranking
    guarantees is that they never outrank a real word match.
    """
    milk = out["singleWordUnchanged"]["milk"]
    assert milk.index("חלב תנובה 3% שומן 1 ליטר") < milk.index("חלבה בטעם וניל")
    assert milk.index("חלבה בטעם וניל") < milk.index("סחלב מוכן 250 מל")


def test_generic_product_still_leads(out):
    assert out["singleWordUnchanged"]["cucumberTop"] == "מלפפון"


def test_word_order_no_longer_matters(out):
    wo = out["wordOrder"]
    assert wo["reversed"] > 0, "a reordered query used to return nothing"
    assert wo["reversedFinds"], "the product must be found whatever the word order"
    assert "לחם אחיד פרוס 750 גרם" in wo["breadReversed"]


def test_a_brand_never_satisfies_a_token(out):
    """אסם is only in the bamba's brand field; matching it there would let an
    unrelated product answer a query that names a brand it does not print."""
    hits = out["brandNeverSatisfiesAToken"]["bambaByBrand"]
    assert "במבה חטיף בוטנים 80 גרם" not in hits


def test_barcode_path_untouched(out):
    code = out["codePathUntouched"]
    assert code["exact"] == ["חלב תנובה 3% שומן 1 ליטר"]
    assert code["prefix"] >= 1


def test_a_single_token_never_enters_the_token_path(out):
    assert out["singleTokenNeverUsesTokenPath"]["nonsense"] == 0


def test_pack_tag_reads_real_packs_only(out):
    """A number times a number is a pack only when the unit corroborates it —
    "45*32 גרם" filed as a 45 g bag is a print order, not 45 bags."""
    tags = out["packTags"]
    assert tags["sixPackWord"] == 6
    assert tags["sixPackTimes"] == 6
    assert tags["sixPackContainer"] == 6
    assert tags["singleBottle"] is None
    assert tags["dimensionsNotAPack"] is None
    assert tags["gauzeNotAPack"] is None
    assert tags["bagelShapeNotAPack"] is None, "שמיניות is a pretzel shape here"
    assert tags["countWordBeatsDimensions"] == 2, "זוג wins over the 40*60 cm"


def test_pack_words_in_a_query(out):
    t = out["packTerms"]
    assert t["shishiya"] == t["shishiyaOneYod"] == t["shishiyat"] == t["shishiyot"] == 6
    assert t["friday"] is None, "a bare שישי is Friday, not a six-pack"
    assert t["maaraz"] == -1        # PACK_ANY
    assert t["tersar"] == 12
    assert t["milk"] is None


def test_a_six_pack_is_found_however_it_is_spelled(out):
    s = out["packSearch"]
    for label in ("byWord", "byOneYod", "byConstruct"):
        hits = s[label]
        assert any("6*330" in h for h in hits), f"{label} missed the 6*330 listing"
        assert any("מארז 6" in h for h in hits), f"{label} missed the מארז 6 listing"
    assert any("מארז 6" in h or "6*330" in h for h in s["byContainer"])


def test_asking_for_a_pack_does_not_return_the_single(out):
    assert not out["packSearch"]["singleBottleNotOffered"], \
        "a shopper asking for a six-pack must not be handed the 1.5L bottle"
