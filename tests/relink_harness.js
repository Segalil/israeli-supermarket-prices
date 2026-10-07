/* Exercises the saved-list resilience in site/app.js — resolveListEntries,
   the #/relink review, restoreList orphans and the cloud-pull merge — against a
   synthetic catalogue, and prints JSON for tests/test_list_relink.py.
   argv[2] (optional): a JSON file of names to run nameSig() over, for the
   parity check against Python's name_signature(). */
'use strict';
const fs = require('fs');
const loadApp = require('./load_app');

const app = loadApp(['state', 'nameSig', 'resolveListEntries', 'relinkRow', 'relinkLabel',
  'openEntries', 'commitRelink', 'relinkH', 'restoreList', 'persistList', 'itemSnap',
  'snapList', 'backfillSnapshots', 'cloudPull', 'markSyncDirty', 'LS']);
const { state, LS } = app;

/* a Map-backed localStorage, so persistence round-trips can be observed */
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const readLS = k => JSON.parse(store.get(k) || 'null');

const out = {};
if (process.argv[2]) {
  const names = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  out.sigs = names.map(n => app.nameSig(n));
}

const CHAINS = ['שופרסל', 'רמי לוי', 'ויקטורי'];
function prod(k, n, u, cat, prices, al) {
  return { k, n, u, b: '', p: prices || [5, 5, null], al: al || null, pm: null, c: cat,
    codes: [k], nLow: n.toLowerCase(), bLow: '' };
}
const DAIRY = 2, SNACKS = 6, HYGIENE = 10;
function setCatalogue(products) {
  state.chains = CHAINS;
  state.products = products;
  state.byKey = new Map();
  for (const pr of products) {
    state.byKey.set(pr.k, pr);
    for (const a of pr.al || []) state.byKey.set(a, pr);
  }
  state.active = Object.fromEntries(CHAINS.map(c => [c, true]));
  state.list = new Map();
  state.orphans = [];
  state.retired = null;
}
const brushes = ['PARO 709', 'PARO 739', 'אורל בי', 'קולגייט', 'ג׳ורדן', 'אלמקס', 'פרודונטקס', 'TePe']
  .map((b, i) => prod('brush' + i, `מברשת שיניים ${b} רכה`, "1 יח'", HYGIENE));
setCatalogue([
  prod('merged', 'חלב תנובה 3% 1 ליטר', '1 ליטר', DAIRY, null, ['7290000000017', '7290000000024']),
  prod('7290000000031', 'חלב תנובה 3%', '1 ליטר', DAIRY),          // a dissolved merge's member
  prod('7290000000048', 'חלב תנובה 3%', '2 ליטר', DAIRY),          // same name, other size
  prod('7290000000055', 'קוטג׳ תנובה 5%', '250 גרם', DAIRY),       // relisted under a new barcode
  prod('7290000000062', 'במבה אוסם', '80 גרם', SNACKS),
  prod('7290000000079', 'במבה אוסם', '25 גרם', SNACKS),
  prod('7290000000086', 'שוקולד פרה חלב', '100 גרם', SNACKS),
  prod('7290000000093', 'חלב', '1 ליטר', DAIRY),
  ...brushes,
  prod('7290000000109', 'מברשת שיניים סנסודיין קלין רכה', "1 יח'", HYGIENE),
]);
const k = pr => pr && pr.k;
const nKey = (name, size) => 'n:' + app.nameSig(name) + (size ? '|' + size : '');
const summary = items => items.map(it => ({ how: it.how, to: k(it.pr), qty: it.qty,
  label: it.old ? app.relinkLabel(it.old) : null }));

// 1. resolution tiers
out.resolve = summary(app.resolveListEntries([
  ['7290000000017', 2],                                          // alias of a merged product
  [nKey('3% חלב תנובה', 'ml1000.0'), 1],                       // dissolved merge, size kept
  [nKey('חלב תנובה 3%', 'ml1500.0'), 1],                       // its size no longer exists
  [nKey('אוסם במבה'), 1],                                        // pre-size key, two sizes now
  ['7290000000999', 3, 'קוטג׳ תנובה 5%', '250 גרם', DAIRY],     // snapshot → same product, new code
  ['7290000000888', 1],                                          // nothing known but the code
  ['שופרסל:1234', 1],                                           // chain-scoped, nothing known
  [null, 1], 'garbage',
]));
out.oldFormatSingle = summary(app.resolveListEntries([[nKey('תנובה קוטג׳ 5%'), 1]]));

// the n: signature the pipeline wrote must be what nameSig computes
out.mergeSig = app.nameSig('חלב תנובה 3% 1 ליטר');

// 2. retired names: a bare legacy key gets its name from data/retired.json.gz
state.retired = { '7290000000777': ['קוטג׳ תנובה 5%', '250 גרם', DAIRY] };
out.retired = summary(app.resolveListEntries([['7290000000777', 1]]));
state.retired = null;

// 3. review candidates: rarity-weighted, category-guarded
const pick = (n, u, c) => {
  const [it] = app.resolveListEntries([['7290000000666', 1, n, u, c]]);
  const row = app.relinkRow(it);
  return { how: it.how, chosen: row.chosen, first: row.cands[0] || null, cands: row.cands };
};
out.sensodyne = pick('מברשת שיניים סנסודיין רכה', "1 יח'", HYGIENE);
out.milkChoc = pick('שוקולד חלב פרה', '90 גרם', SNACKS);
out.plainMilk = pick('חלב טרי', '1 ליטר', DAIRY);

// 4. openEntries: everything resolvable loads straight away and heals the saved list
(async () => {
  state.status = 'live';
  state.saved = [{ id: 'own-1', kicker: 'שלי', name: 'שבועית',
    codes: [['7290000000017', 2], ['7290000000999', 1, 'קוטג׳ תנובה 5%', '250 גרם', DAIRY]] }];
  await app.openEntries(state.saved[0].codes, { source: 'saved', id: 'own-1', name: 'שבועית' });
  out.direct = { list: [...state.list], relink: state.relink, note: state.note,
    healed: readLS(LS.saved)[0].codes, hash: global.location.hash };

  // 5. a review row: nothing is dropped, the user's pick lands, skip is honoured
  state.saved = [{ id: 'own-2', kicker: 'שלי', name: 'חודשית',
    codes: [['7290000000062', 1],
            ['7290000000555', 2, 'מברשת שיניים סנסודיין רכה', "1 יח'", HYGIENE],
            ['7290000000444', 1, 'משהו שכבר לא קיים', '', 0]] }];
  await app.openEntries(state.saved[0].codes, { source: 'saved', id: 'own-2', name: 'חודשית' });
  const r = state.relink;
  out.review = { hash: global.location.hash,
    rows: r.items.filter(it => it.how === 'review').map(it => ({ chosen: it.row.chosen, n: it.old.n })) };
  out.reviewHtml = /עדכון מוצרים ברשימה/.test(app.relinkH()) && /data-action="rl-pick"/.test(app.relinkH());
  r.items[2].row.skip = true;
  app.commitRelink();
  out.reviewCommitted = { list: [...state.list], note: state.note,
    healed: readLS(LS.saved)[0].codes.map(e => e[0]) };

  // 6. restoreList keeps unresolved items as orphans, and persistList keeps them stored
  store.set(LS.list, JSON.stringify([
    ['7290000000062', 1],
    ['7290000000998', 2, 'קוטג׳ תנובה 5%', '250 גרם', DAIRY],
    ['7290000000333', 1, 'מוצר שנעלם', '1 ליטר', DAIRY],
  ]));
  state.seeded = true;
  app.restoreList();
  out.restored = { list: [...state.list], orphans: state.orphans, note: state.note };
  app.persistList();
  out.persisted = readLS(LS.list);
  out.snap = app.itemSnap('7290000000062', 3);

  // 7. backfill: old [k, q] items gain their snapshot while the key still resolves
  state.saved = [{ id: 'own-3', name: 'ישנה', codes: [['7290000000062', 1], ['gone', 1]] }];
  app.backfillSnapshots();
  out.backfilled = state.saved[0].codes;

  // 8. cloud pull: unpushed local edits newer than the cloud copy survive a reload
  let pushed = null;
  const cloud = { updatedAt: 1500, [LS.list]: JSON.stringify([['7290000000079', 1]]) };
  global.firebase = { firestore: () => ({ collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => cloud }),
    set: async d => { pushed = d; },
  }) }) }) };
  const pull = async (meta, uid) => {
    pushed = null;
    store.set(LS.list, JSON.stringify([['7290000000062', 4]]));
    if (meta) store.set('slim-sync-meta-v1', JSON.stringify(meta)); else store.delete('slim-sync-meta-v1');
    state.auth = { mode: 'firebase', user: { uid }, ready: true, pulled: false };
    await app.cloudPull(uid);
    return { list: readLS(LS.list).map(e => [e[0], e[1]]), pushed: !!pushed };
  };
  out.pullLocalNewer = await pull({ uid: 'u1', dirtyAt: 2000, pushedAt: 1000 }, 'u1');
  out.pullCloudNewer = await pull({ uid: 'u1', dirtyAt: 1200, pushedAt: 1000 }, 'u1');
  out.pullPushedAlready = await pull({ uid: 'u1', dirtyAt: 2000, pushedAt: 2000 }, 'u1');
  out.pullOtherAccount = await pull({ uid: 'u2', dirtyAt: 9999, pushedAt: 0 }, 'u1');
  out.pullGuest = await pull(null, 'u1');

  // edits before this session's pull are re-derived state, not user edits
  store.delete('slim-sync-meta-v1');
  state.auth = { mode: 'firebase', user: { uid: 'u1' }, ready: true, pulled: false };
  app.markSyncDirty();
  out.dirtyBeforePull = store.get('slim-sync-meta-v1') || null;
  state.auth.pulled = true;
  app.markSyncDirty();
  out.dirtyAfterPull = !!(JSON.parse(store.get('slim-sync-meta-v1') || '{}').dirtyAt);

  // exit only once the pipe has drained: a bare exit truncates output at 64 KB
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
})().catch(err => { console.error(err.stack || err); process.exit(1); });
