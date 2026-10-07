# -*- coding: utf-8 -*-
"""The pre-filled list link: https://slim-super.com/#/add/<barcode>,<barcode>*N.

Static price pages, /en/ and llms.txt hand it out, so an answer engine can give
a shopper a link that opens the comparison with the products already listed.
"""
import json
import os
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(scope="module")
def out():
    proc = subprocess.run(["node", os.path.join(HERE, "add_link_harness.js")],
                          capture_output=True, text=True, cwd=HERE)
    if proc.returncode != 0:
        pytest.fail(proc.stderr[-2000:])
    return json.loads(proc.stdout)


def test_adds_products_with_quantities(out):
    assert out["basic"]["list"] == [["7290004131074", 1], ["7290000066318", 2]]
    assert out["basic"]["replaced"] == "#/build", "replace(), so Back does not re-add"
    assert "2 מוצרים נוספו" in out["basic"]["note"]


def test_leading_zeros_and_merge_aliases_resolve(out):
    assert out["leadingZeros"]["list"] == [["7290004131074", 1]]
    assert out["alias"]["list"] == [["n:x|g1000.0", 3]], "an alias lands on the merged product"


def test_unknown_codes_are_reported_not_fatal(out):
    assert out["missing"]["list"] == [["7290004131074", 1]]
    assert "לא נמצא" in out["missing"]["note"]


def test_quantity_is_clamped_and_a_repeat_click_does_not_double(out):
    assert out["clampQty"]["list"] == [["7290004131074", 99]]
    assert out["noDouble"] == [["7290004131074", 5]]


def test_link_visitor_is_marked_seen_and_the_note_is_revealed(out):
    assert out["seeded"] is True, "no sample basket later for someone who came via a link"
    assert out["revealNote"] is True


def test_link_items_survive_a_later_cloud_pull(out):
    assert out["afterPull"] == [["7290004131074", 1], ["7290000066318", 2]]
    assert out["afterPullAgain"] == out["afterPull"]
