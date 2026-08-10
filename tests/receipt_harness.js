/* Node harness for the site's receipt-scan parsing/matching (no browser, no
   OCR): loads site/app.js with DOM stubs, injects a fixture catalog, runs the
   captured OCR text from samples/receipt-scan/ocr-capture.txt through
   matchReceiptText, and prints a JSON verdict. Run by tests/test_receipt_scan.py. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---- minimal DOM so app.js top-level runs ---- */
const noopEl = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, appendChild() {}, setAttribute() {}, querySelector: () => null,
  querySelectorAll: () => [],
});
global.window = { addEventListener() {}, dispatchEvent() {}, scrollTo() {} };
global.location = { hash: '' };
try { global.navigator = { onLine: true }; } catch (_) {}  // modern node ships its own
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.matchMedia = () => ({ matches: false });
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
  createElement: noopEl,
  documentElement: { dataset: {}, classList: { toggle() {} } },
  body: { appendChild() {}, style: {} },
};

/* ---- load app.js and export its internals from the eval scope ---- */
const harness = {};
global.__exports = obj => Object.assign(harness, obj);
const code = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');
// eslint-disable-next-line no-eval
eval(code + '\n;__exports({ state, matchReceiptText, parseReceiptText, receiptTokens,' +
  ' receiptCodeCandidates, receiptPriceFrom });');

/* ---- fixture catalog: the receipt's products + distractors ---- */
function prod(k, n, prices, codes) {
  return { k, n, u: '', b: '', p: prices, al: null, pm: null, c: 0,
    codes: codes || [k], nLow: n.toLowerCase(), bLow: '' };
}
const P = [
  prod('7290000272467', 'סירופ דיאט פטל עסיס 1 ליטר', [11.7, 11.9, null]),
  prod('7290005996276', 'פסטרמה בקביקיו דק דק 120 גר', [13.9, null, 14.9]),
  prod('7290107280396', "סנו ג'ט למטבח 750 מ\"ל", [12.4, 12.9, 11.9]),
  prod('7290011015985', 'סירופ דיאט אננס פריגת 750 מ"ל', [19.3, null, null]),
  prod('7290003387410', 'פדים להסרת איפור בלונס שלישיה', [18.8, 17.9, null]),
  prod('7290100240656', 'פתית קרקר פריך משיפון', [18.9, null, null]),
  prod('7290000572529', 'חלוה אגוז אחוה 400 ג', [14.9, 15.9, null]),
  prod('7290115205176', 'חטיפי קרקר כפרי 140 גר פיטנס', [12.2, null, null]),
  prod('4009300527909', "פומפדור חליטת ג'ינג'ר כורכום", [15.7, null, null]),
  prod('7290015366373', 'ספירה דוחה יתושים לי', [14.5, null, null]),
  prod('plu-460', 'עגבניות שרי', [5.6, 4.9, 6.2], ['460']),
  // distractors the matcher must NOT pick
  prod('7290000111111', 'שוקולד אגוז לוקר', [9.9, null, null]),
  prod('plu-461', 'עגבניות תפזורת', [3.9, null, null], ['461']),
  prod('7290000222222', 'חלב תנובה 3% 1 ליטר', [6.9, 6.5, null]),
  prod('7290000333333', 'קרקר שומשום אסם', [8.9, null, null]),
];
harness.state.products = P;

const text = fs.readFileSync(path.join(ROOT, 'samples', 'receipt-scan', 'ocr-capture.txt'), 'utf8');
const items = harness.matchReceiptText(text);

/* ---- verdict ---- */
const EXPECT = [
  ['7290000272467', 'code', 1, 11.7],
  ['7290005996276', 'code', 1, 13.9],
  ['7290107280396', 'code', 1, 12.4],
  ['7290011015985', 'code', 1, 19.3],
  ['7290003387410', 'code', 1, 18.8],
  ['7290100240656', 'code', 2, 18.9],   // qty from the "…א2" OCR of "2 X 18.90"
  ['7290000572529', 'name', 1, null],   // weak-token 400 must beat שוקולד אגוז
  ['7290115205176', 'name', 1, 12.2],
  ['4009300527909', 'name', 1, 15.7],
  ['7290015366373', 'name', 1, null],   // corrupted printed code -> name fallback
  ['plu-460', 'name', 1, 5.62],
];
const byK = new Map(items.filter(i => i.pr).map(i => [i.pr.k, i]));
const failures = [];
for (const [k, via, qty, price] of EXPECT) {
  const it = byK.get(k);
  if (!it) { failures.push(`missing match for ${k}`); continue; }
  if (it.via !== via) failures.push(`${k}: via ${it.via} != ${via}`);
  if (it.qty !== qty) failures.push(`${k}: qty ${it.qty} != ${qty}`);
  if (price != null && Math.abs((it.price ?? 0) - price) > 0.005)
    failures.push(`${k}: price ${it.price} != ${price}`);
}
const junk = items.filter(i => !i.pr).map(i => i.raw);
if (junk.length) failures.push(`junk lines leaked into review: ${JSON.stringify(junk)}`);
if (items.length !== EXPECT.length)
  failures.push(`item count ${items.length} != ${EXPECT.length}`);
for (const bad of ['7290000111111', 'plu-461', '7290000222222', '7290000333333']) {
  if (byK.has(bad)) failures.push(`distractor matched: ${bad}`);
}

console.log(JSON.stringify({ ok: failures.length === 0, failures,
  matched: items.filter(i => i.pr).length, total: items.length }));
process.exit(failures.length ? 1 : 0);
