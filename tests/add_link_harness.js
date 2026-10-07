/* Exercises the pre-filled list link "#/add/<barcode>,<barcode>*N" in site/app.js
   (addFromLink) against a tiny catalogue; prints JSON for tests/test_add_link.py. */
'use strict';
const loadApp = require('./load_app');
const { state, addFromLink } = loadApp(['state', 'addFromLink']);

const prod = (k, n, al) => ({ k, n, u: '', b: '', p: [5, 6], al: al || null, pm: null, c: 0,
  codes: [k], nLow: n.toLowerCase(), bLow: '' });
const products = [prod('7290004131074', 'חלב תנובה 3%'), prod('7290000066318', 'במבה'),
  prod('n:x|g1000.0', 'עגבניה', ['7290000000017'])];
state.chains = ['שופרסל', 'רמי לוי'];
state.products = products;
state.byKey = new Map();
for (const pr of products) { state.byKey.set(pr.k, pr); for (const a of pr.al || []) state.byKey.set(a, pr); }
state.status = 'live';
const replaced = [];
global.location = { hash: '#/add/x', replace: h => replaced.push(h) };

const run = param => { state.list = new Map(); state.orphans = []; addFromLink(param);
  return { list: [...state.list], note: state.note, replaced: replaced.slice(-1)[0] }; };
const out = {
  basic: run('7290004131074,7290000066318*2'),
  leadingZeros: run('007290004131074'),
  alias: run('7290000000017*3'),
  missing: run('7290004131074,1234567890123, ,*,junk*x'),
  clampQty: run('7290004131074*500'),
};
state.list = new Map([['7290004131074', 5]]); state.orphans = [];
addFromLink('7290004131074*2');
out.noDouble = [...state.list];
process.stdout.write(JSON.stringify(out), () => process.exit(0));
