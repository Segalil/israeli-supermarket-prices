# -*- coding: utf-8 -*-
"""Saved lists survive catalogue changes.

A list stores product keys, and keys retire: barcodes are relisted, chain-scoped
codes leave with a chain's file, "n:" merge keys dissolve. Loading used to drop
every unknown key silently, so an older list came back half empty. These tests
pin the replacement mechanism (resolveListEntries + the #/relink review in
site/app.js, retired_names in basket.py) and the cloud-pull fix that stopped a
quick reload from reverting a freshly saved list.
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from israeli_prices.basket import (  # noqa: E402
    build_site_data,
    known_keys,
    load_snapshot_rows,
    name_signature,
    product_key,
    retired_names,
)

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "relink_harness.js")

TRICKY_NAMES = [
    "חלב תנובה 3% 1 ליטר", "3% חלב תנובה", 'קמח תופח 1 ק"ג סוגת', "כוסמת 500 ג",
    "כוסמת 500 גרם", "קוטג׳ תנובה 5%", "ג'ילט סירייס קצף גילוח", "שום קלוף ארוז 500 גר`",
    "Fifa תפוציפס טבעי 200 ג", "מחפוד-כרעיים קפוא", "פיוז-טי זירו ליצי 1.5 ל",
    "דאו ספריי אקס 24/7 1", "אבקת רוטב צלי כשל\"פ 22 ג", "שיפודי עץ במבוק 30 ס\"מ (80 יח') 0.4",
    "", "   ", "!!!",
]


def _real_names(limit=4000):
    paths = sorted(glob.glob(os.path.join(ROOT, "data", "israeli_prices_*.csv*")))
    if not paths:
        return []
    names = []
    for r in load_snapshot_rows(paths[-1]):
        if r.get("item_name"):
            names.append(r["item_name"])
        if len(names) >= limit:
            break
    return names


@pytest.fixture(scope="module")
def run():
    names = TRICKY_NAMES + _real_names()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False)
        path = fh.name
    try:
        proc = subprocess.run(["node", HARNESS, path], capture_output=True, text=True, cwd=HERE)
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        pytest.fail(f"harness failed:\n{proc.stderr[-3000:]}")
    return names, json.loads(proc.stdout)


@pytest.fixture(scope="module")
def cases(run):
    return run[1]


# -- the n: keys the pipeline writes are what the client re-derives ----------

def test_js_name_signature_matches_python(run):
    names, out = run
    assert len(out["sigs"]) == len(names)
    drift = [f"{n!r}: python={name_signature(n)!r} js={js!r}"
             for n, js in zip(names, out["sigs"]) if name_signature(n) != js]
    assert not drift, "nameSig drifted from name_signature:\n  " + "\n  ".join(drift[:20])


# -- resolution tiers ----------------------------------------------------------

def test_alias_key_resolves_to_the_merged_product(cases):
    first = cases["resolve"][0]
    assert first == {"how": "ok", "to": "merged", "qty": 2, "label": None}


def test_dissolved_merge_key_swaps_to_its_member(cases):
    r = cases["resolve"][1]
    assert r["how"] == "auto" and r["to"] == "7290000000031"


def test_a_size_that_no_longer_exists_is_never_auto_swapped(cases):
    # "חלב תנובה 3%" exists in 1 and 2 litres, the saved key said 1.5
    assert cases["resolve"][2]["how"] == "review"


def test_pre_size_merge_key_resolves_only_when_one_size_exists(cases):
    assert cases["resolve"][3]["how"] == "review"           # במבה: 80g and 25g
    assert cases["oldFormatSingle"][0]["how"] == "auto"     # קוטג׳: one size only
    assert cases["oldFormatSingle"][0]["to"] == "7290000000055"


def test_snapshot_finds_a_relisted_product_and_keeps_qty(cases):
    r = cases["resolve"][4]
    assert r == {"how": "auto", "to": "7290000000055", "qty": 3, "label": "קוטג׳ תנובה 5%"}


def test_unknown_items_are_kept_for_review_not_dropped(cases):
    rest = cases["resolve"][5:]
    assert [r["how"] for r in rest] == ["review", "review"]   # null / garbage skipped
    assert 'מק"ט 7290000000888' in rest[0]["label"]
    assert 'מק"ט 1234' in rest[1]["label"]                    # chain prefix stripped


def test_merge_signature_matches_pipeline_format(cases):
    assert cases["mergeSig"] == name_signature("חלב תנובה 3% 1 ליטר")


def test_legacy_bare_key_is_named_from_the_retired_map(cases):
    assert cases["retired"][0]["how"] == "auto"
    assert cases["retired"][0]["to"] == "7290000000055"


# -- review candidates -----------------------------------------------------------

def test_brand_outweighs_generic_words(cases):
    # eight brushes share "מברשת שיניים … רכה"; the brand is what identifies it
    s = cases["sensodyne"]
    assert s["first"] == "7290000000109"
    assert s["chosen"] == "7290000000109"


def test_category_guard_keeps_milk_and_chocolate_apart(cases):
    assert cases["milkChoc"]["chosen"] == "7290000000086"
    assert "7290000000093" not in cases["milkChoc"]["cands"]   # plain milk, other aisle


def test_weak_match_is_offered_but_not_preselected(cases):
    p = cases["plainMilk"]
    assert p["first"] == "7290000000093"
    assert p["chosen"] is None


# -- flows -------------------------------------------------------------------------

def test_fully_resolvable_list_loads_directly_and_heals(cases):
    d = cases["direct"]
    assert d["relink"] is None and d["hash"] == "#/build"
    assert d["list"] == [["merged", 2], ["7290000000055", 1]]
    assert [e[0] for e in d["healed"]] == ["merged", "7290000000055"]
    assert all(len(e) == 5 for e in d["healed"]), "healed items carry their snapshot"
    assert "מוצר אחד עודכן" in d["note"]


def test_review_flow_applies_picks_and_skips(cases):
    assert cases["review"]["hash"] == "#/relink"
    assert cases["reviewHtml"]
    rows = cases["review"]["rows"]
    assert rows[0]["chosen"] == "7290000000109"
    assert rows[1]["chosen"] is None
    c = cases["reviewCommitted"]
    assert c["list"] == [["7290000000062", 1], ["7290000000109", 2]]
    assert c["healed"] == ["7290000000062", "7290000000109"]
    assert "דולג" in c["note"]


def test_restore_keeps_orphans_through_a_save(cases):
    r = cases["restored"]
    assert r["list"] == [["7290000000062", 1], ["7290000000055", 2]]
    assert [o[0] for o in r["orphans"]] == ["7290000000333"]
    # persistList writes the orphan back — a reload must never lose an item
    assert [e[0] for e in cases["persisted"]] == ["7290000000062", "7290000000055", "7290000000333"]


def test_items_are_stored_with_a_snapshot(cases):
    assert cases["snap"] == ["7290000000062", 3, "במבה אוסם", "80 גרם", 6]
    # backfill upgrades resolvable legacy items; an unknown one is left as-is
    assert cases["backfilled"] == [["7290000000062", 1, "במבה אוסם", "80 גרם", 6], ["gone", 1]]


# -- cloud sync: a quick reload must not revert a just-saved list --------------

def test_unpushed_local_edit_beats_older_cloud_copy(cases):
    assert cases["pullLocalNewer"] == {"list": [["7290000000062", 4]], "pushed": True}


@pytest.mark.parametrize("case", ["pullCloudNewer", "pullPushedAlready",
                                  "pullOtherAccount", "pullGuest"])
def test_cloud_copy_wins_otherwise(cases, case):
    assert cases[case] == {"list": [["7290000000079", 1]], "pushed": False}


def test_boot_time_saves_are_not_user_edits(cases):
    assert cases["dirtyBeforePull"] is None
    assert cases["dirtyAfterPull"] is True


# -- retired names (pipeline side) ---------------------------------------------

def _row(chain, barcode, name, price="5", qty="1", unit="ליטר"):
    return {"chain": chain, "barcode": barcode, "item_name": name, "price": price,
            "quantity": qty, "unit_qty": unit, "unit_of_measure": ""}


def _write(tmp, date, rows):
    import csv
    import gzip

    from israeli_prices.basket import HEB_TO_COL
    col_heb = {v: k for k, v in HEB_TO_COL.items()}
    path = os.path.join(tmp, f"israeli_prices_{date}.csv.gz")
    cols = list(rows[0])
    with gzip.open(path, "wt", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([col_heb[c] for c in cols])
        for r in rows:
            w.writerow([r[c] for c in cols])
    return path


def test_retired_names_lists_only_keys_today_lacks(tmp_path):
    old = _write(str(tmp_path), "2026-08-01", [
        _row("שופרסל", "7290000000017", "חלב תנובה 3% ישן"),
        _row("שופרסל", "123", "לחם אחיד", unit="יחידה"),
        _row("שופרסל", "7290000000024", "מוצר שנשאר"),
    ])
    mid = _write(str(tmp_path), "2026-09-01", [
        _row("שופרסל", "7290000000017", "חלב תנובה 3%"),
        _row("שופרסל", "7290000000024", "מוצר שנשאר"),
    ])
    today_rows = [_row("שופרסל", "7290000000024", "מוצר שנשאר")]
    data = build_site_data(today_rows, date="2026-10-01")
    names = retired_names([old, mid], known_keys(data))
    assert set(names) == {"7290000000017", "שופרסל:123"}
    assert names["7290000000017"][0] == "חלב תנובה 3%", "the newest name wins"
    assert names["7290000000017"][1] == "1 ליטר"
    assert names["שופרסל:123"][0] == "לחם אחיד"
    # the window drops snapshots older than `since`
    assert set(retired_names([old, mid], known_keys(data), since="2026-08-15")) == {"7290000000017"}


def test_retired_keys_spell_like_the_live_dataset():
    # a list stored the key build_site_data emitted; retired_names must match it
    assert product_key("007290000000017", "שופרסל", "x") == "7290000000017"
    assert product_key("123", "רמי לוי", "x") == "רמי לוי:123"
    assert product_key("", "רמי לוי", "עגבניה") == "רמי לוי:עגבניה"
    data = build_site_data([_row("רמי לוי", "", "עגבניה", unit="קילוגרם")])
    assert data["products"][0][0] == "רמי לוי:עגבניה"


def test_known_keys_include_merge_aliases():
    rows = [_row("שופרסל", "7290000000017", "חלב תנובה 3%"),
            _row("רמי לוי", "7290000000024", "3% חלב תנובה")]
    data = build_site_data(rows)
    keys = known_keys(data)
    assert {"7290000000017", "7290000000024"} <= keys
    assert any(k.startswith("n:") for k in keys)
