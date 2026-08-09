/* סלים=Slim — grocery-list price comparison over the daily transparency snapshot.
   Implements the "Slim" product design (onboarding → build → results → basket →
   handoff, plus saved lists & local profile) on top of site/data/products.json.gz. */
'use strict';

const DATA_URL = 'data/products.json.gz';
const LS = {
  list: 'slim-list-v2',
  prefs: 'slim-prefs-v2',        // {active:{label:bool}, priority, address, visited, seeded}
  profile: 'slim-profile-v2',    // {name, email, phone}
  saved: 'slim-saved-lists-v2',  // [{id, kicker, name, codes:[[k,qty]], created}]
  orders: 'slim-orders-v2',      // [{store, date, count, total}]
  stats: 'slim-stats-v2',        // {comparisons, lastSaving, potential}
  legacy: 'smart-basket-list-v1',
};

/* Per-chain metadata. fee/min/speed/delivery are ESTIMATES (editable here) —
   the transparency files don't publish delivery terms; the UI labels them as
   estimates. `delivery` is 'nationwide' or a city list used for the address
   check; `speed` feeds the next-slot estimator (1 fast … 3 slow).
   home/search are the chain's online store (best-effort). */
const CHAIN_META = {
  'שופרסל': { initial: 'ש', fee: 29, min: 200, speed: 1, delivery: 'nationwide',
    home: 'https://www.shufersal.co.il/online/',
    search: q => `https://www.shufersal.co.il/online/he/search?text=${encodeURIComponent(q)}`, barcode: true },
  'רמי לוי': { initial: 'ר', fee: 39, min: 250, speed: 2, delivery: 'nationwide',
    home: 'https://www.rami-levy.co.il/he/online',
    search: q => `https://www.rami-levy.co.il/he/online/search?q=${encodeURIComponent(q)}`, barcode: true },
  'ויקטורי': { initial: 'ו', fee: 25, min: 150, speed: 1,
    delivery: ['תל אביב', 'רמת גן', 'גבעתיים', 'חולון', 'בת ים', 'ראשון לציון',
      'פתח תקווה', 'בני ברק', 'הרצליה', 'רעננה', 'כפר סבא', 'נתניה', 'ראש העין',
      'אשדוד', 'רחובות', 'נס ציונה', 'מודיעין', 'לוד', 'רמלה', 'יבנה'],
    home: 'https://www.victoryonline.co.il/' },
  'יוחננוף': { initial: 'י', fee: 30, min: 200, speed: 2,
    delivery: ['תל אביב', 'ראשון לציון', 'רחובות', 'פתח תקווה', 'ראש העין', 'נתניה',
      'אשדוד', 'אשקלון', 'באר שבע', 'ירושלים', 'חיפה', 'קרית אתא', 'חדרה', 'לוד',
      'רמלה', 'מודיעין', 'יבנה', 'חולון', 'בת ים', 'רמת גן', 'גדרה', 'עפולה'],
    home: 'https://yochananof.co.il/',
    search: q => `https://yochananof.co.il/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  'אושר עד': { initial: 'א', fee: 35, min: 300, speed: 3,
    delivery: ['ירושלים', 'בית שמש', 'ביתר עילית', 'מודיעין עילית', 'בני ברק',
      'אלעד', 'אשדוד', 'פתח תקווה', 'חיפה', 'רכסים', 'טבריה', 'צפת', 'נתיבות'],
    home: 'https://www.osherad.co.il/' },
  'טיב טעם': { initial: 'ט', fee: 45, min: 200, speed: 2, delivery: 'nationwide',
    home: 'https://www.tivtaam.co.il/',
    search: q => `https://www.tivtaam.co.il/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  'יינות ביתן / קרפור': { initial: 'ק', fee: 29, min: 200, speed: 2, delivery: 'nationwide',
    home: 'https://www.carrefour.co.il/' },
  'חצי חינם': { initial: 'ח', fee: 35, min: 250, speed: 2,
    delivery: ['ראשון לציון', 'חולון', 'בת ים', 'תל אביב', 'רמת גן', 'פתח תקווה',
      'ראש העין', 'רחובות', 'נס ציונה', 'מודיעין', 'אשדוד', 'הוד השרון'],
    home: 'https://shop.hazi-hinam.co.il/' },
};
const FALLBACK_META = { initial: '?', fee: 30, min: 200, speed: 2, delivery: 'nationwide' };

/* keyword → emoji fallback when no product photo is found */
const EMOJI_RULES = [
  ['חלב', '🥛'], ['שוקו ', '🥛'], ['יוגורט', '🥛'], ['משקה', '🥤'],
  ['גבינ', '🧀'], ['קוטג', '🧀'], ['בולגרית', '🧀'], ['מוצרלה', '🧀'],
  ['לחם', '🍞'], ['לחמני', '🥯'], ['פיתות', '🥙'], ['חלה', '🍞'], ['טוסט', '🍞'],
  ['ביצים', '🥚'], ['ביצי', '🥚'],
  ['עגבני', '🍅'], ['מלפפון', '🥒'], ['פלפל', '🫑'], ['בצל', '🧅'], ['תפוח אדמה', '🥔'],
  ['גזר', '🥕'], ['חסה', '🥬'], ['תפוח', '🍎'], ['בננ', '🍌'], ['אבטיח', '🍉'],
  ['ענבים', '🍇'], ['תות', '🍓'], ['לימון', '🍋'], ['אבוקדו', '🥑'], ['מנגו', '🥭'],
  ['עוף', '🍗'], ['הודו', '🍗'], ['בקר', '🥩'], ['בשר', '🥩'], ['נקניק', '🌭'],
  ['סלמון', '🐟'], ['דג', '🐟'], ['טונה', '🥫'], ['שימורי', '🥫'],
  ['אורז', '🍚'], ['פסטה', '🍝'], ['ספגטי', '🍝'], ['פתיתים', '🍝'], ['קמח', '🌾'],
  ['שמן זית', '🫒'], ['זיתים', '🫒'], ['שמן', '🛢️'], ['חומוס', '🥣'], ['טחינה', '🥣'],
  ['קפה', '☕'], ['תה ', '🍵'], ['שוקולד', '🍫'], ['עוגי', '🍪'], ['ביסקוויט', '🍪'],
  ['וופל', '🧇'], ['עוגה', '🍰'], ['גלידה', '🍨'], ['במבה', '🥜'], ['חטיף', '🍿'],
  ['בוטנים', '🥜'], ['אגוזי', '🌰'], ['שקדים', '🌰'], ['דבש', '🍯'], ['ריבה', '🍯'],
  ['סוכר', '🧂'], ['מלח', '🧂'], ['מים', '💧'], ['מיץ', '🧃'], ['יין', '🍷'],
  ['בירה', '🍺'], ['קורנפלקס', '🥣'], ['דגני', '🥣'],
  ['נייר טואלט', '🧻'], ['מגבונים', '🧻'], ['חיתולים', '🧷'], ['אבקת כביסה', '🧺'],
  ['כביסה', '🧺'], ['סבון', '🧼'], ['שמפו', '🧴'], ['ניקוי', '🧴'], ['אקונומיקה', '🧴'],
];

const PHOTON_URL = 'https://photon.komoot.io/api/';
const ISRAEL_BBOX = '34.2,29.45,35.95,33.35';                 // lon,lat bounds
/* v0 answers 200 + {status:0} for unknown barcodes — v2 404s lack CORS headers */
const OFF_URL = ean => `https://world.openfoodfacts.org/api/v0/product/${ean}.json?fields=image_front_small_url`;
const PROMO_CLUB = 1, PROMO_COUPON = 2, PROMO_CONDITIONAL = 4;

const PRIORITIES = [
  { key: 'price', label: 'המחיר הכי נמוך', note: 'סל + משלוח' },
  { key: 'balanced', label: 'איזון מחיר וזמינות', note: 'פחות חוסרים' },
  { key: 'fast', label: 'המשלוח הכי מהיר', note: 'עד היום' },
];

const POPULAR_KEYWORDS = ['חלב', 'לחם', 'ביצים', 'קוטג', 'גבינה צהובה', 'עגבניות',
  'מלפפון', 'שמן זית', 'אורז', 'פסטה', 'טונה', 'שוקולד'];

const SAMPLE_LISTS = [
  { id: 'sample-weekly', kicker: 'לדוגמה · שבועי', name: 'קניות הבית',
    keywords: ['חלב', 'ביצים', 'לחם', 'קוטג', 'גבינה צהובה', 'עגבניות'] },
  { id: 'sample-monthly', kicker: 'לדוגמה · חודשי', name: 'מלאי למזווה',
    keywords: ['אורז', 'פסטה', 'טונה', 'שמן זית', 'קמח', 'סוכר'] },
  { id: 'sample-friday', kicker: 'לדוגמה · סוף שבוע', name: 'ארוחת שישי',
    keywords: ['עוף', 'חומוס', 'מלפפון', 'תפוח', 'יין', 'שוקולד'] },
];

const state = {
  screen: 'boot',
  routeParam: '',
  status: 'loading',          // loading | live | error
  errorMsg: '',
  date: '',
  chains: [],                 // labels, order matches product price arrays
  products: [],               // {k,n,u,b,p,nLow,bLow}
  byKey: new Map(),
  popular: [],
  list: new Map(),            // key -> qty
  active: {},                 // label -> bool
  priority: 'price',
  mode: 'single',             // results mode: single | split
  address: '',
  profile: { name: '', email: '', phone: '' },
  saved: [],
  orders: [],
  stats: { comparisons: 0, lastSaving: 0, potential: 0 },
  selectedLists: {},
  note: '',
  subs: {},                   // missingKey -> accepted alt key (basket screen)
  lastHandoff: null,
  visited: false,
  seeded: false,
};

const $ = sel => document.querySelector(sel);
const app = document.getElementById('app');

/* ---------- utils ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function money(n) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function ils0(n) { return '₪' + Math.round(n).toLocaleString('he-IL'); }
let toastTimer = 0;
function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}
function logoSvg(size, dark) {
  const body = '#35858e', handle = dark ? '#fffdfc' : '#35858e',
    eq = dark ? '#9fd0d6' : '#256a73', lines = dark ? '#cfe8eb' : '#9fd0d6';
  return `<svg viewBox="0 0 128 104" style="width:${size}px;height:${Math.round(size * 104 / 128)}px" fill="none" aria-hidden="true">
    <path d="M46 12 L34 40" stroke="${handle}" stroke-width="6" stroke-linecap="round"/>
    <path d="M82 12 L94 40" stroke="${handle}" stroke-width="6" stroke-linecap="round"/>
    <path d="M46 12 H82" stroke="${handle}" stroke-width="6" stroke-linecap="round"/>
    <path d="M10 40 H118 L104 92 A6 6 0 0 1 98 96 H30 A6 6 0 0 1 24 92 Z" fill="${body}"/>
    <path d="M6 40 H122" stroke="${eq}" stroke-width="9" stroke-linecap="round"/>
    <path d="M38 60 H90 M42 76 H86" stroke="${lines}" stroke-width="5" stroke-linecap="round"/>
  </svg>`;
}
function avatar(text, cls = '') {
  return `<span class="avatar ${cls}">${esc((text || '?').trim().charAt(0))}</span>`;
}

/* ---------- product images: OpenFoodFacts by barcode, emoji/letter fallback ---------- */
const imgCache = new Map();
let imgQueue = [], imgActive = 0, imgSaveTimer = 0;
function restoreImgCache() {
  try {
    for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('slim-img-cache-v1') || '{}')))
      imgCache.set(k, v);
  } catch (_) {}
}
function persistImgCache() {
  clearTimeout(imgSaveTimer);
  imgSaveTimer = setTimeout(() => {
    try {
      const entries = [...imgCache].slice(-800);
      localStorage.setItem('slim-img-cache-v1', JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  }, 800);
}
function productEan(pr) {
  if (/^\d{8,}$/.test(pr.k)) return pr.k;
  for (const a of pr.al || []) if (/^\d{8,}$/.test(a)) return a;
  return null;
}
function productEmoji(pr) {
  for (const [kw, emoji] of EMOJI_RULES) if (pr.n.includes(kw)) return emoji;
  return null;
}
function productVisual(pr, cls = '') {
  const ean = productEan(pr);
  const emoji = productEmoji(pr);
  const fallback = emoji || (pr.n || '?').trim().charAt(0);
  const wantImg = ean && imgCache.get(ean) !== 'none';
  return `<span class="avatar img-slot${emoji ? ' emoji' : ''} ${cls}"` +
    `${wantImg ? ` data-ean="${ean}"` : ''}>${esc(fallback)}</span>`;
}
function scanImages() {
  const pending = new Set();
  document.querySelectorAll('.img-slot[data-ean]').forEach(slot => {
    const ean = slot.dataset.ean;
    const cached = imgCache.get(ean);
    if (cached && cached !== 'none') setSlotImage(slot, cached);
    else if (!cached) pending.add(ean);
  });
  imgQueue = [...pending];
  pumpImages();
}
function pumpImages() {
  while (imgActive < 4 && imgQueue.length) {
    const ean = imgQueue.shift();
    if (imgCache.has(ean)) continue;
    imgActive++;
    fetch(OFF_URL(ean))
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const url = (j && j.status === 1 && j.product && j.product.image_front_small_url) || 'none';
        imgCache.set(ean, url);
        if (url !== 'none') {
          document.querySelectorAll(`.img-slot[data-ean="${ean}"]`)
            .forEach(slot => setSlotImage(slot, url));
        }
      })
      .catch(() => imgCache.set(ean, 'none'))
      .finally(() => { persistImgCache(); imgActive--; pumpImages(); });
  }
}
function setSlotImage(slot, url) {
  if (slot.querySelector('img')) return;
  const fallback = slot.textContent;
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => { imgCache.set(slot.dataset.ean, 'none'); persistImgCache(); slot.textContent = fallback; slot.classList.remove('pimg'); };
  img.src = url;
  slot.textContent = '';
  slot.classList.add('pimg');
  slot.appendChild(img);
}

/* ---------- address autocomplete (Photon / OpenStreetMap, Israel bbox) ---------- */
function attachAddressAutocomplete(input) {
  const wrap = input.parentElement;
  wrap.classList.add('addr-wrap');
  const box = document.createElement('div');
  box.className = 'suggest addr-suggest';
  box.hidden = true;
  wrap.appendChild(box);
  let timer = 0, results = [];
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=default&bbox=${ISRAEL_BBOX}`);
        const data = await res.json();
        const seen = new Set();
        results = (data.features || []).map(f => {
          const p = f.properties || {};
          const street = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
          const city = p.city || p.town || p.village || (p.type === 'city' ? p.name : '') || '';
          const label = [street, city && city !== street ? city : ''].filter(Boolean).join(', ');
          return { label, city: city || street };
        }).filter(r => r.label && !seen.has(r.label) && seen.add(r.label)).slice(0, 5);
        if (!results.length) { close(); return; }
        box.innerHTML = results.map((r, i) =>
          `<button type="button" class="suggest-row" data-i="${i}">
             <span class="sug-main"><span class="sug-name">📍 ${esc(r.label)}</span></span>
           </button>`).join('');
        box.hidden = false;
        box.querySelectorAll('.suggest-row').forEach(btn =>
          btn.addEventListener('mousedown', e => {
            e.preventDefault();
            const r = results[+btn.dataset.i];
            input.value = r.label;
            state.address = r.label;
            state.addressCity = r.city;
            persistPrefs();
            close();
            render();
          }));
      } catch (_) { close(); }
    }, 300);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  input.addEventListener('blur', () => setTimeout(close, 200));
}

/* ---------- persistence ---------- */
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} }
function loadLS(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch (_) { return fallback; }
}
function persistList() { saveLS(LS.list, [...state.list]); }
function persistPrefs() {
  saveLS(LS.prefs, { active: state.active, priority: state.priority, address: state.address,
    addressCity: state.addressCity, visited: state.visited, seeded: state.seeded });
}
function restoreAll() {
  restoreImgCache();
  const prefs = loadLS(LS.prefs, {});
  state.priority = prefs.priority || 'price';
  state.address = prefs.address || '';
  state.addressCity = prefs.addressCity || '';
  state.visited = !!prefs.visited;
  state.seeded = !!prefs.seeded;
  state.activeSaved = prefs.active || null;
  state.profile = loadLS(LS.profile, state.profile);
  state.saved = loadLS(LS.saved, []);
  state.orders = loadLS(LS.orders, []);
  state.stats = loadLS(LS.stats, state.stats);
}

/* ---------- data ---------- */
async function loadData() {
  state.status = 'loading';
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    const data = JSON.parse(text);
    state.date = data.date || '';
    state.chains = data.chains || [];
    state.products = (data.products || []).map(([k, n, u, b, p, al, pm]) =>
      ({ k, n, u, b, p, al, pm, nLow: n.toLowerCase(), bLow: (b || '').toLowerCase() }));
    state.byKey = new Map();
    for (const pr of state.products) {
      state.byKey.set(pr.k, pr);
      for (const alias of pr.al || []) state.byKey.set(alias, pr);   // merged products keep old keys
    }
    state.popular = buildPopular();

    // active chains: saved prefs ∩ data, default all on
    const act = {};
    for (const c of state.chains) act[c] = state.activeSaved ? state.activeSaved[c] !== false : true;
    if (!Object.values(act).some(Boolean)) for (const c of state.chains) act[c] = true;
    state.active = act;

    restoreList();
    state.status = 'live';
  } catch (err) {
    console.error('data load failed:', err);
    state.status = 'error';
    state.errorMsg = String(err.message || err);
  }
  render();
}

function restoreList() {
  let entries = loadLS(LS.list, null);
  if (entries === null) entries = loadLS(LS.legacy, []);   // migrate v1 list
  state.list = new Map();
  for (const [k, q] of entries || []) {
    if (state.byKey.has(k)) state.list.set(k, Math.max(1, Math.min(99, q | 0)));
  }
  if (!state.list.size && !state.seeded) {                  // first visit: seed a sample basket
    for (const pr of state.popular.slice(0, 6)) state.list.set(pr.k, 1);
    state.seeded = true;
    state.note = 'מילאנו רשימת דוגמה כדי שתראו איך ההשוואה עובדת — אפשר לערוך או לנקות אותה.';
    persistList(); persistPrefs();
  }
}

const stripQuotes = s => s.replace(/['"׳״`]/g, '');
/* Word-aware match: an exact word beats a word prefix ("חלב" → "חלב טרי", not
   "חלבה"), a first-word hit beats a mid-name hit ("לחם אחיד" over "קמח לחם"),
   and prefixes still catch plurals ("מלפפון" → "מלפפונים"). -1 = no match. */
function keywordScore(pr, kw) {
  if (kw.includes(' ')) return stripQuotes(pr.nLow).includes(kw) ? 1 : -1;
  const words = stripQuotes(pr.nLow).split(/\s+/);
  if (words[0] === kw) return 0;
  if (words.includes(kw)) return 1;
  if (words[0] && words[0].startsWith(kw)) return 2;
  return words.some(w => w.startsWith(kw)) ? 3 : -1;
}
function buildPopular() {
  const found = [];
  const used = new Set();
  for (const kw of POPULAR_KEYWORDS) {
    const k = stripQuotes(kw.toLowerCase());
    let best = null, bestRank = null;
    for (const pr of state.products) {
      if (used.has(pr.k)) continue;
      const ks = keywordScore(pr, k);
      if (ks < 0) continue;
      const rank = [ks, -avail(pr), pr.n.length];
      if (!best || rank[0] < bestRank[0] || (rank[0] === bestRank[0] &&
          (rank[1] < bestRank[1] || (rank[1] === bestRank[1] && rank[2] < bestRank[2])))) {
        best = pr; bestRank = rank;
      }
    }
    if (best) { found.push(best); used.add(best.k); }
    if (found.length >= 8) break;
  }
  return found;
}

/* ---------- computation ---------- */
function avail(pr) { return pr.p.filter(v => v != null).length; }
function meta(label) { return CHAIN_META[label] || { ...FALLBACK_META, initial: label.charAt(0) }; }
function activeLabels() { return state.chains.filter(c => state.active[c]); }
function priceAt(pr, label) { return pr.p[state.chains.indexOf(label)]; }

/* promo helpers — pm entries are [unitPrice|null, desc, flags, minQty] per chain */
function promoAt(pr, label) {
  const ci = state.chains.indexOf(label);
  return (pr.pm && pr.pm[ci]) || null;
}
/* a promo the math may use: has a per-unit price, no club/coupon restriction */
function promoUsable(promo, basePrice) {
  return promo && promo[0] != null && promo[0] < basePrice - 0.005 &&
    !(promo[2] & (PROMO_CLUB | PROMO_COUPON));
}
/* Total for qty units at one chain, including min-qty deals: complete bundles
   of minQty get the promo unit price, the remainder pays the regular price. */
function lineCost(pr, label, qty) {
  const base = priceAt(pr, label);
  if (base == null) return null;
  const promo = promoAt(pr, label);
  if (!promoUsable(promo, base)) return base * qty;
  const m = promo[3] || 1;
  if (m <= 1) return promo[0] * qty;
  const bundles = Math.floor(qty / m), rest = qty % m;
  return bundles * m * promo[0] + rest * base;
}
/* per-unit price for qty-independent displays (a min-qty deal doesn't apply at 1) */
function effPriceAt(pr, label) {
  const base = priceAt(pr, label);
  return base == null ? null : lineCost(pr, label, 1);
}
function promoHint(promo) {
  if (!promo) return '';
  const notes = [];
  if (promo[2] & PROMO_CLUB) notes.push('למועדון');
  if (promo[2] & PROMO_COUPON) notes.push('בקופון');
  if ((promo[3] || 1) > 1) notes.push(`מבצע כמות ${promo[3]}+`);
  return promo[1] + (notes.length ? ` (${notes.join(' · ')})` : '');
}

/* "Add N more to unlock the deal" offers for one chain's basket. Suggests
   completing the partial bundle of every usable min-qty promo; `extra` is the
   cash difference (negative = the total actually drops). */
const MAX_DEAL_ADD = 6;
function dealSuggestions(label, items) {
  const out = [];
  for (const { pr, qty } of items) {
    const base = priceAt(pr, label);
    const promo = promoAt(pr, label);
    if (base == null || !promoUsable(promo, base)) continue;
    const m = promo[3] || 1;
    if (m <= 1) continue;
    const rest = qty % m;
    if (rest === 0) continue;
    const add = m - rest;
    if (add > MAX_DEAL_ADD) continue;
    const extra = lineCost(pr, label, qty + add) - lineCost(pr, label, qty);
    const bundleSave = m * (base - promo[0]);      // completed bundle vs regular
    out.push({ pr, qty, add, m, unit: promo[0], base, extra, bundleSave, desc: promo[1] });
  }
  return out.sort((a, b) => a.extra - b.extra);
}
function minActivePrice(pr, anyChain = false) {
  const labels = anyChain ? state.chains : activeLabels();
  const ps = labels.map(l => effPriceAt(pr, l)).filter(v => v != null);
  return ps.length ? Math.min(...ps) : Infinity;
}
function fromLabel(pr) {
  const m = minActivePrice(pr);
  return m === Infinity ? 'לא זמין ברשתות שנבחרו' : 'מ־' + money(m);
}
function listItems() {
  return [...state.list].map(([k, qty]) => ({ pr: state.byKey.get(k), qty })).filter(x => x.pr);
}
function computeRows() {
  const items = listItems();
  const rows = activeLabels().map(label => {
    const m = meta(label);
    let sub = 0, promoSaved = 0; const missing = [];
    for (const { pr, qty } of items) {
      const base = priceAt(pr, label);
      if (base == null) { missing.push(pr); continue; }
      const cost = lineCost(pr, label, qty);
      sub += cost;
      promoSaved += base * qty - cost;
    }
    const total = sub + m.fee;
    const delivery = deliveryStatus(label);
    const penalty = (state.priority === 'fast' ? m.speed * 22
      : state.priority === 'balanced' ? m.speed * 8 + missing.length * 6
        : missing.length * 12) + (delivery === 'no' ? 500 : 0);
    return { label, m, sub, missing, total, promoSaved, delivery,
             belowMin: sub > 0 && sub < m.min, score: total + penalty };
  });
  rows.sort((a, b) => a.score - b.score);
  const dearest = rows.length ? rows.reduce((a, b) => (a.total > b.total ? a : b)) : null;
  return { items, rows, cheapest: rows[0] || null, dearest };
}
function splitPlan() {
  const items = listItems();
  const byChain = {};
  for (const { pr, qty } of items) {
    let best = null;
    for (const label of activeLabels()) {
      const cost = lineCost(pr, label, qty);
      if (cost != null && (!best || cost < best.cost)) best = { label, cost };
    }
    if (!best) continue;
    const g = byChain[best.label] || (byChain[best.label] = { label: best.label, m: meta(best.label), lines: [], sub: 0 });
    g.lines.push({ pr, qty, price: best.cost });
    g.sub += best.cost;
  }
  const groups = Object.values(byChain).sort((a, b) => b.sub - a.sub);
  const total = groups.reduce((s, g) => s + g.sub + g.m.fee, 0);
  return { groups, total };
}

/* ---------- delivery coverage + next-slot estimation (estimates!) ---------- */
function addressCity() {
  if (state.addressCity) return state.addressCity;
  const addr = (state.address || '').trim();
  if (!addr) return '';
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}
function deliveryStatus(label) {
  const city = addressCity();
  if (!city) return 'unknown';                       // no address yet
  const d = meta(label).delivery;
  if (d === 'nationwide') return 'ok';
  if (!Array.isArray(d)) return 'maybe';
  const norm = s => s.replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  const c = norm(city);
  return d.some(x => norm(x) === c || c.includes(norm(x)) || norm(x).includes(c))
    ? 'ok' : 'no';
}
function deliveryLineH(label) {
  const city = addressCity();
  const status = deliveryStatus(label);
  if (status === 'unknown') return '';
  if (status === 'ok') return `<span class="del ok">✓ משלוח ל${esc(city)} (הערכה)</span>`;
  if (status === 'no') return `<span class="del no">⚠ ייתכן שאין משלוח ל${esc(city)} — בדקו באתר הרשת</span>`;
  return '';
}
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/* Next typical delivery window: lead time by chain speed, 4-hour windows
   9:00–21:00, no Shabbat (Fri afternoon through Sat). An estimate — the real
   slot picker lives in the chain's checkout. */
function nextSlot(label) {
  const lead = { 1: 5, 2: 20, 3: 30 }[meta(label).speed] || 20;
  const t = new Date(Date.now() + lead * 3600 * 1000);
  for (let guard = 0; guard < 14; guard++) {
    const day = t.getDay(), hour = t.getHours();
    const fridayCut = day === 5 && hour >= 13;
    if (day === 6 || fridayCut) {                    // roll to next morning
      t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); continue;
    }
    if (hour < 9) { t.setHours(9, 0, 0, 0); continue; }
    if (hour >= 21) { t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); continue; }
    const start = Math.min(17, 9 + Math.floor((hour - 9) / 4) * 4);
    const today = new Date(), tomorrow = new Date(Date.now() + 864e5);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    const dayLabel = sameDay(t, today) ? 'היום'
      : sameDay(t, tomorrow) ? 'מחר' : `יום ${DAY_NAMES[t.getDay()]}`;
    return `${dayLabel} ${start}:00–${start + 4}:00`;
  }
  return '';
}

/* ---------- list ops ---------- */
function addItem(key) {
  state.list.set(key, Math.min(99, (state.list.get(key) || 0) + 1));
  persistList();
  toast('נוסף: ' + state.byKey.get(key).n);
}
function bumpItem(key, d) {
  const q = (state.list.get(key) || 0) + d;
  if (q <= 0) state.list.delete(key); else state.list.set(key, Math.min(99, q));
  persistList();
}

/* ---------- router ---------- */
const APP_SCREENS = new Set(['build', 'results', 'basket', 'done', 'saved', 'profile',
  'terms', 'accessibility']);
function nav(hash) { location.hash = hash; }
function route() {
  // split BEFORE decoding — chain labels may contain an encoded slash (%2F)
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/')
    .map(p => { try { return decodeURIComponent(p); } catch (_) { return p; } });
  let screen = parts[0] || (state.visited ? 'build' : 'onboarding');
  state.routeParam = parts[1] || '';
  const known = new Set(['onboarding', 'setup', ...APP_SCREENS]);
  if (!known.has(screen)) screen = 'build';
  if (screen === 'basket' && !state.chains.includes(state.routeParam)) screen = 'results';
  if (screen === 'done' && !state.lastHandoff) screen = 'build';
  state.screen = screen;
  if (screen !== 'basket') state.subs = {};
  render();
  if (screen === 'results') recordComparison();
  window.scrollTo(0, 0);
}
let lastComparisonSig = '';
function recordComparison() {
  const { rows, cheapest, dearest } = computeRows();
  if (!state.list.size || rows.length < 2) return;
  const sig = [...state.list].map(([k, q]) => k + ':' + q).sort().join('|') + '|' + activeLabels().join(',');
  if (sig === lastComparisonSig) return;
  lastComparisonSig = sig;
  const saving = Math.max(0, dearest.total - cheapest.total);
  state.stats.comparisons++;
  state.stats.lastSaving = saving;
  state.stats.potential += saving;
  saveLS(LS.stats, state.stats);
}

/* ---------- shared chrome ---------- */
function statusPillH() {
  if (state.status === 'live') {
    return `<button class="pill-status live" data-action="reload" title="לחצו לרענון">
      <span class="dot"></span><span class="pill-text">מחירים חיים · ${esc(state.date)} · ${state.products.length.toLocaleString('he-IL')} מוצרים</span></button>`;
  }
  if (state.status === 'loading') {
    return `<span class="pill-status wait"><span class="dot"></span><span class="pill-text">טוען מחירים מהצילום היומי…</span></span>`;
  }
  return `<button class="pill-status err" data-action="reload"><span class="dot"></span><span class="pill-text">שגיאה בטעינת נתונים · נסו שוב</span></button>`;
}
function navH() {
  const links = [
    ['build', 'הרשימה'], ['results', 'השוואה'], ['saved', 'רשימות שמורות'], ['profile', 'הפרופיל'],
  ].map(([key, label]) =>
    `<a class="nav-link${state.screen === key ? ' on' : ''}" href="#/${key}">${label}</a>`).join('');
  const initial = (state.profile.name || 'א').trim().charAt(0);
  return `<header class="topnav">
    <div class="nav-right">
      <a class="brand" href="#/onboarding" aria-label="ליםSlim — מסך פתיחה">${logoSvg(34, true)}<span class="brand-name" dir="ltr">ליםSlim</span></a>
      <nav class="nav-links">${links}</nav>
    </div>
    <div class="nav-left">
      ${statusPillH()}
      ${state.address ? `<span class="nav-address">משלוח אל ${esc(state.address)}</span>` : ''}
      <a class="nav-avatar" href="#/profile" aria-label="הפרופיל">${esc(initial)}</a>
    </div>
  </header>`;
}
function footH() {
  return `<footer class="foot">
    <p>© 2026 כל הזכויות שמורות ל־Segolan Holdings</p>
    <p><a href="#/terms">תנאי שימוש</a> · <a href="#/accessibility">הצהרת נגישות</a></p>
  </footer>`;
}
function noteH() {
  if (!state.note) return '';
  return `<div class="note-banner"><span class="note-check">✓</span><span class="note-text">${esc(state.note)}</span>
    <button class="note-x" data-action="dismiss-note" aria-label="סגירה">×</button></div>`;
}
function errorCardH() {
  return `<div class="wrap"><div class="error-card">
    <h2>לא הצלחנו לטעון את הנתונים</h2>
    <p>קובץ הנתונים <code>site/data/products.json.gz</code> לא נטען (${esc(state.errorMsg)}).</p>
    <p>בהרצה מקומית: <code>python build_site_data.py</code> ואז רענון.</p>
    <button class="btn-primary" data-action="reload">ניסיון חוזר</button>
  </div></div>`;
}

/* ---------- screens ---------- */
function onboardingH() {
  const chips = state.chains.map(label =>
    `<button class="chip${state.active[label] ? ' on' : ''}" data-action="toggle-chain" data-chain="${esc(label)}">${esc(label)}</button>`).join('');
  const items = listItems().slice(0, 4);
  const preview = items.length ? items.map(({ pr, qty }) =>
    `<div class="hero-line"><span>${esc(pr.n)}</span><span class="muted">×${qty}</span></div>`).join('')
    : `<div class="hero-line muted">הרשימה עדיין ריקה</div>`;
  const { cheapest } = computeRows();
  const winner = cheapest && state.list.size
    ? `<div class="hero-win"><div><div class="hero-win-k">הזול ביותר היום</div>
         <div class="hero-win-name">${esc(cheapest.label)} אונליין</div></div>
       <div class="hero-win-total">${ils0(cheapest.total)}</div></div>` : '';
  return `<div class="ob">
    <div class="ob-main">
      <div class="ob-brand">${logoSvg(44, false)}<span dir="ltr">ליםSlim</span></div>
      <div class="ob-badge">נתוני שקיפות מחירים רשמיים · מתעדכן יומית</div>
      <h1 class="ob-title">רשימה אחת.<br>הסל הזול ביותר.</h1>
      <p class="ob-sub">בונים רשימת קניות פעם אחת, וסלים משווה אותה מול חנויות האונליין של הרשתות
        המובילות בישראל — כולל הערכת דמי משלוח, מינימום הזמנה וזמינות מלאי — ומכינה את ההזמנה במקום הזול ביותר.</p>
      <div class="ob-form">
        <div class="field"><label>כתובת למשלוח</label>
          <input id="obAddress" class="input" placeholder="רחוב, מספר, עיר" value="${esc(state.address)}"></div>
        <div class="field"><label>רשתות להשוואה</label><div class="chips">${chips || '<span class="muted">טוען רשתות…</span>'}</div></div>
        <div class="ob-ctas">
          <button class="btn-primary lg" data-action="go-build">בניית הרשימה שלי</button>
          <button class="btn-outline" data-action="go-setup">הגדרת פרופיל</button>
        </div>
      </div>
    </div>
    <div class="ob-hero">
      <div class="ob-blob"></div>
      <div class="hero-card">
        <div class="hero-card-title">הסל השבועי שלי</div>
        ${preview}
      </div>
      ${winner}
    </div>
  </div>`;
}

function buildH() {
  const t = computeRows();
  const popular = state.popular.map(pr => `
    <div class="pop-tile">
      ${productVisual(pr, 'lg')}
      <span class="pop-name">${esc(pr.n)}</span>
      <div class="pop-foot">
        <span class="pop-from">${esc(fromLabel(pr))}</span>
        <button class="add-round" data-action="add" data-key="${esc(pr.k)}" aria-label="הוספה">+</button>
      </div>
    </div>`).join('');
  const rows = t.items.map(({ pr, qty }) => {
    const promo = activeLabels().map(l => promoAt(pr, l)).find(Boolean);
    return `
    <div class="item-row">
      ${productVisual(pr)}
      <div class="item-main">
        <span class="item-name">${esc(pr.n)}
          ${promo ? `<span class="promo-tag" title="${esc(promoHint(promo))}">🏷 מבצע</span>` : ''}</span>
        <span class="item-meta">${esc([pr.b, pr.u].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="stepper">
        <button data-action="dec" data-key="${esc(pr.k)}" aria-label="הפחתה">−</button>
        <span>${qty}</span>
        <button data-action="inc" data-key="${esc(pr.k)}" aria-label="הוספה">+</button>
      </div>
      <div class="item-from">${esc(fromLabel(pr))}</div>
      <button class="item-x" data-action="remove" data-key="${esc(pr.k)}" aria-label="הסרה">×</button>
    </div>`;
  }).join('');
  const prio = PRIORITIES.map(p => `
    <button class="prio${state.priority === p.key ? ' on' : ''}" data-action="priority" data-priority="${p.key}">
      <span>${p.label}</span><span class="prio-note">${p.note}</span>
    </button>`).join('');
  const est = t.cheapest && t.items.length
    ? { label: ils0(t.cheapest.total),
        note: `הכי זול כרגע: ${t.cheapest.label} · כולל משלוח משוער ${ils0(t.cheapest.m.fee)}` }
    : { label: '₪0', note: 'הוסיפו מוצרים כדי לראות הערכה' };
  return `<div class="wrap page">
    <h2 class="page-title">מה צריך השבוע?</h2>
    <p class="page-sub">מחפשים מוצר בקטלוג — הוא נמצא בכל הרשתות ומושווה אוטומטית.</p>
    <div class="bld-grid">
      <div>
        <div class="search-wrap">
          <input id="searchInput" class="input search" autocomplete="off" enterkeyhint="search"
            placeholder="חיפוש מוצר — חלב, ביצים, אורז…">
          <div id="suggestBox" class="suggest" hidden></div>
        </div>
        <div class="pop-block">
          <div class="block-kicker">מוצרים נפוצים</div>
          <div class="pop-grid">${popular}</div>
        </div>
        ${noteH()}
        <div class="card list-card">
          <div class="list-head"><h3>הרשימה שלי</h3><span class="muted">${t.items.length} מוצרים ברשימה</span></div>
          ${t.items.length ? rows : '<div class="list-empty">הרשימה ריקה — חפשו מוצר או בחרו מהמוצרים הנפוצים.</div>'}
          ${t.items.length ? `<div class="list-foot"><button class="btn-ghost" data-action="clear-list">🗑 ניקוי הרשימה</button></div>` : ''}
        </div>
      </div>
      <aside class="bld-side">
        <div class="side-card tinted">
          <h4>מה חשוב לך?</h4>
          <p class="muted sm">קובע איך נדרג את הרשתות.</p>
          <div class="prio-list">${prio}</div>
        </div>
        <div class="side-card elevated">
          <div class="est-row"><span class="muted sm">הערכה מוקדמת</span><span class="est-num">${est.label}</span></div>
          <div class="muted sm est-note">${esc(est.note)}</div>
          <button class="btn-primary block" data-action="go-results">השוואת מחירים</button>
          <button class="btn-outline block" data-action="save-list">שמירת הרשימה</button>
        </div>
      </aside>
    </div>
  </div>`;
}

function resultsH() {
  const t = computeRows();
  if (!t.items.length) {
    return `<div class="wrap page"><div class="card empty-cta">
      <h2>אין עדיין מה להשוות</h2><p class="muted">הוסיפו מוצרים לרשימה ונחשב את הסל הזול ביותר.</p>
      <button class="btn-primary" data-action="go-build">לבניית הרשימה</button></div></div>`;
  }
  const modes = [['single', 'חנות אחת'], ['split', 'פיצול חכם']].map(([key, label]) =>
    `<button class="seg-opt${state.mode === key ? ' on' : ''}" data-action="mode" data-mode="${key}">${label}</button>`).join('');
  const head = t.cheapest ? `הסל הזול ביותר: ${t.cheapest.label}` : 'אין תוצאות';
  const sub = t.cheapest && t.dearest
    ? `${t.items.length} מוצרים · חיסכון של ${ils0(Math.max(0, t.dearest.total - t.cheapest.total))} לעומת הרשת היקרה ביותר · נתוני ${esc(state.date)}`
    : '';
  let body;
  if (state.mode === 'single') {
    body = `<div class="res-list">` + t.rows.map(r => {
      const barW = t.dearest ? Math.round((r.total / t.dearest.total) * 100) : 100;
      const isBest = r === t.cheapest;
      const slot = nextSlot(r.label);
      return `<div class="res-card${isBest ? ' best' : ''}">
        ${avatar(r.m.initial, 'chain')}
        <div class="res-main">
          <div class="res-name-row">
            <span class="res-name">${esc(r.label)} אונליין</span>
            ${isBest ? '<span class="tag best-tag">הכי משתלם</span>' : ''}
            ${r.missing.length ? `<span class="tag miss-tag" title="${esc(r.missing.map(p => p.n).join(', '))}">${r.missing.length === 1 ? 'מוצר אחד חסר' : r.missing.length + ' מוצרים חסרים'}</span>` : ''}
            ${r.belowMin ? `<span class="tag min-tag">מתחת למינימום ${ils0(r.m.min)}</span>` : ''}
            ${r.promoSaved > 0.005 ? `<span class="tag promo-tag">🏷 כולל מבצעים בשווי ${money(r.promoSaved)}</span>` : ''}
          </div>
          <div class="res-meta">${slot ? `משלוח קרוב: ${slot} (הערכה) · ` : ''}דמי משלוח ${ils0(r.m.fee)} · מינימום ${ils0(r.m.min)}${deliveryLineH(r.label) ? ' · ' + deliveryLineH(r.label) : ''}</div>
          ${(() => {
            const deals = dealSuggestions(r.label, t.items);
            if (!deals.length) return '';
            const potential = deals.reduce((s, d) => s + d.bundleSave, 0);
            return `<div class="res-deal-hint">💡 השלמת ${deals.length === 1 ? 'מבצע כמות אחד' : deals.length + ' מבצעי כמות'} תחסוך עוד עד ${money(potential)} — בדף פירוט הסל</div>`;
          })()}
          <div class="bar"><div class="bar-fill" style="width:${barW}%"></div></div>
        </div>
        <div class="res-total">
          <div class="res-total-num">${ils0(r.total)}</div>
          <div class="res-delta">${r === t.cheapest ? 'הזול ביותר'
            : r.total >= t.cheapest.total ? '+' + ils0(r.total - t.cheapest.total)
            : `זול ב־${ils0(t.cheapest.total - r.total)} אך חסרים ${r.missing.length}`}</div>
        </div>
        <button class="btn-outline" data-action="pick" data-chain="${esc(r.label)}">פירוט הסל</button>
      </div>`;
    }).join('') + `</div>`;
  } else {
    const sp = splitPlan();
    const vsBest = t.cheapest
      ? (sp.total < t.cheapest.total
        ? 'חיסכון של ' + ils0(t.cheapest.total - sp.total)
        : 'יקר ב־' + ils0(sp.total - t.cheapest.total) + ' מחנות אחת') : '';
    body = `<div class="split-head">
        <div><div class="split-title">פיצול בין ${sp.groups.length} רשתות</div>
        <div class="muted">כל מוצר נלקח מהרשת הזולה עבורו, כולל ${sp.groups.length} דמי משלוח משוערים</div></div>
        <div class="split-total"><div class="res-total-num">${ils0(sp.total)}</div>
        <div class="res-delta">${esc(vsBest)}</div></div>
      </div>
      <div class="split-grid">` + sp.groups.map(g => `
        <div class="card split-card">
          <div class="split-card-head">
            <span class="split-chain">${avatar(g.m.initial, 'chain sm')}${esc(g.label)} אונליין</span>
            <span class="muted sm">${g.lines.length} מוצרים</span>
          </div>
          ${g.lines.map(l => `<div class="split-line"><span>${esc(l.pr.n)}${l.qty > 1 ? ' ×' + l.qty : ''}</span>
            <span class="muted">${money(l.price)}</span></div>`).join('')}
          <div class="split-foot"><span class="muted sm">משלוח משוער ${ils0(g.m.fee)}</span><b>${ils0(g.sub + g.m.fee)}</b></div>
        </div>`).join('') + `</div>`;
  }
  return `<div class="wrap page">
    <div class="res-head">
      <div><h2 class="page-title">${esc(head)}</h2><p class="page-sub">${sub}</p></div>
      <div class="seg">${modes}</div>
    </div>
    ${body}
    <p class="fine">דמי המשלוח, המינימום וחלונות האספקה הם הערכות · המחיר הסופי נקבע באתר הרשת.</p>
  </div>`;
}

function findSubstitute(missingPr, label) {
  const words = missingPr.nLow.split(' ').filter(Boolean);
  if (!words.length || words[0].length < 2) return null;
  const target = minActivePrice(missingPr, true);
  // a two-word prefix ("גבינה צהובה…") beats a one-word one ("גבינה…")
  const prefixes = words.length > 1 ? [words[0] + ' ' + words[1], words[0]] : [words[0]];
  for (const prefix of prefixes) {
    let best = null, bestGap = Infinity;
    for (const pr of state.products) {
      if (pr.k === missingPr.k || state.list.has(pr.k)) continue;
      const p = effPriceAt(pr, label);
      if (p == null || !pr.nLow.startsWith(prefix)) continue;
      const gap = Math.abs(p - (target === Infinity ? p : target));
      if (gap < bestGap) { best = { pr, price: p }; bestGap = gap; }
    }
    if (best) return best;
  }
  return null;
}

function basketH() {
  const label = state.routeParam;
  const t = computeRows();
  const r = t.rows.find(x => x.label === label);
  if (!r) return resultsH();
  const m = meta(label);
  const lines = t.items.filter(({ pr }) => priceAt(pr, label) != null);
  const linesH = lines.map(({ pr, qty }) => {
    const ean = productEan(pr);
    const link = m.search
      ? `<a class="line-link" href="${m.search(m.barcode && ean ? ean : pr.n)}" target="_blank" rel="noopener">חיפוש בחנות ↗</a>` : '';
    const base = priceAt(pr, label), cost = lineCost(pr, label, qty);
    const promo = promoAt(pr, label);
    const priceH = cost < base * qty - 0.005
      ? `<div class="item-price"><s class="old-price">${money(base * qty)}</s> ${money(cost)}</div>`
      : `<div class="item-price">${money(cost)}</div>`;
    return `<div class="item-row">
      ${productVisual(pr)}
      <div class="item-main">
        <span class="item-name">${esc(pr.n)}
          ${promo ? `<span class="promo-tag" title="${esc(promoHint(promo))}">🏷 ${esc(promo[1].slice(0, 28))}${promo[1].length > 28 ? '…' : ''}</span>` : ''}</span>
        <span class="item-meta">${esc([pr.b, pr.u].filter(Boolean).join(' · '))}${qty > 1 ? ` · ${qty} יח׳` : ''} ${link}</span>
      </div>
      ${priceH}
    </div>`;
  }).join('');

  const deals = dealSuggestions(label, t.items);
  const dealsH = deals.map(d => {
    const line = d.extra <= 0.005
      ? `<b class="deal-drop">מוסיפים ${d.add === 1 ? 'יחידה' : d.add + ' יחידות'} — והסל יורד ב־${money(Math.abs(d.extra))}!</b>`
      : `בתוספת ${money(d.extra)} מקבלים ${d.m} יח׳ במחיר המבצע — חיסכון של ${money(d.bundleSave)} לעומת מחיר רגיל`;
    return `<div class="sub-row deal-row">
      ${productVisual(d.pr)}
      <div class="sub-main">
        <div class="sub-name">${esc(d.pr.n)}</div>
        <div class="muted sm">🏷 ${esc(d.desc)} · יש ${d.qty} בסל · ${line}</div>
      </div>
      <button class="btn-outline sm" data-action="complete-deal" data-key="${esc(d.pr.k)}"
        data-target="${d.qty + d.add}">+${d.add} להשלמת המבצע</button>
    </div>`;
  }).join('');

  const subs = r.missing.map(pr => {
    const alt = findSubstitute(pr, label);
    if (!alt) return { pr, none: true };
    return { pr, alt, accepted: state.subs[pr.k] === alt.pr.k };
  });
  const subsH = subs.map(s => s.none
    ? `<div class="sub-row"><div class="sub-main"><div class="sub-missing">${esc(s.pr.n)}</div>
        <div class="muted sm">לא נמצאה חלופה דומה ברשת זו</div></div></div>`
    : `<div class="sub-row">
        <div class="sub-main"><div class="sub-missing">${esc(s.pr.n)}</div>
        <div class="sub-name">${esc(s.alt.pr.n)}</div></div>
        <div class="item-price">${money(s.alt.price)}</div>
        <button class="${s.accepted ? 'btn-primary sm' : 'btn-outline sm'}" data-action="toggle-sub"
          data-missing="${esc(s.pr.k)}" data-alt="${esc(s.alt.pr.k)}">${s.accepted ? '✓ נוסף לסל' : 'הוספה'}</button>
      </div>`).join('');

  const acceptedTotal = subs.reduce((sum, s) => sum + (s.alt && s.accepted ? s.alt.price : 0), 0);
  const total = r.sub + acceptedTotal + m.fee;
  const belowMin = r.sub + acceptedTotal < m.min;
  const slot = nextSlot(label);
  return `<div class="wrap page">
    <a class="back-link" href="#/results">← חזרה להשוואה</a>
    <h2 class="page-title">הסל שלך ב${esc(label)}</h2>
    <p class="page-sub">${lines.length} מתוך ${t.items.length} מוצרים נמצאו${slot ? ' · משלוח קרוב: ' + esc(slot) + ' (הערכה)' : ''}</p>
    <div class="bsk-grid">
      <div>
        <div class="card">${linesH || '<div class="list-empty">אף מוצר מהרשימה לא נמצא ברשת זו.</div>'}</div>
        ${deals.length ? `<div class="side-card tinted subs-card deals-card">
          <h4>💡 השלמת מבצעים</h4>
          <p class="muted sm">מבצעי כמות שכמעט הגעתם אליהם — הוסיפו יחידות כדי לקבל את מחיר המבצע.</p>
          ${dealsH}</div>` : ''}
        ${r.missing.length ? `<div class="side-card tinted subs-card">
          <h4>חלופות למוצרים חסרים</h4>
          <p class="muted sm">מוצרים שלא נמצאו ב${esc(label)} — הצעה לחלופה דומה במחיר אמיתי מהקטלוג.</p>
          ${subsH}</div>` : ''}
      </div>
      <aside class="side-card elevated checkout">
        <div class="co-head">${avatar(m.initial, 'chain')}<span>${esc(label)} אונליין</span></div>
        <div class="co-rows">
          <div class="co-row"><span class="muted">סל המוצרים (${lines.length})</span><b>${money(r.sub)}</b></div>
          ${r.promoSaved > 0.005 ? `<div class="co-row promo"><span class="muted">🏷 כבר כולל מבצעים בשווי</span><b>${money(r.promoSaved)}</b></div>` : ''}
          <div class="co-row"><span class="muted">חלופות שנוספו</span><b>${money(acceptedTotal)}</b></div>
          <div class="co-row"><span class="muted">דמי משלוח (הערכה)</span><b>${money(m.fee)}</b></div>
          ${slot ? `<div class="co-row"><span class="muted">משלוח קרוב (הערכה)</span><b>${esc(slot)}</b></div>` : ''}
          ${deliveryLineH(label) ? `<div class="co-row"><span></span>${deliveryLineH(label)}</div>` : ''}
          ${belowMin ? `<div class="co-row warn"><span>שימו לב</span><b>מתחת למינימום ${ils0(m.min)}</b></div>` : ''}
        </div>
        <div class="co-total"><span>לתשלום (משוער)</span><span class="co-total-num">${ils0(total)}</span></div>
        <button class="btn-primary block" data-action="handoff" data-chain="${esc(label)}">בניית ההזמנה ב${esc(label)}</button>
        <p class="fine center">ההזמנה נבנית בעגלת האתר של הרשת — הרשימה תועתק ללוח והחנות תיפתח בלשונית חדשה. התשלום מתבצע מול הרשת.</p>
      </aside>
    </div>
  </div>`;
}

function doneH() {
  const h = state.lastHandoff;
  return `<div class="done">
    <div class="done-circle">✓</div>
    <h2>הרשימה מוכנה ל${esc(h.label)}</h2>
    <p class="page-sub">העתקנו ${h.count} מוצרים (${ils0(h.total)} משוער) ללוח ופתחנו את ${esc(h.label)} אונליין בלשונית חדשה —
      הדביקו את הרשימה בחיפוש החנות או עברו מוצר־מוצר, ואשרו את העגלה שם.</p>
    <div class="done-ctas">
      <button class="btn-primary" data-action="go-saved">הרשימות שלי</button>
      <button class="btn-outline" data-action="go-build">חזרה לרשימה</button>
    </div>
  </div>`;
}

function savedEntries() {
  const own = state.saved.map(s => ({ ...s, own: true }));
  if (own.length) return own;
  return SAMPLE_LISTS.map(def => {
    const codes = [];
    for (const kw of def.keywords) {
      const k = stripQuotes(kw.toLowerCase());
      let best = null, bestRank = 9;
      for (const pr of state.products) {
        const ks = keywordScore(pr, k);
        if (ks < 0) continue;
        const rank = ks - avail(pr) / 10;
        if (!best || rank < bestRank) { best = pr; bestRank = rank; }
      }
      if (best && !codes.some(([key]) => key === best.k)) codes.push([best.k, 1]);
    }
    return { id: def.id, kicker: def.kicker, name: def.name, codes, own: false };
  }).filter(s => s.codes.length >= 3);
}
function savedH() {
  const entries = savedEntries();
  const selCount = Object.values(state.selectedLists).filter(Boolean).length;
  const mergeBar = selCount > 1 ? `${selCount} רשימות נבחרו — האיחוד ימזג מוצרים כפולים לרשומה אחת`
    : selCount === 1 ? 'סמנו רשימה נוספת כדי לאחד' : 'סמנו שתי רשימות או יותר כדי לאחד אותן';
  const cards = entries.map(s => {
    const prods = s.codes.map(([k]) => state.byKey.get(k)).filter(Boolean);
    const best = s.codes.reduce((sum, [k, q]) => {
      const pr = state.byKey.get(k);
      const mp = pr ? minActivePrice(pr) : Infinity;
      return sum + (mp === Infinity ? 0 : mp * q);
    }, 0);
    const sel = !!state.selectedLists[s.id];
    return `<div class="card saved-card">
      <div class="saved-head"><span class="block-kicker">${esc(s.kicker)}</span>
        <button class="sel-round${sel ? ' on' : ''}" data-action="toggle-select" data-id="${esc(s.id)}"
          aria-label="בחירה">${sel ? '✓' : '+'}</button></div>
      <div class="saved-name">${esc(s.name)}</div>
      <div class="saved-preview">${esc(prods.slice(0, 4).map(p => p.n.split(' ').slice(0, 2).join(' ')).join(', '))}${prods.length > 4 ? ' ועוד' : ''}</div>
      <div class="saved-foot"><span class="muted sm">${prods.length} מוצרים</span><span class="saved-price">${ils0(best)}</span></div>
      <button class="btn-outline block" data-action="load-list" data-id="${esc(s.id)}">טעינת הרשימה</button>
      ${s.own ? `<button class="btn-ghost sm" data-action="delete-list" data-id="${esc(s.id)}">מחיקה</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="wrap page">
    <h2 class="page-title">רשימות שמורות</h2>
    <p class="page-sub">טוענים רשימה קיימת, או מסמנים כמה רשימות ומאחדים אותן לרשימה אחת — כפילויות מתמזגות אוטומטית.${state.saved.length ? '' : ' (אלה רשימות לדוגמה — שמרו רשימה משלכם ממסך הרשימה.)'}</p>
    ${noteH()}
    <div class="merge-bar"><span>${mergeBar}</span>
      <div class="merge-ctas">
        ${selCount > 1 ? '<button class="btn-primary" data-action="merge-lists">איחוד הרשימות שנבחרו</button>' : ''}
        ${selCount > 0 ? '<button class="btn-outline" data-action="clear-select">ניקוי הבחירה</button>' : ''}
        <button class="btn-outline" data-action="save-list">שמירת הרשימה הנוכחית</button>
      </div>
    </div>
    <div class="saved-grid">${cards}</div>
  </div>`;
}

function setupH() {
  return `<div class="auth">
    <div class="auth-form">
      <div class="ob-brand">${logoSvg(44, false)}<span dir="ltr">ליםSlim</span></div>
      <h2 class="page-title">הגדרת פרופיל</h2>
      <p class="page-sub">הפרטים נשמרים בדפדפן שלכם בלבד — אין שרת, אין סיסמה ואין הרשמה.</p>
      <div class="field"><label>שם מלא</label>
        <input id="fName" class="input" placeholder="דנה כהן" value="${esc(state.profile.name)}"></div>
      <div class="field"><label>דוא״ל (לא חובה)</label>
        <input id="fEmail" class="input" type="email" placeholder="you@example.com" value="${esc(state.profile.email)}"></div>
      <div class="field"><label>כתובת למשלוח</label>
        <input id="fAddress" class="input" placeholder="רחוב, מספר, עיר" value="${esc(state.address)}"></div>
      <button class="btn-primary block lg" data-action="save-profile">שמירה והמשך</button>
      <button class="btn-ghost block" data-action="go-build">דילוג בינתיים</button>
    </div>
    <div class="auth-aside">
      <div class="auth-blob a"></div><div class="auth-blob b"></div>
      <div class="auth-aside-in">
        <h3>פרופיל אחד, כל הרשתות במקום אחד.</h3>
        ${['רשימות שמורות שמחושבות מחדש לפי מחירי היום',
           'העדפות רשתות וכתובת שנשמרות בדפדפן',
           'מעקב אחרי פוטנציאל החיסכון שלכם'].map(t =>
          `<div class="perk"><span class="perk-check">✓</span><span>${t}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

function profileH() {
  const p = state.profile;
  const chips = state.chains.map(label =>
    `<button class="chip${state.active[label] ? ' on' : ''}" data-action="toggle-chain" data-chain="${esc(label)}">${esc(label)}</button>`).join('');
  const stats = [
    ['חיסכון בהשוואה האחרונה', ils0(state.stats.lastSaving)],
    ['פוטנציאל חיסכון מצטבר', ils0(state.stats.potential)],
    ['השוואות שבוצעו', String(state.stats.comparisons)],
  ].map(([l, v]) => `<div class="stat-row"><span class="muted">${l}</span><span class="stat-num">${v}</span></div>`).join('');
  const orders = state.orders.slice(0, 5).map(o =>
    `<div class="order-row"><div><div class="order-store">${esc(o.store)}</div>
      <div class="muted sm">${esc(o.date)} · ${o.count} מוצרים</div></div><b>${ils0(o.total)}</b></div>`).join('')
    || '<div class="muted sm">עוד לא הוכנו הזמנות — בחרו רשת במסך ההשוואה.</div>';
  return `<div class="wrap page">
    <div class="pro-grid">
      <div>
        <div class="card pro-head">
          ${avatar(p.name || 'א', 'xl')}
          <div class="pro-id"><h2>${esc(p.name || 'אורח/ת')}</h2><div class="muted">${esc(p.email || 'הפרופיל נשמר בדפדפן בלבד')}</div></div>
          <button class="btn-outline" data-action="go-setup">עריכת פרופיל</button>
        </div>
        <div class="card">
          <h4>פרטי משלוח</h4>
          <div class="pro-fields">
            <div class="field"><label>כתובת</label>
              <input id="pAddress" class="input" value="${esc(state.address)}" placeholder="רחוב, מספר, עיר"></div>
            <div class="field"><label>טלפון</label>
              <input id="pPhone" class="input" value="${esc(p.phone)}" placeholder="050-0000000"></div>
          </div>
        </div>
        <div class="card">
          <h4>רשתות מועדפות</h4>
          <p class="muted sm">רק הרשתות המסומנות נכללות בהשוואה.</p>
          <div class="chips">${chips}</div>
        </div>
      </div>
      <aside class="bld-side">
        <div class="side-card tinted"><h4>החיסכון שלי</h4>${stats}</div>
        <div class="side-card elevated"><h4>הזמנות שהוכנו</h4>${orders}
          <button class="btn-outline block" data-action="go-saved">הרשימות השמורות שלי</button></div>
        <button class="btn-ghost block" data-action="reset-profile">מחיקת הפרופיל והנתונים מהדפדפן</button>
      </aside>
    </div>
  </div>`;
}

function termsH() {
  return `<div class="wrap page legal">
    <h2 class="page-title">תנאי שימוש</h2>
    <p class="muted sm">עודכן לאחרונה: 9 באוגוסט 2026</p>
    <div class="card">
      <h4>1. כללי</h4>
      <p>אתר "ליםSlim" (להלן: "האתר") מופעל על ידי Segolan Holdings (להלן: "החברה") ומציג
      השוואת מחירים ומבצעים בין חנויות האונליין של רשתות מזון בישראל, לצד כלים לבניית
      רשימת קניות. השימוש באתר מהווה הסכמה מלאה לתנאים אלה. אם אינכם מסכימים לתנאים —
      אנא הימנעו משימוש באתר.</p>
      <h4>2. אופי המידע באתר</h4>
      <p>המחירים והמבצעים מחושבים מקבצי מחירונים פומביים שהרשתות מפרסמות מכוח הדין,
      ומתעדכנים על בסיס יומי. ייתכנו פערים בין הנתונים המוצגים לבין המחיר בפועל.
      דמי המשלוח, מינימום ההזמנה, חלונות האספקה ואזורי החלוקה המוצגים באתר הם
      <b>הערכות בלבד</b>. המחיר הסופי, זמינות המוצרים ותנאי האספקה נקבעים אך ורק
      באתר הרשת שבה מתבצעת ההזמנה.</p>
      <h4>3. העדר אחריות</h4>
      <p>האתר והמידע שבו מסופקים כמות שהם (AS-IS) וללא כל אחריות, מפורשת או משתמעת.
      החברה אינה מתחייבת לדיוק, שלמות, עדכניות או זמינות המידע והשירות, ולא תישא
      בכל אחריות ו/או חבות, ישירה או עקיפה, לכל נזק, הפסד או הוצאה שייגרמו למשתמש
      או לצד שלישי בקשר עם השימוש באתר או הסתמכות על המידע שבו — והשימוש הוא באחריות
      המשתמש בלבד. ההזמנה, התשלום והאספקה מתבצעים ישירות מול הרשת הרלוונטית; החברה
      אינה צד לעסקה, אינה מוכרת מוצרים ואינה אחראית להם.</p>
      <h4>4. קניין רוחני</h4>
      <p>© כל הזכויות באתר, בעיצובו ובסימניו שמורות ל־Segolan Holdings. אין להעתיק,
      לשכפל, להפיץ או לעשות שימוש מסחרי בתכני האתר ללא אישור מראש ובכתב מהחברה.
      שמות הרשתות וסימני המסחר המוזכרים באתר שייכים לבעליהם.</p>
      <h4>5. מקורות מידע</h4>
      <p>נתוני המחירים והמבצעים: מיזם <a href="https://www.gov.il/he/pages/cpfta_prices_regulations"
      target="_blank" rel="noopener">שקיפות המחירים</a> של משרד הכלכלה והתעשייה, מתוך
      הקבצים שמפרסמות הרשתות (שופרסל, רמי לוי, ויקטורי, יינות ביתן / קרפור, יוחננוף,
      אושר עד). השלמת כתובות: © <a href="https://www.openstreetmap.org/copyright"
      target="_blank" rel="noopener">OpenStreetMap</a> contributors (שירות Photon).
      תמונות מוצרים (בקירוב, לפי ברקוד): <a href="https://world.openfoodfacts.org/"
      target="_blank" rel="noopener">Open Food Facts</a>.</p>
      <h4>6. פרטיות</h4>
      <p>רשימות הקניות, ההעדפות והפרופיל נשמרים בדפדפן המשתמש בלבד ואינם נשלחים לשרתי
      החברה. חיפוש כתובת ותמונות מוצרים כרוכים בפנייה לשירותים חיצוניים (OpenStreetMap /
      Open Food Facts) בהתאם לתנאי אותם שירותים.</p>
      <h4>7. שינויים ודין חל</h4>
      <p>החברה רשאית לעדכן את האתר ואת התנאים בכל עת. על תנאים אלה יחולו דיני מדינת
      ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים במחוז תל אביב.</p>
    </div>
  </div>`;
}

function accessibilityH() {
  return `<div class="wrap page legal">
    <h2 class="page-title">הצהרת נגישות</h2>
    <p class="muted sm">עודכנה לאחרונה: 9 באוגוסט 2026</p>
    <div class="card">
      <h4>מחויבות לנגישות</h4>
      <p>Segolan Holdings פועלת להנגשת אתר "ליםSlim" לאנשים עם מוגבלות, מתוך תפיסה של
      שוויון הזדמנויות ובהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998,
      ולתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013,
      בשאיפה לעמידה בתקן הישראלי ת"י 5568 ברמה AA (בהתבסס על הנחיות WCAG 2.1).</p>
      <h4>התאמות הנגישות באתר</h4>
      <p>האתר תומך בניווט מלא במקלדת עם סימון מיקוד ברור, כתוב ב־HTML סמנטי עם תוויות
      ARIA לרכיבים אינטראקטיביים, מותאם לעברית וכיוון RTL, רספונסיבי למובייל, ושומר על
      ניגודיות צבעים נאותה. בנוסף זמין בכל עמודי האתר <b>תפריט נגישות</b> (הכפתור ♿
      בפינת המסך) המאפשר: הגדלת טקסט, ניגודיות גבוהה, גווני אפור, הדגשת קישורים,
      גופן קריא ועצירת אנימציות. ההעדפות נשמרות בדפדפן.</p>
      <h4>מגבלות ידועות</h4>
      <p>תמונות המוצרים מגיעות ממקור חיצוני (Open Food Facts) וייתכן שלחלקן חסר תיאור
      מלא; אתרי הרשתות שאליהם מפנה האתר אינם בשליטתנו ורמת הנגישות בהם באחריות
      מפעיליהם. אנו ממשיכים לפעול לשיפור הנגישות באופן שוטף.</p>
      <h4>פנייה בנושא נגישות</h4>
      <p>נתקלתם בקושי או שיש לכם הצעה לשיפור? נשמח לשמוע ולטפל בהקדם:
      Segolan Holdings — דוא"ל: <a href="mailto:asegalil1@gmail.com">asegalil1@gmail.com</a>.</p>
    </div>
  </div>`;
}

/* ---------- accessibility widget (persistent, on every screen) ---------- */
const A11Y_KEY = 'slim-a11y-v1';
const a11y = loadLS(A11Y_KEY, { font: 0, contrast: false, gray: false,
  links: false, readable: false, noanim: false });
function applyA11y() {
  const c = document.documentElement.classList;
  c.toggle('a11y-links', a11y.links);
  c.toggle('a11y-readable', a11y.readable);
  c.toggle('a11y-noanim', a11y.noanim);
  document.body.style.zoom = [1, 1.15, 1.3][a11y.font] || 1;
  const filters = [];
  if (a11y.contrast) filters.push('invert(1) hue-rotate(180deg)');
  if (a11y.gray) filters.push('grayscale(1)');
  document.body.style.filter = filters.join(' ');
  c.toggle('a11y-contrast', a11y.contrast);
  saveLS(A11Y_KEY, a11y);
  const panel = $('.a11y-panel');
  if (panel) {
    panel.querySelectorAll('[data-a11y]').forEach(btn => {
      const k = btn.dataset.a11y;
      const on = k === 'font' ? a11y.font > 0 : !!a11y[k];
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      if (k === 'font') btn.querySelector('.a11y-note').textContent =
        ['רגיל', '+15%', '+30%'][a11y.font];
    });
  }
}
function mountA11y() {
  if ($('.a11y-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'a11y-btn';
  btn.setAttribute('aria-label', 'פתיחת תפריט נגישות');
  btn.textContent = '♿';
  const panel = document.createElement('div');
  panel.className = 'a11y-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תפריט נגישות');
  panel.hidden = true;
  const opts = [
    ['font', 'הגדלת טקסט'], ['contrast', 'ניגודיות גבוהה'], ['gray', 'גווני אפור'],
    ['links', 'הדגשת קישורים'], ['readable', 'גופן קריא'], ['noanim', 'עצירת אנימציות'],
  ];
  panel.innerHTML = `<div class="a11y-head"><b>נגישות</b>
      <button class="a11y-close" aria-label="סגירה">×</button></div>` +
    opts.map(([k, label]) =>
      `<button class="a11y-opt" data-a11y="${k}" aria-pressed="false">
         <span>${label}</span><span class="a11y-note"></span></button>`).join('') +
    `<button class="a11y-opt a11y-reset">איפוס הגדרות</button>
     <a class="a11y-link" href="#/accessibility">הצהרת נגישות</a>`;
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  panel.querySelector('.a11y-close').addEventListener('click', () => { panel.hidden = true; });
  panel.querySelector('.a11y-reset').addEventListener('click', () => {
    Object.assign(a11y, { font: 0, contrast: false, gray: false, links: false, readable: false, noanim: false });
    applyA11y();
  });
  panel.querySelectorAll('[data-a11y]').forEach(el =>
    el.addEventListener('click', () => {
      const k = el.dataset.a11y;
      if (k === 'font') a11y.font = (a11y.font + 1) % 3;
      else a11y[k] = !a11y[k];
      applyA11y();
    }));
  panel.addEventListener('click', e => {
    if (e.target.closest('.a11y-link')) panel.hidden = true;
  });
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  applyA11y();
}

/* ---------- render & events ---------- */
function render() {
  if (state.status === 'error') { app.innerHTML = navH() + errorCardH() + footH(); return; }
  if (state.status === 'loading' && state.screen === 'boot') return;   // keep splash
  const isApp = APP_SCREENS.has(state.screen);
  let body;
  switch (state.screen) {
    case 'onboarding': body = onboardingH(); break;
    case 'setup': body = setupH(); break;
    case 'build': body = buildH(); break;
    case 'results': body = resultsH(); break;
    case 'basket': body = basketH(); break;
    case 'done': body = doneH(); break;
    case 'saved': body = savedH(); break;
    case 'profile': body = profileH(); break;
    case 'terms': body = termsH(); break;
    case 'accessibility': body = accessibilityH(); break;
    default: body = buildH();
  }
  app.innerHTML = (isApp ? navH() : '') + body + (isApp ? footH() : '');
  bindScreen();
}

function bindScreen() {
  const activeLink = $('.nav-link.on');
  if (activeLink) activeLink.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const si = $('#searchInput');
  if (si) {
    let timer = 0;
    si.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderSuggest(si.value), 120);
    });
    si.addEventListener('keydown', e => { if (e.key === 'Escape') hideSuggest(); });
  }
  for (const sel of ['#obAddress', '#pAddress', '#fAddress']) {
    const el = $(sel);
    if (el) {
      el.addEventListener('input', () => {
        state.address = el.value.trim();
        state.addressCity = '';              // free-typed — city re-derived from text
        persistPrefs();
      });
      attachAddressAutocomplete(el);
    }
  }
  bindField('#pPhone', v => { state.profile.phone = v; saveLS(LS.profile, state.profile); });
  scanImages();
}
function bindField(sel, save) {
  const el = $(sel);
  if (el) el.addEventListener('input', () => save(el.value.trim()));
}

function hideSuggest() { const b = $('#suggestBox'); if (b) { b.hidden = true; b.innerHTML = ''; } }
function renderSuggest(query) {
  const box = $('#suggestBox');
  if (!box) return;
  const q = query.trim().toLowerCase();
  if (q.length < 2) { hideSuggest(); return; }
  const scored = [];
  for (const pr of state.products) {
    let score;
    if (pr.nLow.startsWith(q)) score = 0;
    else if (pr.nLow.includes(' ' + q)) score = 1;
    else if (pr.nLow.includes(q) || pr.bLow.includes(q)) score = 2;
    else if (/^\d{3,}$/.test(q) && pr.k.startsWith(q)) score = 1;
    else continue;
    scored.push([score, pr]);
  }
  scored.sort((a, b) => a[0] - b[0] || avail(b[1]) - avail(a[1]) ||
    minActivePrice(a[1], true) - minActivePrice(b[1], true));
  const top = scored.slice(0, 8);
  if (!top.length) { box.innerHTML = '<div class="suggest-none">לא נמצאו מוצרים תואמים</div>'; box.hidden = false; return; }
  box.innerHTML = top.map(([, pr]) => `
    <button class="suggest-row" data-action="add-search" data-key="${esc(pr.k)}">
      <span class="sug-main"><span class="sug-name">${esc(pr.n)}</span>
      <span class="sug-sub">${esc([pr.b, pr.u].filter(Boolean).join(' · ') || 'ללא פרטים')}</span></span>
      <span class="sug-from">${esc(fromLabel(pr))}</span>
    </button>`).join('');
  box.hidden = false;
}

function doHandoff(label) {
  const t = computeRows();
  const r = t.rows.find(x => x.label === label);
  if (!r) return;
  const m = meta(label);
  const lines = t.items.filter(({ pr }) => priceAt(pr, label) != null);
  const subsAccepted = Object.entries(state.subs)
    .map(([mk, ak]) => state.byKey.get(ak)).filter(Boolean);
  const acceptedTotal = subsAccepted.reduce((s, pr) => s + (effPriceAt(pr, label) || 0), 0);
  const total = r.sub + acceptedTotal + m.fee;
  const rows = [`רשימת קניות — ${label} אונליין (סלים · נתוני ${state.date})`, ''];
  let i = 1;
  for (const { pr, qty } of lines) {
    const cost = lineCost(pr, label, qty);
    const promoMark = cost < priceAt(pr, label) * qty - 0.005 ? ' 🏷' : '';
    rows.push(`${i++}. ${pr.n}${pr.u ? ` (${pr.u})` : ''} — ×${qty} — ${money(cost)}${promoMark}`);
  }
  for (const pr of subsAccepted) rows.push(`${i++}. ${pr.n} (חלופה) — ×1 — ${money(effPriceAt(pr, label) || 0)}`);
  rows.push('', `סה״כ משוער כולל משלוח: ${ils0(total)}`);
  copyText(rows.join('\n'));
  if (m.home) window.open(m.home, '_blank', 'noopener');
  state.orders.unshift({ store: label, date: state.date || new Date().toISOString().slice(0, 10),
    count: lines.length + subsAccepted.length, total });
  state.orders = state.orders.slice(0, 20);
  saveLS(LS.orders, state.orders);
  state.lastHandoff = { label, count: lines.length + subsAccepted.length, total };
  nav('#/done/' + encodeURIComponent(label));
}

function saveCurrentList() {
  if (!state.list.size) { toast('הרשימה ריקה — אין מה לשמור'); return; }
  const name = prompt('שם לרשימה:', 'הרשימה שלי · ' + (state.date || ''));
  if (name === null) return;
  state.saved.unshift({ id: 'own-' + Date.now(), kicker: 'שלי',
    name: name.trim() || 'רשימה ללא שם', codes: [...state.list], created: state.date });
  saveLS(LS.saved, state.saved);
  toast('הרשימה נשמרה');
  nav('#/saved');
  render();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) { if (!e.target.closest('.search-wrap')) hideSuggest(); return; }
  const a = btn.dataset.action;
  const key = btn.dataset.key;
  switch (a) {
    case 'reload': loadData(); render(); break;
    case 'go-build': state.visited = true; persistPrefs(); nav('#/build'); break;
    case 'go-setup': nav('#/setup'); break;
    case 'go-results': nav('#/results'); break;
    case 'go-saved': nav('#/saved'); break;
    case 'add': addItem(key); render(); break;
    case 'add-search': {
      addItem(key);
      const si = $('#searchInput');
      const v = si ? si.value : '';
      render();
      const si2 = $('#searchInput');
      if (si2) { si2.value = v; si2.focus(); renderSuggest(v); }
      break;
    }
    case 'inc': bumpItem(key, 1); render(); break;
    case 'dec': bumpItem(key, -1); render(); break;
    case 'remove': bumpItem(key, -99); render(); break;
    case 'clear-list':
      if (confirm('לנקות את כל הרשימה?')) { state.list.clear(); persistList(); render(); }
      break;
    case 'toggle-chain': {
      const c = btn.dataset.chain;
      state.active[c] = !state.active[c];
      if (!Object.values(state.active).some(Boolean)) { state.active[c] = true; toast('חייבת להישאר רשת אחת לפחות'); }
      persistPrefs(); render(); break;
    }
    case 'priority': state.priority = btn.dataset.priority; persistPrefs(); render(); break;
    case 'mode': state.mode = btn.dataset.mode; render(); break;
    case 'pick': nav('#/basket/' + encodeURIComponent(btn.dataset.chain)); break;
    case 'toggle-sub': {
      const mk = btn.dataset.missing, ak = btn.dataset.alt;
      if (state.subs[mk] === ak) delete state.subs[mk]; else state.subs[mk] = ak;
      render(); break;
    }
    case 'complete-deal': {
      const target = Math.min(99, parseInt(btn.dataset.target, 10) || 0);
      if (target > 0) {
        state.list.set(btn.dataset.key, target);
        persistList();
        toast('הכמות עודכנה למחיר המבצע 🏷');
        render();
      }
      break;
    }
    case 'handoff': doHandoff(btn.dataset.chain); break;
    case 'save-list': saveCurrentList(); break;
    case 'toggle-select': {
      const id = btn.dataset.id;
      state.selectedLists[id] = !state.selectedLists[id];
      render(); break;
    }
    case 'clear-select': state.selectedLists = {}; render(); break;
    case 'load-list': {
      const entry = savedEntries().find(s => s.id === btn.dataset.id);
      if (!entry) break;
      if (state.list.size && !confirm('להחליף את הרשימה הנוכחית ברשימה "' + entry.name + '"?')) break;
      state.list = new Map(entry.codes.filter(([k]) => state.byKey.has(k)));
      persistList();
      state.note = 'נטענה הרשימה "' + entry.name + '"';
      nav('#/build'); render(); break;
    }
    case 'delete-list': {
      if (!confirm('למחוק את הרשימה השמורה?')) break;
      state.saved = state.saved.filter(s => s.id !== btn.dataset.id);
      saveLS(LS.saved, state.saved);
      render(); break;
    }
    case 'merge-lists': {
      const picks = savedEntries().filter(s => state.selectedLists[s.id]);
      const seen = new Map(); let dupes = 0;
      for (const s of picks) for (const [k] of s.codes) {
        if (!state.byKey.has(k)) continue;
        if (seen.has(k)) dupes++; else seen.set(k, 1);
      }
      state.list = seen;
      persistList();
      state.selectedLists = {};
      state.note = `אוחדו ${picks.length} רשימות ל־${seen.size} מוצרים` + (dupes ? ` · ${dupes} כפילויות הוסרו` : ' · ללא כפילויות');
      nav('#/build'); render(); break;
    }
    case 'dismiss-note': state.note = ''; render(); break;
    case 'save-profile': {
      state.profile.name = ($('#fName') || {}).value?.trim() || '';
      state.profile.email = ($('#fEmail') || {}).value?.trim() || '';
      state.address = ($('#fAddress') || {}).value?.trim() || state.address;
      saveLS(LS.profile, state.profile); persistPrefs();
      state.visited = true; persistPrefs();
      toast('הפרופיל נשמר בדפדפן');
      nav('#/build'); break;
    }
    case 'reset-profile': {
      if (!confirm('למחוק את הפרופיל, הרשימות וההיסטוריה מהדפדפן?')) break;
      Object.values(LS).forEach(k => localStorage.removeItem(k));
      location.hash = ''; location.reload(); break;
    }
  }
});

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', () => {
  restoreAll();
  mountA11y();
  loadData().then(() => route());
});
