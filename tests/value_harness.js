/* Exercises the pack-value suggestion (valueIdentity / betterValueAt) from
   site/app.js against a synthetic catalogue, and prints JSON for
   tests/test_pack_value.py. */
'use strict';
const loadApp = require('./load_app');

const app = loadApp(['state', 'valueIdentity', 'betterValueAt', 'unitSig', 'perUnitPrice']);
const { state, valueIdentity, betterValueAt } = app;

/* product in the site's post-load shape; prices is one entry per chain */
function prod(k, n, u, prices, cat) {
  return { k, n, u, b: '', p: prices, al: null, pm: null, c: cat === undefined ? 1 : cat,
    codes: [k], nLow: n.toLowerCase(), bLow: '' };
}

const CHAINS = ['שופרסל', 'רמי לוי'];

function setCatalogue(products) {
  state.chains = CHAINS;
  state.products = products;
  state.list = new Map();
  state.active = { 'שופרסל': true, 'רמי לוי': true };
  state.byKey = new Map(products.map(p => [p.k, p]));
}

const cases = {};

// 1. identity strips the pack size but never a variant number
setCatalogue([]);
cases.identity = {
  cola15: valueIdentity(prod('a', 'קוקה קולה זירו 1.5 ליטר', '1.5 ליטר', [])),
  cola2: valueIdentity(prod('b', 'קוקה קולה זירו 2 ליט', '2 ליטר', [])),
  glued: valueIdentity(prod('c', 'קוקה קולה זירו בקבוק500מ', '500 מיליליטר', [])),
  size3: valueIdentity(prod('d', 'מנגט צבעוני גודל 3', '1 יחידות', [])),
  size2: valueIdentity(prod('e', 'מנגט צבעוני גודל 2', '1 יחידות', [])),
  coffee6: valueIdentity(prod('f', 'קפסולות קפה עוצמה 6', '10 גרם', [])),
  coffeeDecaf: valueIdentity(prod('g', 'קפסולות קפה נטול קפאין', '55 גרם', [])),
  oneWord: valueIdentity(prod('h', 'אבוקדו', '1 קילוגרם', [])),
};

// 2. a bigger bottle of the same drink wins on price per litre
setCatalogue([
  prod('small', 'קוקה קולה זירו 1.5 ליטר', '1.5 ליטר', [12.0, null]),
  prod('big', 'קוקה קולה זירו 2 ליט', '2 ליטר', [13.0, null]),
]);
state.list = new Map([['small', 1]]);
const better = betterValueAt(state.products[0], 'שופרסל');
cases.biggerBottleWins = better && {
  alt: better.alt.pr.k,
  minePerUnit: Math.round(better.minePerUnit * 100) / 100,
  altPerUnit: Math.round(better.alt.perUnit * 100) / 100,
  gainPct: Math.round(better.gain * 100),
  label: better.label,
};

// 3. a different product in the same aisle is never offered
setCatalogue([
  prod('oat', 'קוואקר עדין אורגני 500 גר', '500 גרם', [12.2, null]),
  prod('penne', 'פרימלוצי פנה ריגאטי 500 גר', '500 גרם', [5.9, null]),
]);
state.list = new Map([['oat', 1]]);
cases.differentProductRejected = betterValueAt(state.products[0], 'שופרסל') === null;

// 4. same size, different price = a duplicate listing, not a better pack
setCatalogue([
  prod('d1', 'בושם כלשהו 90 מל', '90 מיליליטר', [610.0, null]),
  prod('d2', 'בושם כלשהו 90 מל', '90 מיליליטר', [500.0, null]),
]);
state.list = new Map([['d1', 1]]);
cases.sameSizeRejected = betterValueAt(state.products[0], 'שופרסל') === null;

// 5. an absurd size jump is not an answer to a small pack
setCatalogue([
  prod('tiny', 'קמח לבן 1 קג', '1 קילוגרם', [6.0, null]),
  prod('catering', 'קמח לבן 25 קג', '25 קילוגרם', [90.0, null]),
]);
state.list = new Map([['tiny', 1]]);
cases.absurdRatioRejected = betterValueAt(state.products[0], 'שופרסל') === null;

// 6. a gain under the threshold is noise
setCatalogue([
  prod('a1', 'שמן זית 500 מל', '500 מיליליטר', [20.0, null]),
  prod('a2', 'שמן זית 1 ליטר', '1 ליטר', [38.5, null]),   // only ~3.75% better per litre
]);
state.list = new Map([['a1', 1]]);
cases.tinyGainRejected = betterValueAt(state.products[0], 'שופרסל') === null;

// 7. never offers something already in the list
setCatalogue([
  prod('s', 'מיץ תפוזים 1 ליטר', '1 ליטר', [10.0, null]),
  prod('l', 'מיץ תפוזים 2 ליטר', '2 ליטר', [12.0, null]),
]);
state.list = new Map([['s', 1], ['l', 1]]);
cases.alreadyInListRejected = betterValueAt(state.products[0], 'שופרסל') === null;

// 8. the comparison is per chain: no offer where the alternative is not sold
setCatalogue([
  prod('s2', 'מיץ ענבים 1 ליטר', '1 ליטר', [10.0, 10.0]),
  prod('l2', 'מיץ ענבים 2 ליטר', '2 ליטר', [null, 12.0]),
]);
state.list = new Map([['s2', 1]]);
cases.otherChainOnly = {
  shufersal: betterValueAt(state.products[0], 'שופרסל') === null,
  ramiLevy: !!betterValueAt(state.products[0], 'רמי לוי'),
};

process.stdout.write(JSON.stringify(cases, null, 1));
