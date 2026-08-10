"""Regression test for the site's receipt-scan parsing/matching.

The browser feature OCRs a receipt photo with Tesseract (client-side) and
matches the lines against the catalog — code-first (מק"ט), Hebrew-name
fallback. OCR itself needs a browser; this test replays a captured real OCR
output (samples/receipt-scan/ocr-capture.txt) through the actual site/app.js
logic in Node (tests/receipt_harness.js) and checks matches, quantities,
recovered prices, and that admin lines never leak into the review list.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_receipt_scan_matching():
    proc = subprocess.run(
        ["node", str(ROOT / "tests" / "receipt_harness.js")],
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, f"harness failed:\n{proc.stdout}\n{proc.stderr}"
    verdict = json.loads(proc.stdout.strip().splitlines()[-1])
    assert verdict["ok"], verdict["failures"]
    assert verdict["matched"] == verdict["total"] == 11
