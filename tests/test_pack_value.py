# -*- coding: utf-8 -*-
"""The basket's "same product, better-value pack" suggestion.

A loose similarity rule was measured against the real catalogue and proposed
swapping oatmeal for penne, so the rule is deliberately narrow: the two products
must be the same item with the pack size removed from the name, priced in the
same chain, in the same unit kind, and the winner is decided on price per
kilo/litre/piece. These tests pin every one of those guards.
"""
import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "value_harness.js")


@pytest.fixture(scope="module")
def cases():
    proc = subprocess.run(["node", HARNESS], capture_output=True, text=True, cwd=HERE)
    if proc.returncode != 0:
        pytest.fail(f"harness failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def test_identity_drops_pack_size_not_variants(cases):
    ident = cases["identity"]
    # 1.5L and 2L of one drink are the same product in a different bottle
    assert ident["cola15"] == ident["cola2"]
    # a number that is NOT a size stays, so sizes 2 and 3 never merge
    assert ident["size3"] != ident["size2"]
    # different products keep different identities
    assert ident["coffee6"] != ident["coffeeDecaf"]
    # a single-token name is too weak to be an identity
    assert ident["oneWord"] is None


def test_bigger_pack_wins_on_price_per_litre(cases):
    b = cases["biggerBottleWins"]
    assert b, "the 2L bottle should beat the 1.5L one per litre"
    assert b["alt"] == "big"
    assert b["minePerUnit"] == pytest.approx(8.0)    # 12 ₪ / 1.5 l
    assert b["altPerUnit"] == pytest.approx(6.5)     # 13 ₪ / 2 l
    assert b["gainPct"] == 19
    assert b["label"] == "לליטר"


def test_a_different_product_is_never_offered(cases):
    assert cases["differentProductRejected"], "oatmeal must not be swapped for penne"


def test_same_size_is_not_a_better_pack(cases):
    assert cases["sameSizeRejected"]


def test_absurd_size_jump_rejected(cases):
    assert cases["absurdRatioRejected"], "a 1kg bag must not be answered with 25kg"


def test_marginal_gain_rejected(cases):
    assert cases["tinyGainRejected"]


def test_product_already_in_the_list_not_offered(cases):
    assert cases["alreadyInListRejected"]


def test_offer_is_per_chain(cases):
    per_chain = cases["otherChainOnly"]
    assert per_chain["shufersal"], "no offer where the bigger pack is not sold"
    assert per_chain["ramiLevy"], "offer where it is sold"
