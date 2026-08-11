/* Exercises the search-box ranking (suggestMatches) from site/app.js over a
   fixed catalogue and prints JSON for tests/test_search.py. */
'use strict';
const loadApp = require('./load_app');

const { state, suggestMatches, nameTier, packOf, packTermValue } =
  loadApp(['state', 'suggestMatches', 'nameTier', 'packOf', 'packTermValue']);

const CHAINS = ['שופרסל', 'רמי לוי'];

function prod(k, n, prices, opts) {
  const o = opts || {};
  return { k, n, u: o.u || '', b: o.b || '', p: prices, al: null, pm: null, c: o.c || 0,
    codes: o.codes || [k], nLow: n.toLowerCase(), bLow: (o.b || '').toLowerCase() };
}

const CATALOGUE = [
  prod('7290000000001', 'חלב תנובה 3% שומן 1 ליטר', [6.9, 5.9]),
  prod('7290000000002', 'חלב טרי 1% תנובה', [6.0, 5.5]),
  prod('7290000000003', 'חלב סויה', [8.0, null]),
  prod('7290000000004', 'סחלב מוכן 250 מל', [12.0, null]),
  prod('7290000000005', 'חלבה בטעם וניל', [15.0, null]),
  prod('7290000000006', 'לחם אחיד פרוס 750 גרם', [7.0, 6.5]),
  prod('7290000000007', 'פרוס דק לחם אחיד', [7.5, null]),
  prod('7290000000008', 'במבה חטיף בוטנים 80 גרם', [4.5, 4.0], { b: 'אסם' }),
  prod('7290000000009', 'ביסלי גריל אסם 200 גרם', [6.0, null], { b: 'אסם' }),
  prod('7290000000010', 'מלפפון', [2.9, 3.1], { u: '1 קילוגרם' }),
  prod('7290000000011', 'מלפפון בחומץ 290 גרם', [8.0, 8.0], { u: '290 גרם' }),
  prod('7290000000012', 'קוטג 5% תנובה 250 גרם', [7.2, 7.0]),
  // one drink, four spellings of the same six-pack
  prod('7290000000020', 'קוקה קולה זירו שישייה 1.75 ליטר', [40.0, null], { u: '10.5 ליטר' }),
  prod('7290000000021', 'קוקה קולה זירו 6*330 מל', [24.0, null], { u: '1.98 ליטר' }),
  prod('7290000000022', 'קוקה קולה זירו מארז 6 פחיות', [25.0, null], { u: '1.98 ליטר' }),
  prod('7290000000023', 'קוקה קולה זירו 1.5 ליטר', [8.0, null], { u: '1.5 ליטר' }),
  // things that look like packs and are not
  prod('7290000000024', 'צפס ברביקיו 45*32 גרם', [5.0, null], { u: '45 גרם' }),
  prod('7290000000025', 'גזה 40x20 סמ', [9.0, null], { u: '1 יחידות' }),
  prod('7290000000026', 'בייגלה שמיניות גדולות 400 גרם', [11.0, null], { u: '400 גרם' }),
  prod('7290000000027', 'זוג מגבות מטבח 40*60 סמ', [19.0, null], { u: "1 יח'" }),
];

state.chains = CHAINS;
state.products = CATALOGUE;
state.active = { 'שופרסל': true, 'רמי לוי': true };
state.list = new Map();
state.byKey = new Map(CATALOGUE.map(p => [p.k, p]));
state.categories = ['אחר'];

/* Keys the pre-Stage-1 scorer matched, as a SET. Comparing ordered lists would
   mean re-implementing avail()/minActivePrice() tie-breaks here and testing the
   copy rather than the code; the property that matters is that the contiguous
   set is untouched and sorts ahead of every token-only match. */
function contiguousKeys(q) {
  return state.products.filter(pr => nameTier(pr, q) >= 0).map(pr => pr.k);
}

const names = q => suggestMatches(q).map(x => x[1].n);
const keys = q => suggestMatches(q).map(x => x[1].k);

const QUERIES = ['חלב', 'מלפפון', 'קוטג', 'במבה', 'לחם אחיד', 'חלב תנובה 3%',
  '3% חלב תנובה', 'תנובה חלב', 'פרוס לחם אחיד', 'במבה אסם', 'אסם במבה',
  'קוטג 5% תנובה', 'חלב סויה'];

const appendOnly = {};
for (const q of QUERIES) {
  const before = contiguousKeys(q);
  const scoredRows = suggestMatches(q);
  const after = scoredRows.map(x => x[1].k);
  const contiguousAfter = scoredRows.filter(x => x[0] <= 5).map(x => x[1].k);
  const lastContiguous = scoredRows.reduce((acc, x, i) => (x[0] <= 5 ? i : acc), -1);
  const firstToken = scoredRows.findIndex(x => x[0] >= 6);
  appendOnly[q] = {
    countBefore: before.length,
    countAfter: after.length,
    // the contiguous match set is exactly what it was
    sameContiguousSet: before.length === contiguousAfter.length &&
      before.every(k => contiguousAfter.includes(k)),
    // and every one of them sorts ahead of every token-only row
    contiguousRankFirst: firstToken === -1 || lastContiguous < firstToken,
  };
}

process.stdout.write(JSON.stringify({
  appendOnly,
  singleWordUnchanged: {
    milk: names('חלב'),
    cucumberTop: names('מלפפון')[0],
  },
  wordOrder: {
    forward: names('חלב תנובה 3%').length,
    reversed: names('3% חלב תנובה').length,
    reversedFinds: names('3% חלב תנובה').includes('חלב תנובה 3% שומן 1 ליטר'),
    breadReversed: names('פרוס לחם אחיד'),
  },
  brandNeverSatisfiesAToken: {
    // "אסם" is only in the BRAND field of the bamba, and in the NAME of the bisli
    bambaByBrand: names('במבה אסם'),
  },
  codePathUntouched: {
    exact: names('7290000000001'),
    prefix: suggestMatches('729000000000').length,
  },
  singleTokenNeverUsesTokenPath: {
    // one word that matches nothing contiguous must stay empty
    nonsense: names('זזזזז').length,
  },
  packTags: {
    sixPackWord: packOf(CATALOGUE.find(p => p.n.includes('שישייה'))),
    sixPackTimes: packOf(CATALOGUE.find(p => p.n.includes('6*330'))),
    sixPackContainer: packOf(CATALOGUE.find(p => p.n.includes('מארז 6'))),
    singleBottle: packOf(CATALOGUE.find(p => p.n.includes('1.5 ליטר'))),
    dimensionsNotAPack: packOf(CATALOGUE.find(p => p.n.includes('45*32'))),
    gauzeNotAPack: packOf(CATALOGUE.find(p => p.n.includes('40x20'))),
    bagelShapeNotAPack: packOf(CATALOGUE.find(p => p.n.includes('בייגלה'))),
    countWordBeatsDimensions: packOf(CATALOGUE.find(p => p.n.includes('מגבות'))),
  },
  packTerms: {
    shishiya: packTermValue('שישייה'),
    shishiyaOneYod: packTermValue('שישיה'),
    shishiyat: packTermValue('שישיית'),
    shishiyot: packTermValue('שישיות'),
    friday: packTermValue('שישי'),      // NOT a pack
    maaraz: packTermValue('מארז'),
    tersar: packTermValue('תריסר'),
    milk: packTermValue('חלב'),
  },
  packSearch: {
    byWord: names('קוקה קולה זירו שישייה'),
    byOneYod: names('קוקה קולה זירו שישיה'),
    byConstruct: names('שישיית קוקה קולה זירו'),
    byContainer: names('קולה זירו מארז'),
    singleBottleNotOffered: names('קוקה קולה זירו שישייה')
      .includes('קוקה קולה זירו 1.5 ליטר'),
  },
}, null, 1));
