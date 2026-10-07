/* Exercises the pre-filled list link "#/add/<barcode>,<barcode>*N" in site/app.js
   (addFromLink) against a tiny catalogue; prints JSON for tests/test_add_link.py. */
'use strict';
const loadApp = require('./load_app');
const { state, addFromLink, reapplyLinkAdds } = loadApp(['state', 'addFromLink', 'reapplyLinkAdds']);

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
out.seeded = state.seeded;
out.revealNote = state.revealNote;

// signed in, cloud copy not read yet: the pull replaces the list, the link's
// items are re-applied on top of it
state.auth = { mode: 'firebase', user: { uid: 'u1' }, ready: true, pulled: false };
state.list = new Map(); state.orphans = [];
addFromLink('7290000066318*2');
state.list = new Map([['7290004131074', 1]]);   // what the cloud pull restored
state.auth.pulled = true;
reapplyLinkAdds();
out.afterPull = [...state.list];
reapplyLinkAdds();                              // idempotent: nothing pending any more
out.afterPullAgain = [...state.list];
process.stdout.write(JSON.stringify(out), () => process.exit(0));
