# -*- coding: utf-8 -*-
"""The client re-derives package size from the display unit string; the Python
pipeline derives it again when merging. They must not drift, so run both over
the same inputs and compare.
"""
import json
import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from israeli_prices.basket import unit_signature

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "unit_sig_harness.js")

UNITS = [
    '1 ק"ג', "1 קילוגרם", "1000 גרם", "1.2 קילוגרם", "1200 גרם", "500 גרם",
    "250 ג", "250 ג'", "1 ליטר", '1000 מ"ל', "1.5 ליטר", "330 מיליליטר",
    "1 יחידות", "1 יח'", "1 יחידה", "6 יחידות", "0 יחידות", "", "   ",
    "1 קרטון", "12 מארז", "מארז", "460 גרם", "9 ליטר", "10.5 ליטר",
    "1.98 ליטר", "748 גרם", "1.75 ליטר", "2 לי", "משהו לא מוכר",
]


def run_js(units):
    proc = subprocess.run(
        ["node", HARNESS, json.dumps(units, ensure_ascii=False)],
        capture_output=True, text=True, cwd=HERE,
    )
    if proc.returncode != 0:
        pytest.fail(f"harness failed: {proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


@pytest.mark.skipif(not os.path.exists(HARNESS), reason="harness missing")
def test_js_unit_sig_matches_python():
    result = run_js(UNITS)
    js = result["sigs"]
    assert len(js) == len(UNITS)
    mismatches = []
    for unit, got in zip(UNITS, js):
        want = unit_signature(unit)
        want_js = None if want is None else [want[0], want[1]]
        if got != want_js:
            mismatches.append(f"{unit!r}: python={want_js} js={got}")
    assert not mismatches, "unitSig drifted from unit_signature:\n  " + "\n  ".join(mismatches)


def test_equivalent_sizes_agree_in_both():
    for a, b in [('1 ק"ג', "1 קילוגרם"), ('1 ק"ג', "1000 גרם"),
                 ("1.2 קילוגרם", "1200 גרם"), ("1 ליטר", '1000 מ"ל')]:
        assert unit_signature(a) == unit_signature(b)
    js = run_js(['1 ק"ג', "1 קילוגרם", "1000 גרם", "1 ליטר", '1000 מ"ל'])["sigs"]
    assert js[0] == js[1] == js[2]
    assert js[3] == js[4]


def test_per_unit_price_is_per_kilo_litre_piece():
    per = run_js([])["perUnit"]
    assert per["g500"] == pytest.approx(20.0)   # 10 ₪ / 0.5 kg
    assert per["l2"] == pytest.approx(5.0)      # 10 ₪ / 2 l
    assert per["unit1"] == pytest.approx(10.0)
