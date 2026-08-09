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
- build_price_db.py — entry point (CLI). Downloads PriceFull + PromoFull for the
  online stores of the 6 leading chains, parses them, exports Excel + CSV +
  promos CSV to out/. Key mechanics:
  * The online store is scraped DIRECTLY via the library's runner internals
    (scrape_one_wrap with store_id=<online id>) — the public ScarpingTask API
    can't filter by store, and blind limit=N never reaches high store ids
    (Shufersal online = 413). il-supermarket-scraper is PINNED (1.0.8) because
    of this internal-API use; a fallback path uses the public API.
  * Portals expose weeks of history per store — only the newest file is parsed
    (max() of the matched filenames), otherwise stale prices win the min().
  * GEO-BLOCKING: laibcatalog.co.il (Victory) times out and shop.hazi-hinam.co.il
    403s from foreign/cloud IPs. GitHub Actions (US) collects only part of the
    chains; a run from Israeli egress collects all 6. The daily workflow keeps
    whatever succeeded; run locally to top up.
- israeli_prices/parser.py — the XML parsing engine. Subtle points handled:
  1. Schema variants: Items/Item, Products/Product, and Rami Levy's ItemNm name
     tag (FIELD_MAP is first-non-empty-wins so ItemNm beats
     ManufacturerItemDescription).
  2. gzip magic-byte detection; windows-1255 fallback decoding.
  3. parse_promo_file handles both promo layouts: promo-level DiscountedPrice
     (Cerberus standard) and Shufersal's per-item fields under
     Groups/PromotionItems. ClubID "0 - כלל הלקוחות" counts as unrestricted.
- israeli_prices/basket.py — stdlib-only builder of the site dataset:
  * barcode merge across chains (>=8 digits, leading zeros normalized, all-zero
    pseudo-barcodes rejected; internal PLU codes stay chain-scoped),
  * consolidate_by_name — the cross-chain consolidation model: order-independent
    token signature ("חלב תנובה 3%" == "3% חלב תנובה") merges products that do
    NOT share a chain (same-chain twins are different SKUs); original keys kept
    as aliases so saved lists survive,
  * attach_promos — one promo per (product, chain) as [unitPrice|None, desc,
    flags, minQty] (flags bitmask: 1 club / 2 coupon / 4 min-qty>1); expired
    promos dropped against the snapshot date. DiscountedPrice for min-qty
    deals is the BUNDLE TOTAL in the real files (verified across all 6 chains:
    "N ב־X" descriptions always carry X == DiscountedPrice) — normalized to
    per-unit by _unit_promo_price; when semantics can't be confirmed (price <=
    base and no desc match) the promo stays badge-only rather than risk a
    wrong price.
- build_site_data.py — CLI: newest data/israeli_prices_*.csv.gz (+ promos csv) ->
  site/data/products.json.gz (gitignored; schema
  {date, chains, products:[[key,name,unit,brand,[price|null],aliases|null,
  [[promoPrice|null,desc,flags]|null]|null]]}).
- site/ — "סלים=Slim", a static RTL Hebrew SPA (vanilla JS, no deps) implementing
  the Slim product design (basket-with-equals logo, Suez One + Assistant fonts,
  #f7f4f1 ground / #35858e teal, pill controls, 28px cards; tokens at the top of
  style.css). Hash-routed screens: onboarding, build, results (single + smart-
  split), basket detail (real-price substitutes), order handoff (copies list +
  opens the chain's store — a static site cannot fill the chain's cart; the UI
  says so), saved lists with merge, local profile. Notable mechanics in app.js:
  * routing: hash segments are split BEFORE decodeURIComponent — the chain label
    "יינות ביתן / קרפור" carries an encoded slash;
  * promos: pm entries [unitPrice|null, desc, flags, minQty]. lineCost() is the
    single pricing source: min-qty deals price complete bundles at the promo
    unit price and the remainder at regular (club/coupon promos never auto-
    apply). dealSuggestions() powers the "השלמת מבצעים" card in the basket
    (complete a partial bundle, shows extra cost vs bundle saving) and the 💡
    potential-savings hint on results cards;
  * product images: lazy OpenFoodFacts lookups by EAN (imgCache in localStorage,
    max 4 concurrent), emoji keyword fallback (EMOJI_RULES), letter avatar last;
  * address autocomplete: Photon (OSM) with lang=default + Israel bbox; picking
    a suggestion stores addressCity, which drives deliveryStatus();
  * delivery coverage per chain: CHAIN_META.delivery = 'nationwide' | [cities]
    (ESTIMATES, like fee/min/speed — the UI labels them "הערכה"); nextSlot()
    computes the next typical 4h window (no Shabbat) from CHAIN_META.speed;
  * merged products keep aliases → byKey maps alias keys too, so saved lists
    survive consolidation.
  All persistence is localStorage (slim-*-v2 keys, migrates smart-basket-list-v1).
  Loads the gzipped JSON via DecompressionStream (magic-byte sniffing).
  Hebrew search matching: word-prefix with exact-word priority (see keywordScore)
  so "חלב" ≠ "סחלב"/"חלבה" — reuse it for any new keyword features.
- tests/test_parser.py, tests/test_site_data.py — offline tests (fixtures in
  samples/ + the checked-in snapshot in data/).
- .github/workflows/daily-prices.yml — daily run (cron 05:00 UTC = 08:00 Israel)
  that saves a compressed snapshot under data/israeli_prices_YYYY-MM-DD.csv.gz
  and pushes it back to the repo.
- .github/workflows/deploy-pages.yml — rebuilds site data from the latest snapshot
  and deploys site/ to GitHub Pages (triggers: after each successful daily
  snapshot via workflow_run, site-related pushes to main, manual). One-time repo
  setup: Settings -> Pages -> Source: GitHub Actions.

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
1. ~~Promotions~~ — done end-to-end (PromoFull parsing, daily promos snapshot,
   promo-aware totals + badges in the site).
2. Smarter online-store detection: יוחננוף and אושר עד still fall back to a
   representative branch (no online keyword match in their stores file) — an
   explicit per-chain store_id override map would pin their real online stores.
3. A real database: accumulate snapshots into SQLite/DuckDB for historical queries.
4. ~~Product normalization~~ — done: barcode merge + name-signature consolidation.
   Next level: unit-aware fuzzy matching (same brand+size, one word different).
5. ~~Dashboard / site~~ — done; next: price trends over historical snapshots,
   verified per-chain search URL templates (some are best-effort guesses).
6. Integration tests: mocks over real network files to catch schema changes.
7. Full coverage from CI: Actions runners are geo-blocked by some chains — a
   self-hosted runner (or scheduled local run) in Israel would make the daily
   snapshot complete without manual top-ups.

## Style
Python 3.9+, libraries: il-supermarket-scraper, pandas, openpyxl. Keep the parser
resilient to malformed input (real-world files are messy). MIT license.
