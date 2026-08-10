"""Regression test for the site's recipe-import feature (link → ingredient
picker). Runs the actual site/app.js logic in Node (tests/recipe_harness.js):
Hebrew ingredient-term extraction, schema.org Recipe JSON-LD parsing over
samples/recipe-import/fixture-recipe.html, pasted-text parsing, and candidate
generation — including the human-in-the-middle invariant that no product is
ever pre-chosen.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_recipe_import_pipeline():
    proc = subprocess.run(
        ["node", str(ROOT / "tests" / "recipe_harness.js")],
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, f"harness failed:\n{proc.stdout}\n{proc.stderr}"
    verdict = json.loads(proc.stdout.strip().splitlines()[-1])
    assert verdict["ok"], verdict["failures"]
    assert verdict["rows"] == 11
