/* Shared loader for node harnesses: evals site/app.js with minimal DOM stubs
   and returns the requested internals from the eval scope. */
'use strict';
const fs = require('fs');
const path = require('path');

const noopEl = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, appendChild() {}, setAttribute() {}, querySelector: () => null,
  querySelectorAll: () => [],
});

module.exports = function loadApp(exportNames) {
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
  const harness = {};
  global.__exports = obj => Object.assign(harness, obj);
  const code = fs.readFileSync(path.join(__dirname, '..', 'site', 'app.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code + `\n;__exports({ ${exportNames.join(', ')} });`);
  return harness;
};

/* fixture-catalog product in the site's post-load shape */
module.exports.prod = function prod(k, n, prices, codes) {
  return { k, n, u: '', b: '', p: prices, al: null, pm: null, c: 0,
    codes: codes || [k], nLow: n.toLowerCase(), bLow: '' };
};
