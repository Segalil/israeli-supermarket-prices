# CLAUDE.md — project context for Claude Code

This file hands off the full context of the project. Read it before you start working.

## What this project is
A tool that builds a price database (Excel + CSV) of product prices from the
**online** stores of Israel's leading grocery chains, using the official
**price-transparency** files (Israel's "Food Law"). Every large retailer is
legally required to publish its full price catalog in a standard XML format,
per-store, updated daily. The data is entirely legal and public.

Official source: https://www.gov.il/he/pages/cpfta_prices_regulations
Downloading is done via the il-supermarket-scraper library (PyPI).

## Code structure
- build_price_db.py — entry point (CLI). Downloads PriceFull files for the
  online stores of the leading chains, parses them, and exports Excel + CSV to out/.
- israeli_prices/parser.py — the XML parsing engine. Three subtle points already handled:
  1. Two schema variants: Items/Item and Products/Product (mapped case-insensitively).
  2. Files are usually gzip — detected by magic bytes and decompressed transparently.
  3. Encoding: some files are windows-1255, not UTF-8 — a fallback converts them.
  Functions: parse_price_file, parse_store_file, looks_online.
- tests/test_parser.py — tests against the fixtures in samples/ (no network needed).
- .github/workflows/daily-prices.yml — daily run (cron 05:00 UTC = 08:00 Israel)
  that saves a compressed snapshot under data/israeli_prices_YYYY-MM-DD.csv.gz
  and pushes it back to the repo.

## Key design decisions
- Online store: auto-detected from the stores file by keywords in the store name
  (ONLINE_KEYWORDS in the parser). If none is found for a chain, a single
  representative branch is used (reflected in the store_id column). Candidate for improvement.
- Scope: the 8 leading chains (LEADING_CHAINS). The --all-stores flag pulls every
  branch nationwide (very large — millions of rows).
- Output: CSV in UTF-8-BOM (opens correctly in Excel) + XLSX with a prices sheet
  and a summary sheet. Hebrew column names via COL_HEB.

## Limitations / gotchas
- Network access: the chains' sites are reachable only from unrestricted egress.
  GitHub Actions runners can reach them; restricted cloud sandboxes cannot. Run
  locally or in Actions.
- Repo size: daily snapshots accumulate under data/. Consider retention down the line.
- Scraper stability: the tool catches per-chain errors and continues.

## Run & test
#   pip install -r requirements.txt
#   python -m pytest -q
#   python build_price_db.py

## Roadmap / ideas to build next
1. Promotions (Promo) files: add downloading and parsing of PromoFull alongside prices.
2. Smarter online-store detection: explicit per-chain store_id mapping, keeping the fallback.
3. A real database: accumulate snapshots into SQLite/DuckDB for historical queries.
4. Product normalization by barcode → a "cheapest per product" comparison table.
5. Dashboard: a static GitHub Pages page showing current prices and trends.
6. Integration tests: mocks over real network files to catch schema changes.

## Style
Python 3.9+, libraries: il-supermarket-scraper, pandas, openpyxl. Keep the parser
resilient to malformed input (real-world files are messy). MIT license.
