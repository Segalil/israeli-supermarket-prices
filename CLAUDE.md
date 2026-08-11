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
    as aliases so saved lists survive. THE ALIASES ARE LOAD-BEARING: the client
    derives each product's מק"ט list from its key + aliases (see loadData), so a
    merge must never drop them or barcode search and receipt scanning lose codes.
    Merging is bucketed by (name signature, unit_signature) — size is part of
    identity, so a 400g and a 700g listing of one name stay separate, and the
    merged key carries the size ("n:<sig>|g700.0") so two sizes cannot collide.
    unit_signature folds equivalent spellings AND scales ('1 ק"ג' == '1 קילוגרם'
    == '1000 גרם'); name_signature folds measurement WORDS inside the name
    ("כוסמת 500 ג" == "כוסמת 500 גרם") but never descriptive ones, so
    "עוגת שמרים" and "עוגת שמרים במילוי" stay apart. A one-word name is a weak
    key and merges only for loose produce (_is_loose_produce_unit: sold per piece
    or per >=1kg) — that is what lets "אבוקדו" from four chains become one
    comparable row, while a bare brand like 'DOVE 150 מ"ל' never collapses.
    strip_chain_name drops the retailer's own name from a TRAILING position
    ("עגבניות שרי כתום רמי לוי"), which both de-noises the UI and unblocks the
    merge. NOTE: ~70% of the catalogue is priced in a single chain, so the list
    still looks repetitive; that long tail is genuinely distinct SKUs, not a
    consolidation bug — fixing the *perception* is a UI ranking job, not a
    merging one,
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
  {date, chains, categories, products:[[key,name,unit,brand,[price|null],
  aliases|null, [[promoPrice|null,desc,flags,minQty]|null]|null, categoryIdx]]}).
  Categories come from classify_category in basket.py — keyword rules with a
  flavor-suffix cut ("בטעם…" is ignored) and most-generic-last ordering
  (produce runs last); ~67% of products classify, index 0 = "אחר". When tuning
  keywords, keep the order-sensitivity tests in test_category_classification
  green (שוקולד חלב → snacks, רוטב עגבניות → pantry, etc.).
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
  * pack value ("אותו מוצר, אריזה משתלמת יותר" in the basket): betterValueAt()
    offers the same product in a different pack when it is cheaper PER UNIT OF
    MEASURE in that chain. Deliberately narrow — a loose similarity rule was
    measured against the real catalogue and proposed swapping oatmeal for penne,
    and a first cut here suggested regular coffee capsules for decaf. The bar is
    valueIdentity(): the name with pack size removed, where a number is dropped
    only when a unit word follows it, so "1.5 ליטר" goes and "גודל 3" stays;
    plus same category, same unit KIND, size ratio <= 6x, different size (equal
    size is a duplicate listing, not a better pack) and >= 8% gain per unit.
    unitSig()/perUnitPrice() MIRROR unit_signature() in basket.py — JS \b is
    ASCII-only so the two silently diverged around Hebrew until tests/
    test_unit_sig.py compared them; keep that test green. valueIndex is keyed on
    the state.products array itself so it re-derives when the catalogue is
    replaced. Tests: tests/test_pack_value.py over tests/value_harness.js.
  * receipt scan (#/receipt; entry points: nav bar, onboarding + build CTAs,
    saved-lists button, and the post-registration hand-off welcomeToReceipt —
    wired into BOTH Google flows: popup cred and getRedirectResult, via
    additionalUserInfo.isNewUser): photo → OCR → review (opt-out checkbox also
    saves the scan as a saved list, kicker "מקבלה 📸"; receipt.returnTo routes
    the commit back to #/saved when launched from there) → add-to-list, at
    zero running cost — OCR runs fully client-side via
    tesseract.js (pinned 5.1.1, lazy jsDelivr load, 'heb+eng' because heb
    alone garbles digits; models cached in IndexedDB, photo never uploaded).
    Matching is CODE-FIRST: receipts print each item's מק"ט/barcode and digits
    OCR reliably — 7-13 digit runs (plus 13/12-digit edges of longer runs,
    because the price column merges into the code in OCR) are exact-matched
    against a lazy inverted index (rcptIndex, rebuilt per data load); only
    codeless lines fall back to Hebrew token matching (final letters
    normalized, exact-word > prefix, weak number tokens break ties, ≥2 token
    hits or exact single-token). Admin lines (totals/payment/header) are
    dropped by keyword UNLESS a code resolves; all-numeric "2 X 6.90" lines
    set the qty of the line above (OCR may reverse them and read X as א).
    Tests: tests/test_receipt_scan.py replays a real captured OCR text
    (samples/receipt-scan/) through site/app.js in node via
    tests/receipt_harness.js; samples/receipt-scan/make_receipt.py regenerates
    the synthetic receipt PNG for manual browser testing.
  * recipe import (#/recipe, CTA on build next to the receipt one): paste a
    recipe URL (or the ingredient text) → ingredient rows → the USER picks the
    exact product per ingredient (human-in-the-middle by design — nothing is
    auto-selected; "יש לי בבית" skips a row; per-row search replaces only that
    row's chips so focus survives; chips page through ALL matches via
    chipsListH — RCP_MATCH_CAP/RCP_CHIPS_FIRST/RCP_CHIPS_STEP — with an
    "עוד התאמות (N)" pager). The SAME picker serves the receipt review:
    "🔄 החלפה" on matched rows swaps the product (via='manual', 👤 tag) and
    unmatched lines get an inline "🔍 בחירת מוצר" picker (item.alt built
    lazily by receiptAltFor — un-normalized words, since catalog nLow keeps
    final letters); picking on a miss row moves it into the matched list. Extraction order: schema.org Recipe
    JSON-LD (regex-scanned → node-testable), DOM ingredient selectors,
    "מצרכים" text-section scan; pasted text stops at an instructions header.
    URL fetch: direct, then free public CORS relays (RECIPE_PROXIES — the
    paste path is the always-works fallback; terms disclose the relays).
    ingredientTerm strips leading qty/units (RCP_NUM_RE/RCP_UNITS) and
    descriptor words anywhere (RCP_DESCR); buildRecipeRows shortens a term
    word-by-word until the catalog answers. Commit merges into the list and
    (opt-out) saves as "מתכון: <name>" (kicker "ממתכון 🔗"). Tests:
    tests/test_recipe_import.py → tests/recipe_harness.js over
    samples/recipe-import/fixture-recipe.html (loader shared in
    tests/load_app.js).
  * auth: FIREBASE_CONFIG=null → device-profile mode; paste a Firebase web
    config to enable real login/signup (email+password + Google popup +
    password reset) with per-user Firestore sync — SYNC_KEYS localStorage
    slices are pushed debounced into users/{uid} and pulled on login (cloud
    wins if the doc exists, else the device state seeds it). SDK loads
    lazily from gstatic (compat builds); any init failure degrades to local.
    Firestore rules + setup steps live in the FIREBASE_CONFIG comment.
  All persistence is localStorage (slim-*-v2 keys, migrates smart-basket-list-v1).
  Loads the gzipped JSON via DecompressionStream (magic-byte sniffing).
  Hebrew search matching: word-prefix with exact-word priority (see keywordScore)
  so "חלב" ≠ "סחלב"/"חלבה" — reuse it for any new keyword features.
  * headings: exactly ONE <h1> per screen (.page-title is the h1; screens without
    one — done/profile/error/results-empty — promote their lead heading). Sections
    are h2, in-card sub-blocks h3. The CSS matches BOTH the old and new tags
    (.card h2, .card h3, .card h4 { … }) so a retag never changes the look —
    keep that pattern if you move a heading level again.
- site/articles/ — static Hebrew guide pages, the SEO surface of the project.
  The app itself is hash-routed, so "#/build" and friends are NOT separate URLs
  for crawlers; only real files rank. Each guide is site/articles/<slug>/index.html
  (clean URL /articles/<slug>/), fully readable without JS, styled by
  site/article.css on top of style.css tokens. Conventions, all enforced by
  tests/test_seo.py: one h1, no skipped heading levels, live TOC anchors,
  canonical == og:url == the real path, valid JSON-LD (Article + BreadcrumbList
  + FAQPage; the hub uses CollectionPage + ItemList), and every /articles/ link
  resolving to a file. site/robots.txt + site/sitemap.xml list them; ADD NEW
  GUIDES TO BOTH. The home entry's <lastmod> is stamped at deploy time with the
  snapshot date (deploy-pages.yml matches the exact <loc>/<lastmod> shape —
  test_sitemap_home_lastmod_is_stampable guards it); guide entries keep the
  date of their last real content change, updated by hand. robots.txt must keep /data/ crawlable — Googlebot's renderer
  honours robots.txt for subresources, so blocking it would make the crawler see
  a broken app. Content rule: the guides never print an invented price, percentage
  or statistic, and never crown a chain "the cheapest" — the delivery figures they
  quote come from CHAIN_META and are labelled הערכה, matching the UI.
- extension/ — MV3 Chrome extension ("ליםSlim — העברת סל לרשתות"): bridge.js
  (on slim-super.com + localhost) copies the site's slim-handoff-v1 payload
  into chrome.storage; panel.js (on 6 chain sites, per-chain selector adapters
  in chains/*.js) walks the list — barcode-first search, auto-add with qty,
  verify, assisted "הוספתי" fallback — and shows a full manual-fallback list
  (name + מק"ט + qty, per-row copy/search, copy-all). The handoff payload also
  carries items missing from the chain's catalog (missing:true — pre-skipped
  by the auto walk, listed for a manual try). harness.html runs the real
  bridge+panel against stubbed chrome.* without installing (see README).
  extension.zip is the store artifact — rebuild after changes (zip -r … see
  git log); store re-upload is manual.
- tests/test_parser.py, tests/test_site_data.py, tests/test_seo.py — offline tests
  (fixtures in samples/ + the checked-in snapshot in data/).
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
0. ~~Receipt-photo onboarding~~ — done: #/receipt scans a receipt photo into
   the list (client-side Tesseract OCR, מק"ט-first matching, review screen).
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
