/* סלים=Slim — grocery-list price comparison over the daily transparency snapshot.
   Implements the "Slim" product design (onboarding → build → results → basket →
   handoff, plus saved lists & local profile) on top of site/data/products.json.gz. */
'use strict';

const DATA_URL = 'data/products.json.gz';

/* ---------- accounts (login/signup) ----------------------------------------
   Real accounts run on Firebase Authentication (email+password + Google) with
   per-user cloud sync of lists/orders/preferences in Firestore. To activate:
   1. console.firebase.google.com → Add project (any name, Analytics optional)
   2. Build → Authentication → Get started → enable "Email/Password" AND "Google"
   3. Build → Firestore Database → Create database (production mode)
   4. Firestore → Rules → paste and publish:
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /users/{uid} { allow read, write: if request.auth.uid == uid; }
          }
        }
   5. Project settings → Your apps → Web app (</>) → copy the config object
      and paste it below in place of `null`
   6. Authentication → Settings → Authorized domains → add slim-super.com
   Until then the site runs in device-profile mode (no password, this browser
   only). */
/* NOTE: this apiKey is a PUBLIC project identifier, not a secret (per
   Firebase docs it cannot be hidden in a web app and grants no data access).
   Data protection = Firestore Security Rules + Authorized domains + the
   API-key website/API restrictions set in the Google Cloud console. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBzZQ5ePYqn7BLEC5QjkuRRn-zoPodNJKM',
  authDomain: 'slim-super-82fc1.firebaseapp.com',
  projectId: 'slim-super-82fc1',
  storageBucket: 'slim-super-82fc1.firebasestorage.app',
  messagingSenderId: '1048151548009',
  appId: '1:1048151548009:web:879f7baf9bb672baaf02f8',
};

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
    home: 'https://www.victoryonline.co.il/',
    search: q => `https://www.victoryonline.co.il/search/${encodeURIComponent(q)}`, barcode: true },
  'יוחננוף': { initial: 'י', fee: 30, min: 200, speed: 2,
    delivery: ['תל אביב', 'ראשון לציון', 'רחובות', 'פתח תקווה', 'ראש העין', 'נתניה',
      'אשדוד', 'אשקלון', 'באר שבע', 'ירושלים', 'חיפה', 'קרית אתא', 'חדרה', 'לוד',
      'רמלה', 'מודיעין', 'יבנה', 'חולון', 'בת ים', 'רמת גן', 'גדרה', 'עפולה'],
    home: 'https://yochananof.co.il/',
    search: q => `https://yochananof.co.il/search?q=${encodeURIComponent(q)}`, barcode: true },
  'אושר עד': { initial: 'א', noOnline: true,           // no online store exists
    branches: 'https://osherad.co.il/stores/', fee: 35, min: 300, speed: 3,
    delivery: ['ירושלים', 'בית שמש', 'ביתר עילית', 'מודיעין עילית', 'בני ברק',
      'אלעד', 'אשדוד', 'פתח תקווה', 'חיפה', 'רכסים', 'טבריה', 'צפת', 'נתיבות'],
    home: 'https://www.osherad.co.il/' },
  'טיב טעם': { initial: 'ט', fee: 45, min: 200, speed: 2, delivery: 'nationwide',
    home: 'https://www.tivtaam.co.il/',
    search: q => `https://www.tivtaam.co.il/catalogsearch/result/?q=${encodeURIComponent(q)}` },
  'יינות ביתן / קרפור': { initial: 'ק', fee: 29, min: 200, speed: 2, delivery: 'nationwide',
    home: 'https://www.carrefour.co.il/',
    search: q => `https://www.carrefour.co.il/search/${encodeURIComponent(q)}`, barcode: true },
  'חצי חינם': { initial: 'ח', fee: 35, min: 250, speed: 2,
    delivery: ['ראשון לציון', 'חולון', 'בת ים', 'תל אביב', 'רמת גן', 'פתח תקווה',
      'ראש העין', 'רחובות', 'נס ציונה', 'מודיעין', 'אשדוד', 'הוד השרון'],
    home: 'https://shop.hazi-hinam.co.il/',
    search: q => `https://shop.hazi-hinam.co.il/searchResults/${encodeURIComponent(q)}`, barcode: true },
};
const FALLBACK_META = { initial: '?', fee: 30, min: 200, speed: 2, delivery: 'nationwide' };

/* Chain logos — TRADEMARKS of their owners. Ship a logo ONLY with the chain's
   permission: drop the approved file in site/logos/ and map it here; chains
   without an entry keep the neutral initial avatar. */
const CHAIN_LOGOS = {
  // 'שופרסל': 'logos/shufersal.png',
  // 'רמי לוי': 'logos/rami-levy.png',
};
function chainVisual(label, cls = '') {
  const src = CHAIN_LOGOS[label];
  if (!src) return avatar(meta(label).initial, 'chain ' + cls);
  return `<span class="avatar chain pimg ${cls}"><img src="${src}" alt="${esc(label)}" loading="lazy"></span>`;
}

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
  auth: { mode: 'local', user: null, ready: false },
  authMode: 'login',          // login | signup (auth screen tab)
  authError: '',
  authBusy: false,
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
  categories: [],
  catFilter: null,            // category index being browsed, null = popular
  catPage: 0,                 // category browsing is paged (24/page), sorted א״ב
  catLetter: null,            // optional first-letter filter within the category
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
  receipt: { stage: 'idle', progress: 0, statusText: '', imgUrl: '', items: [], error: '',
    saveAsList: true, returnTo: '' },
  recipe: { stage: 'idle', url: '', text: '', pasteOpen: false, error: '', statusText: '',
    name: '', ingredients: [], saveAsList: true },
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
/* the ליםSlim browser extension marks the page when installed */
function hasExtension() {
  return !!document.documentElement.dataset.slimExtension;
}
/* Chrome Web Store URL of the extension — paste once the listing is approved
   and every promo becomes a live install button */
const EXTENSION_URL = null;
function extensionPromoH(compact = false) {
  if (hasExtension()) return '';
  const cta = EXTENSION_URL
    ? `<a class="btn-primary sm" href="${EXTENSION_URL}" target="_blank" rel="noopener">🧩 התקנת התוסף</a>`
    : `<span class="tag promo-tag">בקרוב בחנות Chrome</span>`;
  if (compact) {
    if (loadLS('slim-ext-promo-hidden', false)) return '';
    return `<div class="side-card tinted ext-promo">
      <button class="note-x" data-action="hide-ext-promo" aria-label="סגירה">×</button>
      <b>🧩 התוסף של ליםSlim</b>
      <p class="muted sm">מעביר את הרשימה ישר לעגלה באתר הרשת — בלחיצה אחת, בתוך החשבון שלכם.</p>
      ${cta}
    </div>`;
  }
  return `<div class="ext-promo-inline">
    🧩 <b>רוצים שהעגלה תתמלא לבד?</b> התוסף של ליםSlim מלווה אתכם באתר הרשת
    ומוסיף את המוצרים לעגלה אוטומטית. ${cta}
  </div>`;
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
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  if (typeof SYNC_KEYS !== 'undefined' && SYNC_KEYS.includes(key)) scheduleCloudPush();
}
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

/* ---------- auth engine (Firebase when configured, device profile otherwise) ---------- */
const SYNC_KEYS = [LS.list, LS.prefs, LS.profile, LS.saved, LS.orders, LS.stats];
let cloudTimer = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initAuth() {
  if (!FIREBASE_CONFIG) { state.auth = { mode: 'local', user: null, ready: true }; return; }
  try {
    const v = '10.14.1';
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
    await Promise.all([
      loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`),
      loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`),
    ]);
    firebase.initializeApp(FIREBASE_CONFIG);
    state.auth = { mode: 'firebase', user: null, ready: false };
    firebase.auth().getRedirectResult().then(cred => {
      // registration that completed via the mobile/blocked-popup redirect
      // flow → same receipt-scan onboarding step as the popup flow
      if (cred && cred.user && cred.additionalUserInfo && cred.additionalUserInfo.isNewUser)
        welcomeToReceipt();
    }).catch(err => {
      state.authError = authErrHe(err);
      render();
    });
    firebase.auth().onAuthStateChanged(async u => {
      state.auth.user = u ? { uid: u.uid, email: u.email || '',
        name: u.displayName || '' } : null;
      state.auth.ready = true;
      if (u && state.screen === 'setup') { state.visited = true; persistPrefs(); nav('#/build'); }
      if (u) {
        await cloudPull(u.uid);
        if (!state.profile.name && u.displayName) {
          state.profile.name = u.displayName;
          saveLS(LS.profile, state.profile);
        }
        if (!state.profile.email && u.email) {
          state.profile.email = u.email;
          saveLS(LS.profile, state.profile);
        }
      }
      render();
    });
  } catch (err) {
    console.warn('auth unavailable, using device profile:', err);
    state.auth = { mode: 'local', user: null, ready: true };
  }
}

function scheduleCloudPush() {
  if (state.auth.mode !== 'firebase' || !state.auth.user) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(cloudPush, 1500);
}
async function cloudPush() {
  const u = state.auth.user;
  if (!u) return;
  const data = { updatedAt: Date.now() };
  for (const k of SYNC_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) data[k] = v;
  }
  try {
    await firebase.firestore().collection('users').doc(u.uid).set(data);
  } catch (err) { console.warn('cloud sync failed:', err); }
}
async function cloudPull(uid) {
  try {
    const snap = await firebase.firestore().collection('users').doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      for (const k of SYNC_KEYS) {
        if (typeof data[k] === 'string') localStorage.setItem(k, data[k]);
      }
      restoreAll();
      if (state.byKey.size) restoreList();
    } else {
      cloudPush();                       // first login on this account: seed from device
    }
  } catch (err) { console.warn('cloud pull failed:', err); }
}

function authErrHe(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-email': 'כתובת הדוא"ל אינה תקינה',
    'auth/email-already-in-use': 'כבר קיים חשבון עם הדוא"ל הזה — נסו להתחבר',
    'auth/weak-password': 'הסיסמה חלשה מדי — לפחות 6 תווים',
    'auth/wrong-password': 'דוא"ל או סיסמה שגויים',
    'auth/invalid-credential': 'דוא"ל או סיסמה שגויים',
    'auth/user-not-found': 'לא נמצא חשבון עם הדוא"ל הזה — נסו להירשם',
    'auth/too-many-requests': 'יותר מדי ניסיונות — נסו שוב מאוחר יותר',
    'auth/popup-closed-by-user': 'חלון ההתחברות נסגר לפני שהסתיימה ההתחברות',
    'auth/network-request-failed': 'בעיית רשת — בדקו את החיבור ונסו שוב',
    'auth/popup-blocked': 'הדפדפן חסם את חלון ההתחברות — מעבירים אתכם לדף ההתחברות של Google…',
    'auth/operation-not-allowed': 'שיטת ההתחברות אינה מופעלת בפרויקט',
    'auth/unauthorized-domain': 'הדומיין אינו מורשה להתחברות — יש להוסיפו ב-Firebase',
  };
  return map[code] || 'ההתחברות נכשלה — נסו שוב';
}

async function authSubmit() {
  const email = ($('#aEmail') || {}).value?.trim() || '';
  const pass = ($('#aPass') || {}).value || '';
  state.authError = '';
  if (!email || !pass) { state.authError = 'נא למלא דוא"ל וסיסמה'; render(); return; }
  state.authBusy = true; render();
  try {
    if (state.authMode === 'signup') {
      const name = ($('#aName') || {}).value?.trim() || '';
      const addr = ($('#aAddress') || {}).value?.trim() || '';
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      if (name) await cred.user.updateProfile({ displayName: name });
      state.profile.name = name || state.profile.name;
      state.profile.email = email;
      if (addr) state.address = addr;
      saveLS(LS.profile, state.profile);
      toast('החשבון נוצר — ברוכים הבאים! ☁');
    } else {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
      toast('התחברת בהצלחה ☁');
    }
    state.visited = true; persistPrefs();
    state.authBusy = false;
    if (state.authMode === 'signup') welcomeToReceipt(); else nav('#/build');
  } catch (err) {
    state.authError = authErrHe(err);
    state.authBusy = false; render();
  }
}
async function authGoogle() {
  state.authError = ''; state.authBusy = true; render();
  const provider = new firebase.auth.GoogleAuthProvider();
  // mobile browsers (esp. iOS Safari) block popups — go straight to redirect
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  try {
    if (mobile) { await firebase.auth().signInWithRedirect(provider); return; }
    const cred = await firebase.auth().signInWithPopup(provider);
    state.visited = true; persistPrefs();
    state.authBusy = false;
    toast('התחברת עם Google ☁');
    // a first-ever sign-in is a registration → receipt-scan onboarding step
    if (cred && cred.additionalUserInfo && cred.additionalUserInfo.isNewUser) welcomeToReceipt();
    else nav('#/build');
  } catch (err) {
    if (err && (err.code === 'auth/popup-blocked' ||
                err.code === 'auth/operation-not-supported-in-this-environment')) {
      try { await firebase.auth().signInWithRedirect(provider); return; }
      catch (err2) { err = err2; }
    }
    state.authError = authErrHe(err);
    state.authBusy = false; render();
  }
}
/* post-registration onboarding: start with a receipt scan that fills the list */
function welcomeToReceipt() {
  state.receipt.returnTo = '';
  state.note = 'החשבון מוכן 🎉 הדרך המהירה לרשימה ראשונה: סרקו קבלה מקנייה אחרונה — ' +
    'ונזהה בה את המוצרים. אפשר גם לדלג ולבנות את הרשימה ידנית.';
  nav('#/receipt');
}
async function authReset() {
  const email = ($('#aEmail') || {}).value?.trim() || '';
  if (!email) { state.authError = 'מלאו את שדה הדוא"ל ולחצו שוב על "שכחתי סיסמה"'; render(); return; }
  try {
    await firebase.auth().sendPasswordResetEmail(email);
    state.authError = '';
    toast('נשלח מייל לאיפוס הסיסמה 📧');
  } catch (err) { state.authError = authErrHe(err); render(); }
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
    state.categories = data.categories || [];
    state.products = (data.products || []).map(([k, n, u, b, p, al, pm, c]) => {
      const codes = [];
      for (const v of [k, ...(al || [])]) {
        const m = String(v).match(/\d{3,}/);
        if (m && !codes.includes(m[0])) codes.push(m[0]);
      }
      return { k, n, u, b, p, al, pm, c: c || 0, codes,
        nLow: n.toLowerCase(), bLow: (b || '').toLowerCase() };
    });
    state.byKey = new Map();
    for (const pr of state.products) {
      state.byKey.set(pr.k, pr);
      for (const alias of pr.al || []) state.byKey.set(alias, pr);   // merged products keep old keys
    }
    rcptIndex = null;                       // receipt-scan index rebuilds on demand
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
    const total = sub + (m.noOnline ? 0 : m.fee);
    const delivery = deliveryStatus(label);
    const penalty = (state.priority === 'fast' ? m.speed * 22
      : state.priority === 'balanced' ? m.speed * 8 + missing.length * 6
        : missing.length * 12) + (delivery === 'no' ? 500 : 0);
    return { label, m, sub, missing, total, promoSaved, delivery,
             belowMin: !m.noOnline && sub > 0 && sub < m.min, score: total + penalty };
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

/* ---------- receipt scan: photo → in-browser OCR → catalog match ----------
   Economical by design: OCR runs entirely on the user's device via the
   open-source Tesseract engine (WASM), lazy-loaded from a CDN only when the
   screen is used — no paid API, no server, and the photo never leaves the
   browser. The Hebrew model (~4MB) downloads once and is cached (IndexedDB).
   Matching is code-first: receipts print each item's מק"ט/barcode, and digits
   OCR far more reliably than Hebrew — a 7-13 digit hit is an exact catalog
   match. Hebrew lines without a usable code fall back to token matching over
   an inverted word index (final letters normalized, so OCR ם/מ mixups and
   plural prefixes still match). */
const TESSERACT_JS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/* receipt lines that are never products (totals, payment, header/footer).
   Applied only to lines WITHOUT a code that resolves in the catalog — a real
   מק"ט wins over a suspicious word. */
const RECEIPT_SKIP_RE = new RegExp([
  'סה["״\']?כ', 'לתשלום', 'שולם', 'מזומן', 'אשראי', 'עודף', 'מע["״\']?מ',
  'חשבונית', 'קבלה', 'תודה', 'להתראות', 'כרטיס', 'ויזה', 'מאסטרקארד',
  'ישראכרט', 'מועדון', 'נקודות', 'צברת', 'חסכת', 'הנחת', 'הנחה', 'זיכוי',
  'החזר', 'קופאי', 'בקופה', 'קופה', 'תאריך', 'שעה', 'טלפון', 'פקס',
  'ח\\.פ', 'עוסק', 'בע["״\']?מ', 'סניף', 'רחוב', 'מספר עסקה', 'פריטים', 'ברוכים',
].join('|'));
/* chain names appear in receipt headers; only suspicious without a price —
   private-label product lines ("לחם שופרסל") carry a price and survive */
const RECEIPT_CHAIN_RE = /שופרסל|רמי לוי|ויקטורי|יוחננוף|אושר עד|טיב טעם|יינות ביתן|קרפור|חצי חינם/;
/* generic packaging/receipt words — never count as a match signal */
const RECEIPT_TOKEN_STOP = new Set(['גרם', 'גר', 'מל', 'ליטר', 'יח', 'יחי',
  'יחידות', 'כמות', 'מחיר', 'מבצע', 'מארז', 'אריזה', 'קג', 'קילו', 'שח']);

const HEB_FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function hebNorm(s) { return s.replace(/[ךםןףץ]/g, ch => HEB_FINALS[ch]); }

/* strong tokens carry the match (Hebrew words, "3%"), weak tokens (bare sizes
   like 80 / 500) only break ties — the same tokenizer runs on catalog names */
function receiptTokens(s) {
  const strong = [], weak = [];
  const clean = stripQuotes(String(s).toLowerCase()).replace(/[^א-תa-z0-9%\s]/g, ' ');
  for (const w0 of clean.split(/\s+/)) {
    const w = hebNorm(w0);
    if (!w) continue;
    if (/[א-ת]/.test(w)) {
      if (w.length >= 2 && !RECEIPT_TOKEN_STOP.has(w)) strong.push(w);
    } else if (/^\d{1,2}%$/.test(w)) strong.push(w);
    else if (/^\d{1,4}$/.test(w)) weak.push(w);
  }
  return { strong: strong.slice(0, 8), weak: weak.slice(0, 4) };
}

/* inverted index over catalog names + exact code lookup, built lazily once per
   data load (loadData resets it) */
let rcptIndex = null;
function ensureReceiptIndex() {
  if (rcptIndex) return;
  const words = new Map(), pre3 = new Map(), codes = new Map();
  const push = (map, key, i) => {
    const arr = map.get(key);
    if (arr) arr.push(i); else map.set(key, [i]);
  };
  state.products.forEach((pr, i) => {
    const t = receiptTokens(pr.nLow);
    pr.rw = t.strong; pr.rwWeak = t.weak;
    for (const w of new Set(t.strong)) {
      push(words, w, i);
      if (w.length >= 3) push(pre3, w.slice(0, 3), i);
    }
    for (const c0 of pr.codes) {
      const c = c0.replace(/^0+/, '');
      if (c.length < 7 || c.length > 13) continue;   // short PLUs are chain-scoped → ambiguous
      const prev = codes.get(c);
      if (prev == null || avail(pr) > avail(state.products[prev])) codes.set(c, i);
    }
  });
  rcptIndex = { words, pre3, codes };
}

function receiptQty(s) {
  let m = s.match(/(?:^|\s)([1-9]\d?)\s*[x×*]/i);          // "2 X 6.90"
  if (!m) m = s.match(/[x×*]\s*([1-9]\d?)(?![\d.,])/i);    // "X2" (not the price after X)
  if (!m) m = s.match(/(?:^|\s)([1-9]\d?)\s*יח/);          // "2 יח'"
  const q = m ? parseInt(m[1], 10) : 1;
  return q >= 1 && q <= 30 ? q : 1;
}

function receiptPriceFrom(s, looseOk = false) {
  const m = [...s.matchAll(/(\d{1,3})[.,](\d{2})(?!\d)/g)];
  if (m.length) {
    const last = m[m.length - 1];
    return parseFloat(last[1] + '.' + last[2]);
  }
  if (looseOk) {                                  // OCR ate the decimal point
    const lone = [...s.matchAll(/(?:^|\s)(\d{3,4})(?=\s|$)/g)];
    if (lone.length) return parseInt(lone[lone.length - 1][1], 10) / 100;  // price ends the line
  }
  return null;
}

/* digit runs → candidate מק"ט codes. Receipt columns often merge in the OCR
   ("<EAN13><price>" as one 15-17 digit run), so long runs also contribute
   their 13/12-digit edges; bogus candidates simply miss the code index. */
function receiptCodeCandidates(raw) {
  const cands = [];
  for (const run of raw.match(/\d+/g) || []) {
    if (run.length >= 7 && run.length <= 13) cands.push(run);
    else if (run.length >= 14 && run.length <= 18) {
      cands.push(run.slice(0, 13), run.slice(-13), run.slice(0, 12), run.slice(-12));
    }
  }
  const seen = new Set();
  return cands.map(orig => ({ c: orig.replace(/^0+/, ''), orig }))
    .filter(x => x.c && !seen.has(x.c) && seen.add(x.c));
}

/* OCR text → candidate product lines: {raw, tokens, weak, codes, price, qty,
   skiplike}. skiplike lines survive only if a code resolves (matchReceiptText). */
function parseReceiptText(text) {
  const out = [];
  for (const rawLine of String(text).split('\n')) {
    const raw = rawLine.replace(/\s+/g, ' ').trim();
    if (raw.length < 2) continue;
    const codes = receiptCodeCandidates(raw);
    const price = receiptPriceFrom(raw);
    const skiplike = RECEIPT_SKIP_RE.test(raw) ||
      (RECEIPT_CHAIN_RE.test(raw) && price == null);
    if (skiplike && !codes.length) continue;
    // an all-numeric line is never a product; "2 X 6.90" sets the qty of the
    // product printed above it. The OCR sometimes reverses such lines in an
    // RTL page ("…X2") and may read the X as א — accept those shapes too.
    if (!codes.length && /^[\d\s.,:x×*א₪-]+$/i.test(raw)) {
      const qm = raw.match(/^([1-9]\d?)\s*[x×*א]/i) || raw.match(/[x×*א]\s*([1-9]\d?)$/i);
      const prev = out[out.length - 1];
      if (qm && prev) prev.qty = Math.min(30, parseInt(qm[1], 10));
      continue;
    }
    const t = receiptTokens(raw);
    // real product lines carry a price or a code; two+ words tolerate a lost price
    if (!codes.length && price == null && t.strong.length < 2) continue;
    out.push({ raw, tokens: t.strong, weak: t.weak, codes, price, qty: receiptQty(raw),
      skiplike });
    if (out.length >= 60) break;
  }
  return out;
}

/* token-vs-name score; null = not good enough. Exact word 3, prefix (≥3 chars,
   either direction — covers plurals and receipt truncation) 2. Accept on two
   matched tokens, or an exact hit for a single-token line. */
function receiptNameScore(tokens, weak, pr) {
  const words = pr.rw || [];
  if (!words.length) return null;
  let matched = 0, quality = 0;
  for (const tk of tokens) {
    let q = 0;
    for (const w of words) {
      if (w === tk) { q = 3; break; }
      if (Math.min(w.length, tk.length) >= 3 && (w.startsWith(tk) || tk.startsWith(w)))
        q = Math.max(q, 2);
    }
    if (q) matched++;
    quality += q;
  }
  if (!matched) return null;
  if (!(matched >= 2 || (tokens.length === 1 && quality >= 3))) return null;
  for (const tk of weak) if ((pr.rwWeak || []).includes(tk)) quality += 1;
  return { score: quality + matched / tokens.length + matched / words.length, matched };
}
function receiptMatchLine(tokens, weak) {
  const cand = new Set();
  for (const tk of tokens) {
    for (const i of rcptIndex.words.get(tk) || []) cand.add(i);
    if (tk.length >= 3) for (const i of rcptIndex.pre3.get(tk.slice(0, 3)) || []) cand.add(i);
  }
  let best = null;
  for (const i of cand) {
    const pr = state.products[i];
    const s = receiptNameScore(tokens, weak, pr);
    if (!s) continue;
    if (!best || s.score > best.score ||
        (s.score === best.score && (avail(pr) > avail(best.pr) ||
          (avail(pr) === avail(best.pr) && pr.n.length < best.pr.n.length)))) {
      best = { pr, score: s.score };
    }
  }
  return best;
}

/* full text → review items; code match beats name match, duplicates merge */
function matchReceiptText(text) {
  ensureReceiptIndex();
  const items = [], byK = new Map();
  for (const ln of parseReceiptText(text)) {
    let pr = null, via = null, price = ln.price;
    for (const cand of ln.codes) {
      const i = rcptIndex.codes.get(cand.c);
      if (i != null) {
        pr = state.products[i]; via = 'code';
        // the code column often merges into the price in the OCR — reparse the
        // price with the matched digits cut out (loose: decimal may be lost)
        price = receiptPriceFrom(ln.raw.split(cand.orig).join(' '), true);
        break;
      }
    }
    if (!pr && ln.skiplike) continue;      // admin line whose number resolved nowhere
    if (!pr && ln.tokens.length) {
      const m = receiptMatchLine(ln.tokens, ln.weak);
      if (m) { pr = m.pr; via = 'name'; }
    }
    if (pr && byK.has(pr.k)) {
      const first = byK.get(pr.k);
      first.qty = Math.min(99, first.qty + ln.qty);
      continue;
    }
    const item = { raw: ln.raw, price, qty: ln.qty, pr, via, on: !!pr, alt: null };
    if (pr) byK.set(pr.k, item);
    items.push(item);
  }
  return items;
}

/* browsable alternatives for a receipt line (built lazily on first open):
   Hebrew words from the raw OCR line, shortened until the catalog answers.
   NOTE: no hebNorm here — catalog nLow keeps final letters. */
function receiptAltFor(it) {
  const words = stripQuotes(String(it.raw).toLowerCase())
    .replace(/[^א-ת0-9%\s]/g, ' ').split(/\s+/)
    .filter(w => /[א-ת]/.test(w) && w.length >= 2 && !RECEIPT_TOKEN_STOP.has(w))
    .slice(0, 5);
  const { term, matches } = matchesWithShorten(words.join(' '));
  return { open: true, term: term || '', search: '',
    cands: matches.map(p => p.k), shown: RCP_CHIPS_FIRST };
}
function rcptAltsH(it, idx) {
  return `<div class="rcp-chips rcpt-alts">
    <span class="rcp-chip-list">${chipsListH(it.alt.cands, it.alt.shown, it.pr ? it.pr.k : null, 'rcpt-alt', idx)}</span>
    <span class="rcp-tools"><input class="rcp-search rcpt-alt-search" data-i="${idx}"
      placeholder="חיפוש מוצר אחר…" value="${esc(it.alt.search)}"></span>
  </div>`;
}

/* ---- OCR engine (lazy, cached) ---- */
let tessLoad = null, tessWorker = null;
function receiptSetProgress(text, pct) {
  state.receipt.statusText = text;
  state.receipt.progress = pct;
  const fill = $('#rcptFill'), st = $('#rcptStatus');
  if (fill) fill.style.width = Math.round(pct * 100) + '%';
  if (st) st.textContent = text;
}
function receiptLogger(m) {
  if (state.receipt.stage !== 'working' || !m) return;
  if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract')
    receiptSetProgress('טוען את מנוע הזיהוי (פעם ראשונה בלבד)…', 0.05 + (m.progress || 0) * 0.1);
  else if (m.status === 'loading language traineddata')
    receiptSetProgress('מוריד מודל זיהוי עברית — נשמר במכשיר להמשך…', 0.15 + (m.progress || 0) * 0.15);
  else if (m.status === 'recognizing text')
    receiptSetProgress('קורא את שורות הקבלה…', 0.35 + (m.progress || 0) * 0.6);
}
async function getTesseractWorker() {
  if (!tessLoad) tessLoad = loadScript(TESSERACT_JS_URL);
  try { await tessLoad; } catch (err) { tessLoad = null; throw err; }
  if (!tessWorker) {
    // heb+eng: the eng model carries the digit shapes — receipts are mostly
    // digits (מק"ט, prices) and heb alone garbles them
    const worker = await Tesseract.createWorker('heb+eng', 1, { logger: receiptLogger });
    await worker.setParameters({
      tessedit_pageseg_mode: '4',        // single column of variable-size lines = a receipt
      preserve_interword_spaces: '1',
    });
    tessWorker = worker;
  }
  return tessWorker;
}

/* downscale + grayscale + percentile contrast stretch — thermal prints are
   low-contrast and phone photos are huge; Tesseract likes ~1400px-wide gray */
async function receiptPrepImage(file) {
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch (_) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = state.receipt.imgUrl;
    });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  if (!w || !h) throw new Error('empty image');
  const scale = Math.max(0.15, Math.min(1400 / w, 4200 / h, 3));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  const im = ctx.getImageData(0, 0, cw, ch), d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = y; hist[y]++;
  }
  const total = cw * ch;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.05) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.05) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span | 0));
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

async function startReceiptScan(file) {
  const r = state.receipt;
  if (!file || !file.type.startsWith('image/') || r.stage === 'working') return;
  if (state.status !== 'live') { toast('המחירים עוד נטענים — נסו שוב בעוד רגע'); return; }
  if (r.imgUrl) URL.revokeObjectURL(r.imgUrl);
  Object.assign(r, { stage: 'working', progress: 0, statusText: '', error: '', items: [],
    imgUrl: URL.createObjectURL(file) });
  render();
  receiptSetProgress('מכין את התמונה…', 0.02);
  try {
    const canvas = await receiptPrepImage(file);
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(canvas);
    receiptSetProgress('מצליב מול קטלוג המחירים…', 0.97);
    r.items = matchReceiptText(data.text || '');
    r.stage = 'review';
  } catch (err) {
    console.warn('receipt scan failed:', err);
    r.stage = 'error';
    r.error = navigator.onLine === false
      ? 'אין חיבור לאינטרנט — מנוע הזיהוי נטען מהרשת פעם אחת לפני שימוש ראשון.'
      : 'זיהוי הקבלה לא הצליח. נסו שוב עם תמונה חדה, ישרה ומוארת.';
  }
  render();
}

function resetReceipt() {
  const r = state.receipt;
  if (r.imgUrl) URL.revokeObjectURL(r.imgUrl);
  // saveAsList + returnTo survive a "scan another" reset; go-receipt re-arms them
  Object.assign(r, { stage: 'idle', progress: 0, statusText: '', imgUrl: '', items: [], error: '' });
}

function commitReceipt() {
  const r = state.receipt;
  const picked = r.items.filter(it => it.on && it.pr);
  if (!picked.length) { toast('לא סומנו מוצרים להוספה'); return; }
  for (const it of picked) {
    state.list.set(it.pr.k, Math.min(99, (state.list.get(it.pr.k) || 0) + it.qty));
  }
  persistList();
  let savedMsg = '';
  if (r.saveAsList) {
    state.saved.unshift({ id: 'own-' + Date.now(), kicker: 'מקבלה 📸',
      name: 'סריקת קבלה · ' + new Date().toLocaleDateString('he-IL'),
      codes: picked.map(it => [it.pr.k, it.qty]), created: state.date });
    saveLS(LS.saved, state.saved);
    savedMsg = ', ונשמרה גם ברשימות השמורות לשימוש חוזר';
  }
  state.note = `נוספו ${picked.length} מוצרים מסריקת הקבלה 📸${savedMsg}.`;
  state.visited = true; persistPrefs();
  const dest = r.returnTo === 'saved' ? '#/saved' : '#/build';
  resetReceipt();
  nav(dest);
}

function receiptH() {
  const r = state.receipt;
  const tips = `<aside class="bld-side">
      <div class="side-card tinted">
        <h3>ככה הזיהוי הכי מדויק</h3>
        <ul class="rcpt-tips">
          <li>מיישרים את הקבלה על משטח חלק</li>
          <li>אור מלא, בלי צל על הנייר</li>
          <li>מצלמים מקרוב, שהאותיות חדות</li>
          <li>קבלה ארוכה? אפשר לסרוק בחלקים</li>
        </ul>
      </div>
      <div class="side-card elevated">
        <h3>🔒 בלי לשלוח לשום מקום</h3>
        <p class="muted sm">הזיהוי רץ כולו בדפדפן שלכם, במכשיר — תמונת הקבלה לא נשלחת לשום שרת.
        בשימוש הראשון יורד מודל זיהוי (כ־7MB) ונשמר במכשיר לפעמים הבאות.</p>
      </div>
    </aside>`;
  let main;
  if (r.stage === 'idle' || r.stage === 'error') {
    main = `
      ${r.stage === 'error' ? `<div class="rcpt-error">⚠ ${esc(r.error)}</div>` : ''}
      <button class="rcpt-drop" data-action="rcpt-pick" id="rcptDrop">
        <span class="rcpt-icon">📸</span>
        <b>צילום או העלאה של תמונת קבלה</b>
        <span class="muted">לחיצה כאן — או גרירת תמונה לתוך המסגרת</span>
      </button>
      <input id="rcptFile" type="file" accept="image/*" hidden>`;
  } else if (r.stage === 'working') {
    main = `
      <div class="rcpt-work">
        <img class="rcpt-img" src="${r.imgUrl}" alt="תמונת הקבלה שנסרקת">
        <div class="rcpt-progress">
          <div class="rcpt-bar"><div class="rcpt-bar-fill" id="rcptFill" style="width:${Math.round(r.progress * 100)}%"></div></div>
          <div class="muted" id="rcptStatus">${esc(r.statusText || 'מתחילים…')}</div>
        </div>
      </div>`;
  } else {
    const hits = r.items.filter(it => it.pr);
    const misses = r.items.filter(it => !it.pr);
    const onCount = hits.filter(it => it.on).length;
    const rows = hits.map(it => {
      const idx = r.items.indexOf(it);
      return `<div class="rcpt-item">
        <div class="item-row rcpt-row${it.on ? '' : ' off'}">
        <button class="sel-round${it.on ? ' on' : ''}" data-action="rcpt-toggle" data-idx="${idx}"
          aria-label="${it.on ? 'הסרה מהרשימה' : 'הוספה לרשימה'}">${it.on ? '✓' : '+'}</button>
        ${productVisual(it.pr)}
        <div class="item-main">
          <span class="item-name">${esc(it.pr.n)}
            ${it.via === 'code' ? '<span class="tag rcpt-code-tag" title="הותאם לפי המק&quot;ט שמודפס בקבלה">🎯 לפי מק״ט</span>' : ''}
            ${it.via === 'manual' ? '<span class="tag rcpt-code-tag">👤 נבחר ידנית</span>' : ''}</span>
          <span class="item-meta rcpt-raw" dir="rtl">בקבלה: „${esc(it.raw.slice(0, 60))}“${it.price != null ? ` · ${money(it.price)}` : ''}</span>
        </div>
        <div class="stepper">
          <button data-action="rcpt-dec" data-idx="${idx}" aria-label="הפחתה">−</button>
          <span>${it.qty}</span>
          <button data-action="rcpt-inc" data-idx="${idx}" aria-label="הוספה">+</button>
        </div>
        <div class="item-from">${esc(fromLabel(it.pr))}</div>
        <button class="btn-ghost sm rcpt-swap" data-action="rcpt-alt-toggle" data-idx="${idx}"
          title="לא המוצר הנכון? בחרו אחר מהקטלוג">${it.alt && it.alt.open ? 'סגירה' : '🔄 החלפה'}</button>
        </div>
        ${it.alt && it.alt.open ? rcptAltsH(it, idx) : ''}
      </div>`;
    }).join('');
    const missH = misses.length ? `
      <div class="side-card tinted rcpt-miss">
        <h2>שורות שלא זוהו (${misses.length})</h2>
        <p class="muted sm">בכל זאת מוצר? פתחו את החיפוש, דפדפו בהתאמות מהקטלוג וצרפו אותו לרשימה.</p>
        ${misses.map(it => {
          const idx = r.items.indexOf(it);
          return `<div class="rcpt-miss-item">
          <div class="rcpt-miss-row">
            <span class="rcpt-raw" dir="rtl">„${esc(it.raw.slice(0, 60))}“</span>
            <button class="btn-outline sm" data-action="rcpt-alt-toggle" data-idx="${idx}">
              ${it.alt && it.alt.open ? 'סגירה' : '🔍 בחירת מוצר'}</button>
          </div>
          ${it.alt && it.alt.open ? rcptAltsH(it, idx) : ''}
        </div>`;
        }).join('')}
      </div>` : '';
    main = hits.length ? `
      <div class="card rcpt-review">
        <div class="list-head"><h2>זיהינו ${hits.length} מוצרים</h2>
          <span class="muted">מתוך ${r.items.length} שורות בקבלה · סמנו מה להוסיף</span></div>
        ${rows}
      </div>
      ${missH}
      <label class="rcpt-save-opt">
        <input type="checkbox" id="rcptSaveList"${r.saveAsList ? ' checked' : ''}>
        <span>לשמור את הקנייה גם כרשימה שמורה — לטעינה חוזרת בקנייה הבאה</span>
      </label>
      <div class="rcpt-ctas">
        <button class="btn-primary lg" data-action="rcpt-commit">הוספת ${onCount} מוצרים לרשימה</button>
        <button class="btn-outline" data-action="rcpt-reset">סריקת קבלה נוספת</button>
      </div>` : `
      <div class="card empty-cta">
        <h2>לא הצלחנו לזהות מוצרים בקבלה</h2>
        <p class="muted">נסו תמונה חדה וישרה יותר, באור מלא — או חפשו את המוצרים ידנית.</p>
        <div class="rcpt-ctas center">
          <button class="btn-primary" data-action="rcpt-reset">ניסיון נוסף</button>
          <button class="btn-outline" data-action="go-build">לחיפוש ידני</button>
        </div>
      </div>
      ${missH}`;
  }
  return `<div class="wrap page">
    <a class="back-link" href="#/build">← חזרה לרשימה</a>
    <h1 class="page-title">סריקת קבלה 📸</h1>
    <p class="page-sub">מצלמים קבלה מקנייה קודמת — אנחנו מזהים את המוצרים לפי המק״ט והשם,
      ובונים מהם רשימה עם מחירי היום בכל הרשתות.</p>
    ${noteH()}
    <div class="rcpt-grid">
      <div>${main}</div>
      ${tips}
    </div>
  </div>`;
}

/* ---------- recipe link → ingredient picker (human in the middle) ----------
   Paste a recipe URL (or the ingredient text itself) and every ingredient
   becomes a row of candidate products from the catalog — the USER picks the
   exact product (which flour, which brand); nothing is auto-selected. Free by
   design: extraction happens in the browser. URL fetching tries the page
   directly, then free public CORS relays; when all fail the paste-the-text
   path always works. Israeli recipe sites embed schema.org Recipe JSON-LD
   with recipeIngredient — that is the primary extraction path (regex-scanned
   so it is also testable in node); DOM selectors and a "מצרכים" text-section
   scan are fallbacks. */
const RECIPE_PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://r.jina.ai/${u}`,
];

/* quantity / unit / glue words dropped from the START of an ingredient line */
const RCP_NUM_RE = /^(?:\d+(?:[.,]\d+)?|\d+\/\d+|[½⅓¼¾⅔⅛]|ו?חצי|ו?רבע|ו?שליש|שני|שתי|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה|כמה|מעט|קצת)$/;
const RCP_UNITS = new Set(['כוס', 'כוסות', 'כף', 'כפות', 'כפית', 'כפיות', 'גרם',
  'גר', 'ג', 'קילו', 'קג', 'מל', 'ליטר', 'ליטרים', 'יחידה', 'יחידות', 'יח',
  'חבילה', 'חבילות', 'חב', 'קופסה', 'קופסת', 'קופסאות', 'שקית', 'שקיות',
  'פחית', 'פחיות', 'צנצנת', 'גביע', 'גביעים', 'מיכל', 'בקבוק', 'פרוסה',
  'פרוסות', 'שן', 'שיני', 'שיניים', 'ענף', 'ענפי', 'גבעול', 'גבעולי', 'חופן',
  'קורט', 'קוביה', 'קוביות', 'מקל', 'מקלות', 'צרור', 'חבילת', 'של']);
/* descriptor words dropped ANYWHERE (prep style, size, serving notes) */
const RCP_DESCR = new Set(['קצוץ', 'קצוצה', 'קצוצים', 'קצוצות', 'כתוש', 'כתושה',
  'כתושים', 'כתושות', 'טחון', 'טחונה',
  'חתוך', 'חתוכה', 'חתוכים', 'חתוכות', 'פרוס', 'פרוסים', 'מגורר', 'מגוררת',
  'מגורד', 'מגורדת', 'קלוף', 'קלופה', 'קלופים', 'טרי', 'טריה', 'טרייה',
  'טריים', 'גדול', 'גדולה', 'גדולים', 'קטן', 'קטנה', 'קטנים', 'בינוני',
  'בינונית', 'רך', 'רכה', 'מומס', 'מומסת', 'קר', 'קרה', 'קרים', 'חם', 'חמה',
  'פושר', 'פושרת', 'רותח', 'רותחת', 'מבושל', 'מבושלת', 'אופציונלי',
  'אופציונאלי', 'לקישוט', 'להגשה', 'לטיגון', 'למריחה', 'לתיבול', 'לציפוי',
  'מעל', 'בערך', 'בקירוב', 'לפי', 'הטעם', 'הצורך', 'כרצונכם', 'שטוחה',
  'גדושה', 'מלאה', 'שלם', 'שלמה', 'שלמים', 'ללא', 'בלי', 'או']);

/* "2 כוסות קמח לבן מנופה" → "קמח לבן" — the shopping term behind a recipe line */
function ingredientTerm(line) {
  let s = String(line).replace(/\(.*?\)/g, ' ');            // parenthetical notes
  s = s.split(' - ')[0];                                    // trailing " - הערה"
  s = stripQuotes(s.toLowerCase()).replace(/[^א-תa-z0-9%½⅓¼¾⅔⅛/.,\s]/g, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && (RCP_NUM_RE.test(tokens[i]) || RCP_UNITS.has(tokens[i]))) i++;
  const words = [];
  for (; i < tokens.length && words.length < 4; i++) {
    const t = tokens[i];
    if (RCP_DESCR.has(t) || RCP_NUM_RE.test(t)) continue;
    if (!/[א-ת]/.test(t) && !/^\d{1,2}%$/.test(t)) continue;  // latin/L-size noise
    words.push(t);
  }
  return words.join(' ');
}

/* schema.org Recipe JSON-LD, regex-scanned so it works on raw HTML in node too */
function recipeFromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const nodes = [];
      const walk = d => {
        if (!d) return;
        if (Array.isArray(d)) { d.forEach(walk); return; }
        if (typeof d === 'object') {
          nodes.push(d);
          if (d['@graph']) walk(d['@graph']);
        }
      };
      walk(JSON.parse(m[1]));
      for (const n of nodes) {
        const t = n['@type'];
        if ((t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) &&
            Array.isArray(n.recipeIngredient) && n.recipeIngredient.length) {
          return { name: String(n.name || ''), ingredients: n.recipeIngredient.map(String) };
        }
      }
    } catch (_) {}
  }
  return null;
}

/* microdata / ingredient-class DOM fallback (browser only) */
function recipeFromDom(html) {
  if (typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const sel of ['[itemprop="recipeIngredient"]', '[itemprop="ingredients"]',
      '[class*="ingredient" i] li', 'ul[class*="ingredient" i] li']) {
      const lines = [...doc.querySelectorAll(sel)]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 1 && t.length < 120);
      if (lines.length >= 2) {
        const h1 = doc.querySelector('h1');
        return { name: h1 ? h1.textContent.trim() : '', ingredients: [...new Set(lines)] };
      }
    }
  } catch (_) {}
  return null;
}

/* "מצרכים" section scan over plain text (markdown proxies, stripped HTML) */
function recipeFromLooseText(input) {
  const text = String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const start = lines.findIndex(l =>
    /^[#*\s]*(מצרכים|רכיבים|החומרים|חומרים)(?=$|[\s:])/.test(l) && l.length < 30);
  if (start < 0) return null;
  const out = [];
  let blanks = 0;
  for (let i = start + 1; i < lines.length && out.length < 40; i++) {
    const l = lines[i].replace(/^[-*•·◦]\s*/, '').trim();
    if (!l) { if (out.length && ++blanks > 2) break; continue; }
    blanks = 0;
    if (/^[#*\s]*(אופן|הוראות|הכנה|שלבי|להכנה)/.test(l)) break;
    if (l.length > 90 || l.endsWith(':')) continue;
    out.push(l);
  }
  return out.length >= 2 ? { name: '', ingredients: out } : null;
}

/* pasted-ingredients mode: every non-header line is an ingredient; an
   instructions header ends the list (people paste the whole recipe) */
function recipeFromPastedText(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const l = raw.replace(/^[-*•·◦]\s*/, '').replace(/\s+/g, ' ').trim();
    if (!l) continue;
    if (/^[#*\s]*(אופן|הוראות|הכנה|שלבי|להכנה)(?=$|[\s:])/.test(l)) break;
    if (l.length > 90 || l.endsWith(':')) continue;
    if (/^[#*\s]*(מצרכים|רכיבים|החומרים|חומרים)(?=$|[\s:])/.test(l)) continue;
    out.push(l);
    if (out.length >= 40) break;
  }
  return out.length ? { name: '', ingredients: out } : null;
}

/* ALL matching products for one term (browsable, capped for DOM sanity) —
   the user pages through them with "עוד התאמות" */
const RCP_MATCH_CAP = 150, RCP_CHIPS_FIRST = 4, RCP_CHIPS_STEP = 8;
function recipeMatches(term) {
  const q = stripQuotes(String(term).toLowerCase()).trim();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const scored = [];
  for (const pr of state.products) {
    let score;
    if (pr.nLow.startsWith(q)) score = 0;
    else if (pr.nLow.includes(' ' + q)) score = 1;
    else if (pr.nLow.includes(q)) score = 2;
    else if (words.length > 1 && words.every(w => keywordScore(pr, w) >= 0)) score = 3;
    else continue;
    scored.push([score, pr]);
  }
  scored.sort((a, b) => a[0] - b[0] || avail(b[1]) - avail(a[1]) ||
    minActivePrice(a[1], true) - minActivePrice(b[1], true));
  return scored.slice(0, RCP_MATCH_CAP).map(x => x[1]);
}
function recipeCandidates(term, limit = RCP_CHIPS_FIRST) {
  return recipeMatches(term).slice(0, limit);
}

/* shorten a term word-by-word until the catalog answers */
function matchesWithShorten(term) {
  let t = term, matches = t ? recipeMatches(t) : [];
  while (!matches.length && t.includes(' ')) {
    t = t.split(' ').slice(0, -1).join(' ');
    matches = recipeMatches(t);
  }
  return { term: matches.length ? t : term, matches };
}

function buildRecipeRows(lines) {
  const rows = [];
  for (const raw0 of lines.slice(0, 30)) {
    const raw = String(raw0).replace(/\s+/g, ' ').trim();
    if (raw.length < 2) continue;
    const term0 = ingredientTerm(raw);
    if (!term0) continue;
    const { term, matches } = matchesWithShorten(term0);
    rows.push({ raw, term, search: '', cands: matches.map(p => p.k),
      shown: RCP_CHIPS_FIRST, chosen: null, have: false, qty: 1 });
  }
  return rows;
}

async function fetchRecipeUrl(url) {
  for (const attempt of [url, ...RECIPE_PROXIES.map(p => p(url))]) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch(attempt, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 200) return text;
    } catch (_) {}
  }
  throw new Error('recipe fetch failed');
}

async function startRecipeFetch(url) {
  const r = state.recipe;
  url = (url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    r.error = 'הדביקו קישור מלא למתכון (מתחיל ב־http)';
    render(); return;
  }
  if (state.status !== 'live' || r.stage === 'working') return;
  r.url = url; r.stage = 'working'; r.error = '';
  r.statusText = 'מושכים את דף המתכון…';
  render();
  try {
    const html = await fetchRecipeUrl(url);
    r.statusText = 'מחלצים את רשימת המצרכים…';
    const rec = recipeFromJsonLd(html) || recipeFromDom(html) || recipeFromLooseText(html);
    finishRecipeParse(rec);
  } catch (err) {
    console.warn('recipe fetch failed:', err);
    r.stage = 'idle';
    r.error = 'לא הצלחנו למשוך את המתכון מהקישור — נסו שוב, או הדביקו את רשימת המצרכים כטקסט (הכפתור למטה).';
    r.pasteOpen = true;
    render();
  }
}

function startRecipeText(text) {
  const r = state.recipe;
  if (!String(text || '').trim()) { r.error = 'הדביקו קודם את רשימת המצרכים'; render(); return; }
  r.error = '';
  finishRecipeParse(recipeFromPastedText(text));
}

function finishRecipeParse(rec) {
  const r = state.recipe;
  const rows = rec && rec.ingredients.length ? buildRecipeRows(rec.ingredients) : [];
  if (!rows.length) {
    r.stage = 'idle';
    r.error = 'לא מצאנו רשימת מצרכים — נסו קישור אחר, או הדביקו את המצרכים כטקסט.';
    r.pasteOpen = true;
    render(); return;
  }
  r.name = (rec.name || '').trim();
  r.ingredients = rows;
  r.stage = 'pick';
  render();
}

function resetRecipe() {
  Object.assign(state.recipe, { stage: 'idle', url: '', error: '', statusText: '',
    name: '', ingredients: [] });
}

function commitRecipe() {
  const r = state.recipe;
  const picked = r.ingredients
    .filter(x => !x.have && x.chosen && state.byKey.has(x.chosen))
    .map(x => ({ pr: state.byKey.get(x.chosen), qty: x.qty }));
  if (!picked.length) { toast('בחרו לפחות מוצר אחד מהמצרכים'); return; }
  for (const { pr, qty } of picked) {
    state.list.set(pr.k, Math.min(99, (state.list.get(pr.k) || 0) + qty));
  }
  persistList();
  let savedMsg = '';
  if (r.saveAsList) {
    state.saved.unshift({ id: 'own-' + Date.now(), kicker: 'ממתכון 🔗',
      name: r.name ? 'מתכון: ' + r.name.slice(0, 40) : 'רשימת מתכון',
      codes: picked.map(({ pr, qty }) => [pr.k, qty]), created: state.date });
    saveLS(LS.saved, state.saved);
    savedMsg = ', ונשמרה גם ברשימות השמורות';
  }
  const have = r.ingredients.filter(x => x.have).length;
  state.note = `נוספו ${picked.length} מוצרים מהמתכון 🔗${savedMsg}.` +
    (have ? ` ${have} מצרכים סומנו כ"יש בבית".` : '');
  state.visited = true; persistPrefs();
  resetRecipe();
  nav('#/build');
}

/* generic browsable chip list: first `shown` of ALL matches + an "עוד" pager.
   `prefix` names the click actions: `${prefix}-pick` / `${prefix}-more`. */
function chipsListH(keys, shown, chosenKey, prefix, i) {
  let visible = keys.slice(0, shown);
  if (chosenKey && !visible.includes(chosenKey)) visible = [chosenKey, ...visible];
  const chips = visible.map(k => {
    const pr = state.byKey.get(k);
    if (!pr) return '';
    const on = chosenKey === k;
    return `<button class="rcp-chip${on ? ' on' : ''}" data-action="${prefix}-pick" data-i="${i}" data-key="${esc(k)}"
      title="${esc(pr.n)}">
      ${productVisual(pr)}
      <span class="rcp-chip-main"><span class="rcp-chip-name">${esc(pr.n)}</span>
      <span class="rcp-chip-price">${esc(fromLabel(pr))}</span></span>
      ${on ? '<span class="rcp-chip-check">✓</span>' : ''}</button>`;
  }).join('');
  const rest = keys.length - Math.min(shown, keys.length);
  const more = rest > 0
    ? `<button class="rcp-chip more" data-action="${prefix}-more" data-i="${i}">עוד התאמות (${rest})</button>` : '';
  return (chips || '<span class="muted sm rcp-none">לא נמצאו מוצרים מתאימים — נסו לחפש:</span>') + more;
}
function rcpChipsListH(row, i) {
  return chipsListH(row.cands, row.shown, row.chosen, 'rcp', i);
}

function recipeH() {
  const r = state.recipe;
  let main;
  if (r.stage === 'working') {
    main = `<div class="card rcp-working">
      <div class="rcpt-bar rcp-indet"><div class="rcpt-bar-fill"></div></div>
      <div class="muted">${esc(r.statusText)}</div>
    </div>`;
  } else if (r.stage === 'pick') {
    const chosen = r.ingredients.filter(x => !x.have && x.chosen).length;
    const have = r.ingredients.filter(x => x.have).length;
    const rows = r.ingredients.map((row, i) => `
      <div class="rcp-row${row.have ? ' off' : ''}">
        <div class="rcp-row-head">
          <span class="rcpt-raw" dir="rtl">„${esc(row.raw.slice(0, 70))}“</span>
          <button class="btn-ghost sm" data-action="rcp-have" data-i="${i}">
            ${row.have ? '↩ בכל זאת צריך' : '✓ יש לי בבית'}</button>
        </div>
        ${row.have ? '' : `<div class="rcp-chips">
          <span class="rcp-chip-list">${rcpChipsListH(row, i)}</span>
          <span class="rcp-tools">
            <input class="rcp-search" data-i="${i}" placeholder="חיפוש מוצר אחר…" value="${esc(row.search)}">
            ${row.chosen ? `<span class="stepper">
              <button data-action="rcp-dec" data-i="${i}" aria-label="הפחתה">−</button>
              <span>${row.qty}</span>
              <button data-action="rcp-inc" data-i="${i}" aria-label="הוספה">+</button></span>` : ''}
          </span>
        </div>`}
      </div>`).join('');
    main = `
      <div class="card rcpt-review">
        <div class="list-head"><h2>${esc(r.name || 'המתכון')}</h2>
          <span class="muted">נבחרו ${chosen} מתוך ${r.ingredients.length} מצרכים${have ? ` · ${have} יש בבית` : ''}</span></div>
        <p class="muted sm">לכל מצרך מוצגות התאמות מהקטלוג — בחרו את המוצר המדויק שאתם קונים
          (איזה קמח, איזה מותג). אפשר לחפש אחרת בכל שורה.</p>
        ${rows}
      </div>
      <label class="rcpt-save-opt">
        <input type="checkbox" id="rcpSaveList"${r.saveAsList ? ' checked' : ''}>
        <span>לשמור גם כרשימה שמורה${r.name ? ` — „מתכון: ${esc(r.name.slice(0, 40))}“` : ''}</span>
      </label>
      <div class="rcpt-ctas">
        <button class="btn-primary lg" data-action="rcp-commit"${chosen ? '' : ' disabled'}>הוספת ${chosen} מוצרים לרשימה</button>
        <button class="btn-outline" data-action="rcp-reset">מתכון אחר</button>
      </div>`;
  } else {
    main = `
      ${r.error ? `<div class="rcpt-error">⚠ ${esc(r.error)}</div>` : ''}
      <div class="card rcp-input-card">
        <h2>🔗 קישור למתכון</h2>
        <p class="muted sm">הדביקו קישור לעמוד מתכון (10 דקות, פודי, מאקו ועוד) — נחלץ את
          רשימת המצרכים, ואתם בוחרים את המוצר המדויק לכל מצרך.</p>
        <div class="rcp-url-row">
          <input id="rcpUrl" class="input" dir="ltr" inputmode="url" enterkeyhint="go"
            placeholder="https://www.example.co.il/recipe" value="${esc(r.url)}">
          <button class="btn-primary" data-action="rcp-fetch">שליפת המתכון</button>
        </div>
        <button class="btn-ghost sm" data-action="rcp-paste-toggle">
          ${r.pasteOpen ? 'סגירת ההדבקה הידנית' : 'אין קישור? הדביקו את רשימת המצרכים כטקסט'}</button>
        ${r.pasteOpen ? `
          <textarea id="rcpText" class="input rcp-textarea" rows="7"
            placeholder="2 כוסות קמח&#10;3 ביצים&#10;חצי כוס שמן זית&#10;…">${esc(r.text)}</textarea>
          <button class="btn-outline" data-action="rcp-paste-run">חילוץ מצרכים מהטקסט</button>` : ''}
      </div>`;
  }
  const aside = `<aside class="bld-side">
      <div class="side-card tinted">
        <h3>איך זה עובד?</h3>
        <ol class="rcp-steps">
          <li>מדביקים קישור למתכון (או את המצרכים כטקסט)</li>
          <li>אנחנו מחלצים את רשימת המצרכים</li>
          <li>אתם בוחרים מוצר מדויק לכל מצרך — כי "קמח" זה לא מספיק ספציפי 😉</li>
          <li>הרשימה מוכנה להשוואת מחירים</li>
        </ol>
      </div>
      <div class="side-card elevated">
        <h3>🔒 שקיפות</h3>
        <p class="muted sm">החילוץ והבחירה קורים בדפדפן שלכם. שליפת דף המתכון נעשית ישירות,
        ואם האתר חוסם — דרך שירותי תיווך (proxy) ציבוריים חינמיים; מועברת אליהם כתובת
        הקישור בלבד. תמיד אפשר להדביק את המצרכים כטקסט במקום.</p>
      </div>
    </aside>`;
  return `<div class="wrap page">
    <a class="back-link" href="#/build">← חזרה לרשימה</a>
    <h1 class="page-title">מתכון לרשימת קניות 🔗</h1>
    <p class="page-sub">מקישור של מתכון לרשימת מוצרים אמיתית — אתם מחליטים איזה מוצר בדיוק
      נכנס לסל, לכל מצרך.</p>
    ${noteH()}
    <div class="rcpt-grid">
      <div>${main}</div>
      ${aside}
    </div>
  </div>`;
}

/* ---------- router ---------- */
const APP_SCREENS = new Set(['build', 'results', 'basket', 'done', 'saved', 'profile',
  'receipt', 'recipe', 'terms', 'accessibility']);
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
      <span class="dot"></span><span class="pill-text">מחירים מעודכנים · ${esc(state.date)} · ${state.products.length.toLocaleString('he-IL')} מוצרים</span></button>`;
  }
  if (state.status === 'loading') {
    return `<span class="pill-status wait"><span class="dot"></span><span class="pill-text">טוען מחירים מהצילום היומי…</span></span>`;
  }
  return `<button class="pill-status err" data-action="reload"><span class="dot"></span><span class="pill-text">שגיאה בטעינת נתונים · נסו שוב</span></button>`;
}
function navH() {
  const links = [
    ['build', 'הרשימה'], ['receipt', 'סריקת קבלה'], ['recipe', 'ייבוא מתכון'],
    ['results', 'השוואה'], ['saved', 'רשימות שמורות'], ['profile', 'פרופיל'],
  ].map(([key, label]) =>
    `<a class="nav-link${state.screen === key ? ' on' : ''}" href="#/${key}">${label}</a>`).join('');
  const initial = (state.profile.name || state.auth.user?.name ||
    state.auth.user?.email || 'א').trim().charAt(0);
  return `<header class="topnav">
    <div class="nav-right">
      <a class="brand" href="#/onboarding" aria-label="ליםSlim — מסך פתיחה">${logoSvg(34, true)}<span class="brand-name" dir="ltr">ליםSlim</span></a>
      <nav class="nav-links">${links}</nav>
    </div>
    <div class="nav-left">
      ${statusPillH()}
      ${state.address ? `<span class="nav-address">משלוח אל ${esc(state.address)}</span>` : ''}
      ${state.auth.mode === 'firebase' && !state.auth.user
        ? `<a class="nav-login" href="#/setup">התחברות</a>`
        : `<a class="nav-avatar" href="#/profile" aria-label="פרופיל">${esc(initial)}</a>`}
    </div>
  </header>`;
}
function footH() {
  return `<footer class="foot">
    <nav class="foot-guides" aria-label="מדריכים">
      <a href="/articles/">מדריכים</a>
      <a href="/articles/eifo-hachi-zol/">איפה הכי זול לעשות קניות</a>
      <a href="/articles/mishloach-kniyot/">משלוח קניות עד הבית</a>
      <a href="/articles/chisachon-bakniyot/">איך לחסוך בקניות בסופר</a>
      <a href="/articles/mivtzaim-basuper/">מבצעים בסופר</a>
    </nav>
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
    <h1>לא הצלחנו לטעון את הנתונים</h1>
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
    : `<div class="hero-line muted">הרשימה עדיין ריקה —
        <button class="linklike" data-action="go-receipt">📸 סרקו קבלה</button></div>`;
  const { cheapest } = computeRows();
  const winner = cheapest && state.list.size
    ? `<div class="hero-win"><div><div class="hero-win-k">הזול ביותר היום</div>
         <div class="hero-win-name">${esc(cheapest.label)} אונליין</div></div>
       <div class="hero-win-total">${ils0(cheapest.total)}</div></div>` : '';
  return `<div class="ob">
    <div class="ob-main">
      <div class="ob-brand">${logoSvg(44, false)}<span dir="ltr">ליםSlim</span></div>
      <div class="ob-badge">נתוני שקיפות מחירים רשמיים · מתעדכן יומית</div>
      <h1 class="ob-title">רשימה אחת.<br>כל הסופרים.<br>הסל הזול ביותר.</h1>
      <div class="ob-flow" aria-label="איך זה עובד">
        <svg class="ob-river" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M80 -2 C 86 14, 30 16, 26 34 C 22 50, 74 48, 77 66 C 80 82, 62 88, 55 99"/>
        </svg>
        <div class="ob-step"><span class="ob-dot">🛒</span>
          <div class="ob-step-t"><b>בונים רשימה אחת</b>
            <span>חיפוש בקטלוג, סריקת קבלה 📸 או קישור למתכון 🔗</span></div></div>
        <div class="ob-step"><span class="ob-dot">⚖️</span>
          <div class="ob-step-t"><b>סלים משווה בין כל הרשתות</b>
            <span>מחירים רשמיים, מבצעים ודמי משלוח — בלחיצה אחת</span></div></div>
        <div class="ob-step"><span class="ob-dot">💸</span>
          <div class="ob-step-t"><b>מזמינים במקום הזול ביותר</b>
            <span>הרשימה עוברת מוכנה לחנות שבחרתם — והחיסכון נשאר אצלכם</span></div></div>
      </div>
      <div class="ob-form">
        <div class="field"><label>כתובת למשלוח</label>
          <input id="obAddress" class="input" placeholder="רחוב, מספר, עיר" value="${esc(state.address)}"></div>
        <div class="field"><label>רשתות להשוואה</label><div class="chips">${chips || '<span class="muted">טוען רשתות…</span>'}</div></div>
        <div class="ob-ctas">
          <button class="btn-primary lg ob-cta-main" data-action="go-build">בניית הרשימה שלי ←</button>
          <button class="btn-outline" data-action="go-setup">${state.auth.mode === 'firebase' ? 'התחברות / הרשמה' : 'הגדרת פרופיל'}</button>
        </div>
        <p class="ob-cta-note">חינם ובלי הרשמה — מתחילים תוך חצי דקה</p>
        <button class="rcpt-cta" data-action="go-receipt">📸 <b>יש קבלה מהסופר?</b>
          סרקו אותה — ונבנה לכם את הרשימה אוטומטית</button>
      </div>
    </div>
    <div class="ob-side">
      <div class="ob-hero">
        <div class="ob-blob"></div>
        <div class="hero-card">
          <div class="hero-card-title">הסל השבועי שלי</div>
          ${preview}
        </div>
        ${winner}
      </div>
      ${promoCarouselH(true)}
    </div>
  </div>`;
}

/* ---------- promotions carousel (main screen) ---------- */
function bestPromoFor(pr) {
  let best = null;
  for (let i = 0; i < state.chains.length; i++) {
    const base = pr.p[i], promo = pr.pm && pr.pm[i];
    if (base == null || !promo || promo[0] == null) continue;
    if (promo[2] & (PROMO_CLUB | PROMO_COUPON)) continue;
    if (promo[0] >= base - 0.005) continue;
    const save = (base - promo[0]) / base;
    if (!best || save > best.save) {
      best = { save, base, unit: promo[0], desc: promo[1], m: promo[3] || 1,
               chain: state.chains[i] };
    }
  }
  return best;
}
function orderedProductKeys() {
  const keys = new Set();
  for (const o of state.orders) {
    for (const [k] of o.items || []) {
      const pr = state.byKey.get(k);
      if (pr) keys.add(pr.k);
    }
  }
  return keys;
}
function promoCarouselData() {
  const all = [];
  for (const pr of state.products) {
    const best = bestPromoFor(pr);
    // sanity band: real promos live at 10%–55% (1+1 = 50%); deeper "deals"
    // are almost always data glitches in the chains' files
    if (best && best.base >= 2 && best.save >= 0.10 && best.save <= 0.55) {
      all.push({ pr, best });
    }
  }
  all.sort((a, b) => b.best.save - a.best.save || avail(b.pr) - avail(a.pr));
  let personal = [];
  const ordered = (state.profile.name || state.auth.user) ? orderedProductKeys() : new Set();
  if (ordered.size) personal = all.filter(x => ordered.has(x.pr.k));
  const seenKeys = new Set(personal.map(x => x.pr.k));
  const seenNames = new Set(personal.map(x => x.pr.nLow.split(' ').slice(0, 2).join(' ')));
  const fill = [];
  for (const x of all) {
    if (seenKeys.has(x.pr.k) || !productEan(x.pr)) continue;
    const nameKey = x.pr.nLow.split(' ').slice(0, 2).join(' ');
    if (seenNames.has(nameKey)) continue;          // skip near-identical variants
    seenNames.add(nameKey);
    fill.push(x);
  }
  return { cards: [...personal, ...fill].slice(0, 12), personalCount: personal.length };
}
function promoCarouselH(compact = false) {
  const { cards, personalCount } = promoCarouselData();
  if (!cards.length) return '';
  const title = personalCount
    ? '🏷 מבצעים בשבילך — על מוצרים שהזמנתם בעבר'
    : '🏷 המבצעים החמים היום';
  return `<div class="promo-carousel${compact ? ' compact' : ''}">
    <div class="pc-head"><span class="block-kicker">${title}</span>
      <span class="pc-arrows">
        <button class="pc-arrow" data-action="pc-scroll" data-dir="1" aria-label="למבצעים הבאים">‹</button>
        <button class="pc-arrow" data-action="pc-scroll" data-dir="-1" aria-label="למבצעים הקודמים">›</button>
      </span></div>
    <div class="pc-track" role="region" aria-label="מבצעים">` +
    cards.map(({ pr, best }, i) => `
      <div class="pc-card${personalCount && i < personalCount ? ' personal' : ''}" title="${esc(best.desc)}">
        ${productVisual(pr, 'lg')}
        <span class="pc-name">${esc(pr.n)}</span>
        <span class="promo-tag">${esc(best.desc.slice(0, 26))}${best.desc.length > 26 ? '…' : ''}</span>
        <div class="pc-price-row">
          <s class="old-price">${money(best.base)}</s>
          <b class="pc-price">${money(best.unit)}</b>
          ${best.m > 1 ? `<span class="pc-unit">ליח׳ בקניית ${best.m}</span>` : ''}
        </div>
        <div class="pc-foot"><span class="pc-chain">ב${esc(best.chain)}</span>
          <button class="add-round" data-action="add-deal" data-key="${esc(pr.k)}"
            data-m="${best.m}" aria-label="הוספה לרשימה">+</button>
        </div>
      </div>`).join('') + `</div></div>`;
}

/* auto-advance: one card every few seconds; pauses on hover/touch/focus and
   is disabled under עצירת אנימציות or prefers-reduced-motion */
let pcTimer = 0;
function startCarouselAuto() {
  clearInterval(pcTimer);
  const tracks = [...document.querySelectorAll('.pc-track')];
  if (!tracks.length) return;
  if (a11y.noanim || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const t of tracks) {
    if (t.dataset.autoWired) continue;
    t.dataset.autoWired = '1';
    const pause = () => { t.dataset.paused = '1'; };
    const resume = () => { t.dataset.paused = ''; };
    t.addEventListener('pointerenter', pause);
    t.addEventListener('pointerleave', resume);
    t.addEventListener('touchstart', pause, { passive: true });
    t.addEventListener('touchend', () => setTimeout(resume, 5000), { passive: true });
    t.addEventListener('focusin', pause);
    t.addEventListener('focusout', resume);
  }
  pcTimer = setInterval(() => {
    if (document.hidden) return;
    for (const t of document.querySelectorAll('.pc-track')) {
      if (t.dataset.paused === '1') continue;
      const card = t.querySelector('.pc-card');
      if (!card) continue;
      const max = t.scrollWidth - t.clientWidth;
      if (max <= 0) continue;
      if (Math.abs(t.scrollLeft) >= max - 4) t.scrollTo({ left: 0, behavior: 'smooth' });
      else t.scrollBy({ left: -(card.offsetWidth + 12), behavior: 'smooth' });
    }
  }, 3500);
}

const CATEGORY_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];   // display order, "אחר" last

/* in-store walk order (typical supermarket layout) + department emoji,
   used for the printable list of chains without an online store */
const WALK_ORDER = [1, 4, 3, 2, 8, 5, 6, 7, 9, 10, 0];
const CAT_EMOJI = { 1: '🥬', 2: '🥛', 3: '🍗', 4: '🍞', 5: '🥫', 6: '🍫',
  7: '🥤', 8: '🧊', 9: '🧻', 10: '🧴', 0: '🛒' };

/* shopping list grouped by department, checkbox-style for in-store use */
function inStoreListText(label, items, total) {
  const rows = [`רשימת קניות לסניף ${label} (ליםSlim · נתוני ${state.date})`, ''];
  for (const ci of WALK_ORDER) {
    const inCat = items.filter(({ pr }) => (pr.c || 0) === ci);
    if (!inCat.length) continue;
    rows.push(`${CAT_EMOJI[ci] || ''} ${state.categories[ci] || ''}`);
    for (const { pr, qty } of inCat) {
      rows.push(`□ ${pr.n}${qty > 1 ? ` — ${qty} יח׳` : ''}`);
    }
    rows.push('');
  }
  rows.push(`סה״כ משוער לפי מחירי ${label}: ${ils0(total)}`);
  return rows.join('\n');
}
function popTileH(pr) {
  return `
    <div class="pop-tile">
      ${productVisual(pr, 'lg')}
      <span class="pop-name">${esc(pr.n)}</span>
      <div class="pop-foot">
        <span class="pop-from">${esc(fromLabel(pr))}</span>
        <button class="add-round" data-action="add" data-key="${esc(pr.k)}" aria-label="הוספה">+</button>
      </div>
    </div>`;
}
/* category browsing is alphabetical; the sort key skips leading digits/sizes
   ("1.5% חלב…" files under ח), and the same key drives the letter index.
   12 = three rows of the 4-column grid — keeps the page short. */
const CAT_PAGE_SIZE = 12;
function catSortKey(pr) {
  const k = stripQuotes(pr.nLow).replace(/^[^א-ת]*/, '');
  return k || pr.nLow;
}
function catLetterOf(pr) {
  const ch = catSortKey(pr).charAt(0);
  return /[א-ת]/.test(ch) ? ch : '#';
}
function categoryProducts(ci) {
  return state.products
    .filter(pr => pr.c === ci)
    .sort((a, b) => catSortKey(a).localeCompare(catSortKey(b), 'he') ||
      a.nLow.localeCompare(b.nLow, 'he'));
}
function buildH() {
  const t = computeRows();
  const catChips = `<div class="chips cat-chips">
    <button class="chip${state.catFilter == null ? ' on' : ''}" data-action="category" data-cat="">מוצרים נפוצים</button>` +
    CATEGORY_ORDER.filter(ci => state.categories[ci]).map(ci =>
      `<button class="chip${state.catFilter === ci ? ' on' : ''}" data-action="category" data-cat="${ci}">${esc(state.categories[ci])}</button>`).join('') +
    `</div>`;
  let gridTitle, gridTiles, letterRow = '', pagerH = '';
  if (state.catFilter == null) {
    gridTitle = 'מוצרים נפוצים';
    gridTiles = state.popular.map(popTileH).join('');
  } else {
    const all = categoryProducts(state.catFilter);
    const filtered = state.catLetter ? all.filter(pr => catLetterOf(pr) === state.catLetter) : all;
    const pages = Math.max(1, Math.ceil(filtered.length / CAT_PAGE_SIZE));
    const page = Math.min(state.catPage, pages - 1);
    state.catPage = page;                        // clamp after letter/category switches
    gridTiles = filtered.slice(page * CAT_PAGE_SIZE, (page + 1) * CAT_PAGE_SIZE)
      .map(popTileH).join('');
    gridTitle = `${state.categories[state.catFilter]} · ` +
      (state.catLetter ? `האות ${state.catLetter} · ` : '') +
      `${filtered.length.toLocaleString('he-IL')} מוצרים · לפי א״ב`;
    if (all.length > CAT_PAGE_SIZE) {
      const letters = [...new Set(all.map(catLetterOf))].sort((a, b) => a.localeCompare(b, 'he'));
      letterRow = `<div class="cat-letters">
        <button class="chip${!state.catLetter ? ' on' : ''}" data-action="cat-letter" data-letter="">הכל</button>` +
        letters.map(L => `<button class="chip${state.catLetter === L ? ' on' : ''}"
          data-action="cat-letter" data-letter="${esc(L)}">${esc(L)}</button>`).join('') +
      `</div>`;
    }
    if (pages > 1) {
      pagerH = `<div class="cat-pager">
        <button class="btn-outline sm" data-action="cat-page" data-dir="-1"${page === 0 ? ' disabled' : ''}>הקודם</button>
        <span class="muted sm">עמוד ${page + 1} מתוך ${pages.toLocaleString('he-IL')}</span>
        <button class="btn-outline sm" data-action="cat-page" data-dir="1"${page >= pages - 1 ? ' disabled' : ''}>הבא</button>
      </div>`;
    }
  }
  const popular = gridTiles;
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
    <h1 class="page-title">בניית הרשימה שלך</h1>
    <p class="page-sub">מחפשים מוצר בקטלוג — הוא נמצא בכל הרשתות ומושווה אוטומטית.</p>
    <div class="bld-grid">
      <div>
        <div class="search-wrap">
          <input id="searchInput" class="input search" autocomplete="off" enterkeyhint="search"
            placeholder="חיפוש לפי שם, ברקוד או מק&quot;ט — חלב, 7290…">
          <div id="suggestBox" class="suggest" hidden></div>
        </div>
        <div class="import-ctas">
          <button class="rcpt-cta" data-action="go-receipt">📸 <b>יש קבלה מקנייה קודמת?</b>
            סרקו אותה ונמלא את הרשימה בשבילכם</button>
          <button class="rcpt-cta" data-action="go-recipe">🔗 <b>יש מתכון?</b>
            הדביקו קישור ובחרו את המוצרים המדויקים</button>
        </div>
        <div class="pop-block">
          ${catChips}
          <div class="block-kicker">${esc(gridTitle)}</div>
          ${letterRow}
          <div class="pop-grid">${popular}</div>
          ${pagerH}
        </div>
        ${noteH()}
        <div class="card list-card">
          <div class="list-head"><h2>הרשימה שלי</h2><span class="muted">${t.items.length} מוצרים ברשימה</span></div>
          ${t.items.length ? rows : `<div class="list-empty">הרשימה ריקה — חפשו מוצר, בחרו מהמוצרים הנפוצים,
            או <button class="linklike" data-action="go-receipt">📸 צלמו קבלה</button> ונמלא אותה בשבילכם.</div>`}
          ${t.items.length ? `<div class="list-foot"><button class="btn-ghost" data-action="clear-list">🗑 ניקוי הרשימה</button></div>` : ''}
        </div>
      </div>
      <aside class="bld-side">
        <div class="side-card tinted">
          <h2>מה חשוב לך?</h2>
          <p class="muted sm">קובע איך נדרג את הרשתות.</p>
          <div class="prio-list">${prio}</div>
        </div>
        <div class="side-card elevated">
          <div class="est-row"><span class="muted sm">הערכה מוקדמת</span><span class="est-num">${est.label}</span></div>
          <div class="muted sm est-note">${esc(est.note)}</div>
          <button class="btn-primary block" data-action="go-results">השוואת מחירים</button>
          <button class="btn-outline block" data-action="save-list">שמירת הרשימה</button>
        </div>
        ${extensionPromoH(true)}
        ${promoCarouselH(true)}
      </aside>
    </div>
  </div>`;
}

function resultsH() {
  const t = computeRows();
  if (!t.items.length) {
    return `<div class="wrap page"><div class="card empty-cta">
      <h1>אין עדיין מה להשוות</h1><p class="muted">הוסיפו מוצרים לרשימה ונחשב את הסל הזול ביותר.</p>
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
      const slot = r.m.noOnline ? '' : nextSlot(r.label);
      return `<div class="res-card${isBest ? ' best' : ''}">
        ${chainVisual(r.label)}
        <div class="res-main">
          <div class="res-name-row">
            <span class="res-name">${esc(r.label)}${r.m.noOnline ? '' : ' אונליין'}</span>
            ${r.m.noOnline ? '<span class="tag min-tag">🏬 קנייה בסניף — אין אונליין</span>' : ''}
            ${isBest ? '<span class="tag best-tag">הכי משתלם</span>' : ''}
            ${r.missing.length ? `<span class="tag miss-tag" title="${esc(r.missing.map(p => p.n).join(', '))}">${r.missing.length === 1 ? 'מוצר אחד חסר' : r.missing.length + ' מוצרים חסרים'}</span>` : ''}
            ${r.belowMin ? `<span class="tag min-tag">מתחת למינימום ${ils0(r.m.min)}</span>` : ''}
            ${r.promoSaved > 0.005 ? `<span class="tag promo-tag">🏷 כולל מבצעים בשווי ${money(r.promoSaved)}</span>` : ''}
          </div>
          <div class="res-meta">${r.m.noOnline
            ? 'ללא דמי משלוח — רשימה מסודרת לפי מחלקות לקנייה בסניף'
            : `${slot ? `משלוח קרוב: ${slot} (הערכה) · ` : ''}דמי משלוח ${ils0(r.m.fee)} · מינימום ${ils0(r.m.min)}${deliveryLineH(r.label) ? ' · ' + deliveryLineH(r.label) : ''}`}</div>
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
            <span class="split-chain">${chainVisual(g.label, 'sm')}${esc(g.label)} אונליין</span>
            <span class="muted sm">${g.lines.length} מוצרים</span>
          </div>
          ${g.lines.map(l => `<div class="split-line"><span>${esc(l.pr.n)}${l.qty > 1 ? ' ×' + l.qty : ''}</span>
            <span class="muted">${money(l.price)}</span></div>`).join('')}
          <div class="split-foot"><span class="muted sm">משלוח משוער ${ils0(g.m.fee)}</span><b>${ils0(g.sub + g.m.fee)}</b></div>
        </div>`).join('') + `</div>`;
  }
  return `<div class="wrap page">
    <div class="res-head">
      <div><h1 class="page-title">${esc(head)}</h1><p class="page-sub">${sub}</p></div>
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
    <h1 class="page-title">הסל שלך ב${esc(label)}</h1>
    <p class="page-sub">${lines.length} מתוך ${t.items.length} מוצרים נמצאו${m.noOnline
      ? ' · קנייה בסניף — אין חנות אונליין'
      : (slot ? ' · משלוח קרוב: ' + esc(slot) + ' (הערכה)' : '')}</p>
    <div class="bsk-grid">
      <div>
        <div class="card">${linesH || '<div class="list-empty">אף מוצר מהרשימה לא נמצא ברשת זו.</div>'}</div>
        ${deals.length ? `<div class="side-card tinted subs-card deals-card">
          <h2>💡 השלמת מבצעים</h2>
          <p class="muted sm">מבצעי כמות שכמעט הגעתם אליהם — הוסיפו יחידות כדי לקבל את מחיר המבצע.</p>
          ${dealsH}</div>` : ''}
        ${r.missing.length ? `<div class="side-card tinted subs-card">
          <h2>חלופות למוצרים חסרים</h2>
          <p class="muted sm">מוצרים שלא נמצאו ב${esc(label)} — הצעה לחלופה דומה במחיר אמיתי מהקטלוג.</p>
          ${subsH}</div>` : ''}
      </div>
      <aside class="side-card elevated checkout">
      ${m.noOnline ? `
        <div class="co-head">${chainVisual(label)}<span>${esc(label)} · קנייה בסניף</span></div>
        <div class="co-rows">
          <div class="co-row"><span class="muted">סל המוצרים (${lines.length})</span><b>${money(r.sub)}</b></div>
          ${r.promoSaved > 0.005 ? `<div class="co-row promo"><span class="muted">🏷 כבר כולל מבצעים בשווי</span><b>${money(r.promoSaved)}</b></div>` : ''}
          <div class="co-row"><span class="muted">דמי משלוח</span><b>אין — קנייה בסניף</b></div>
        </div>
        <div class="co-total"><span>לתשלום (משוער)</span><span class="co-total-num">${ils0(r.sub + acceptedTotal)}</span></div>
        <div class="instore-guide">
          <b>ל${esc(label)} אין חנות אונליין — כך עושים את זה הכי בקל:</b>
          <ol>
            <li>לחצו על הכפתור — הרשימה תסודר <b>לפי סדר המחלקות בסופר</b>
              (ירקות ← מאפים ← בשר ← מוצרי חלב ← קפואים ← מזווה…) ותועתק לנייד.</li>
            <li>שלחו אותה לעצמכם בוואטסאפ — נוחה לסימון ✓ תוך כדי קנייה.</li>
            <li>בסניף: עגלת <b>אושר סמארט</b> סורקת את המוצרים תוך כדי הקנייה —
              בלי תור בקופה.</li>
            <li><a href="${esc(m.branches || m.home || '#')}" target="_blank" rel="noopener">מציאת הסניף הקרוב ↗</a></li>
          </ol>
        </div>
        <button class="btn-primary block" data-action="handoff" data-chain="${esc(label)}">📋 הכנת רשימה לקנייה בסניף</button>
        <p class="fine center">המחירים לפי מחירון ${esc(label)}; המחיר הסופי נקבע בקופה.</p>
      ` : `
        <div class="co-head">${chainVisual(label)}<span>${esc(label)} אונליין</span></div>
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
        <button class="btn-primary block" data-action="handoff" data-chain="${esc(label)}">${hasExtension() ? '🔌 מילוי העגלה ב' + esc(label) : 'בניית ההזמנה ב' + esc(label)}</button>
        <p class="fine center">${hasExtension()
          ? 'התוסף יפתח את אתר הרשת וילווה אתכם בהוספת הפריטים לעגלה — בתוך החשבון שלכם. התשלום מתבצע מול הרשת.'
          : 'ההזמנה נבנית בעגלת האתר של הרשת — הרשימה תועתק ללוח והחנות תיפתח בלשונית חדשה. התשלום מתבצע מול הרשת.'}</p>
        ${extensionPromoH()}
      `}
      </aside>
    </div>
  </div>`;
}

function doneH() {
  const h = state.lastHandoff;
  if (h.inStore) {
    return `<div class="done">
      <div class="done-circle">🏬</div>
      <h1>הרשימה מוכנה לקנייה בסניף ${esc(h.label)}</h1>
      <p class="page-sub">${h.count} מוצרים (${ils0(h.total)} משוער, ללא דמי משלוח) הועתקו ללוח —
        מסודרים לפי סדר המחלקות בסופר, עם משבצת סימון ליד כל מוצר.
        שלחו לעצמכם בוואטסאפ וסמנו תוך כדי קנייה; בסניף אפשר לסרוק עם עגלת
        אושר סמארט ולדלג על התור בקופה.</p>
      <div class="done-ctas">
        <a class="btn-primary" href="https://wa.me/?text=${encodeURIComponent(h.text || '')}"
          target="_blank" rel="noopener">📱 שליחה לוואטסאפ</a>
        ${h.branches ? `<a class="btn-outline" href="${esc(h.branches)}" target="_blank" rel="noopener">📍 מציאת סניף</a>` : ''}
        <button class="btn-outline" data-action="go-build">חזרה לרשימה</button>
      </div>
    </div>`;
  }
  return `<div class="done">
    <div class="done-circle">✓</div>
    <h1>הרשימה מוכנה ל${esc(h.label)}</h1>
    <p class="page-sub">העתקנו ${h.count} מוצרים (${ils0(h.total)} משוער) ללוח ופתחנו את ${esc(h.label)} אונליין בלשונית חדשה —
      הדביקו את הרשימה בחיפוש החנות או עברו מוצר־מוצר, ואשרו את העגלה שם.</p>
    <div class="done-ctas">
      <button class="btn-primary" data-action="go-saved">הרשימות שלי</button>
      <button class="btn-outline" data-action="go-build">חזרה לרשימה</button>
    </div>
    ${extensionPromoH()}
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
          title="${sel ? 'הסרת הרשימה מהאיחוד' : 'הוסף רשימה לצורך איחוד רשימות'}"
          aria-label="${sel ? 'הסרת הרשימה מהאיחוד' : 'הוסף רשימה לצורך איחוד רשימות'}">${sel ? '✓' : '+'}</button></div>
      <div class="saved-name">${esc(s.name)}</div>
      <div class="saved-preview">${esc(prods.slice(0, 4).map(p => p.n.split(' ').slice(0, 2).join(' ')).join(', '))}${prods.length > 4 ? ' ועוד' : ''}</div>
      <div class="saved-foot"><span class="muted sm">${prods.length} מוצרים</span><span class="saved-price">${ils0(best)}</span></div>
      <button class="btn-outline block" data-action="load-list" data-id="${esc(s.id)}">טעינת הרשימה</button>
      ${s.own ? `<button class="btn-ghost sm" data-action="delete-list" data-id="${esc(s.id)}">מחיקה</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="wrap page">
    <h1 class="page-title">רשימות שמורות</h1>
    <p class="page-sub">טוענים רשימה קיימת, או מסמנים כמה רשימות ומאחדים אותן לרשימה אחת — כפילויות מתמזגות אוטומטית.${state.saved.length ? '' : ' (אלה רשימות לדוגמה — שמרו רשימה משלכם ממסך הרשימה.)'}</p>
    ${noteH()}
    <div class="merge-bar"><span>${mergeBar}</span>
      <div class="merge-ctas">
        ${selCount > 1 ? '<button class="btn-primary" data-action="merge-lists">איחוד הרשימות שנבחרו</button>' : ''}
        ${selCount > 0 ? '<button class="btn-outline" data-action="clear-select">ניקוי הבחירה</button>' : ''}
        <button class="btn-outline" data-action="save-list">שמירת הרשימה הנוכחית</button>
        <button class="btn-outline" data-action="go-receipt" data-from="saved">📸 רשימה חדשה מקבלה</button>
      </div>
    </div>
    <div class="saved-grid">${cards}</div>
  </div>`;
}

function setupH() {
  const fb = state.auth.mode === 'firebase';
  const signup = state.authMode === 'signup';
  const form = fb ? `
      <h1 class="page-title">${signup ? 'פתיחת חשבון' : 'ברוכים השבים'}</h1>
      <p class="page-sub">${signup
        ? 'הרשימות, הכתובת וההעדפות יסונכרנו לחשבון ויהיו זמינים מכל מכשיר.'
        : 'התחברו כדי לקבל את הרשימות וההעדפות שלכם מכל מכשיר.'}</p>
      <div class="seg auth-tabs">
        <button class="seg-opt${!signup ? ' on' : ''}" data-action="auth-tab" data-mode="login">כניסה</button>
        <button class="seg-opt${signup ? ' on' : ''}" data-action="auth-tab" data-mode="signup">הרשמה</button>
      </div>
      ${signup ? `<div class="field"><label>שם מלא</label>
        <input id="aName" class="input" placeholder="דנה כהן" value="${esc(state.profile.name)}"></div>` : ''}
      <div class="field"><label>דוא״ל</label>
        <input id="aEmail" class="input" type="email" placeholder="you@example.com"
          value="${esc(state.profile.email)}" autocomplete="email"></div>
      <div class="field"><label>סיסמה</label>
        <input id="aPass" class="input" type="password" placeholder="לפחות 6 תווים"
          autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
      ${signup ? `<div class="field"><label>כתובת למשלוח (לא חובה)</label>
        <input id="aAddress" class="input" placeholder="רחוב, מספר, עיר" value="${esc(state.address)}"></div>` : ''}
      ${!signup ? `<button class="btn-ghost auth-forgot" data-action="auth-reset">שכחתי סיסמה</button>` : ''}
      ${state.authError ? `<div class="auth-error">${esc(state.authError)}</div>` : ''}
      <button class="btn-primary block lg" data-action="auth-submit" ${state.authBusy ? 'disabled' : ''}>
        ${state.authBusy ? 'רק רגע…' : (signup ? 'יצירת חשבון' : 'כניסה')}</button>
      <div class="auth-or"><span></span>או<span></span></div>
      <button class="btn-outline block google-btn" data-action="auth-google" ${state.authBusy ? 'disabled' : ''}>
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.7 2.3-7.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>
        התחברות עם Google</button>
      <p class="fine center">ההרשמה מהווה הסכמה ל<a href="#/terms">תנאי השימוש ומדיניות הפרטיות</a>.</p>
      <button class="btn-ghost block" data-action="go-build">המשך ללא חשבון</button>`
    : `
      <h1 class="page-title">הגדרת פרופיל</h1>
      <p class="page-sub">הפרטים — שם, כתובת ורשימות הקניות — נשמרים ומאובטחים בהתאם לחוק
        ול<a href="#/terms">תנאי השימוש ומדיניות הפרטיות</a>.</p>
      <div class="field"><label>שם מלא</label>
        <input id="fName" class="input" placeholder="דנה כהן" value="${esc(state.profile.name)}"></div>
      <div class="field"><label>דוא״ל (לא חובה)</label>
        <input id="fEmail" class="input" type="email" placeholder="you@example.com" value="${esc(state.profile.email)}"></div>
      <div class="field"><label>כתובת למשלוח</label>
        <input id="fAddress" class="input" placeholder="רחוב, מספר, עיר" value="${esc(state.address)}"></div>
      <button class="btn-primary block lg" data-action="save-profile">שמירה והמשך</button>
      <button class="btn-ghost block" data-action="go-build">דילוג בינתיים</button>`;
  return `<div class="auth">
    <div class="auth-form">
      <div class="ob-brand">${logoSvg(44, false)}<span dir="ltr">ליםSlim</span></div>
      ${form}
    </div>
    <div class="auth-aside">
      <div class="auth-blob a"></div><div class="auth-blob b"></div>
      <div class="auth-aside-in">
        <h2>פרופיל אחד, כל הרשתות במקום אחד.</h2>
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
          ${avatar(p.name || state.auth.user?.email || 'א', 'xl')}
          <div class="pro-id"><h1>${esc(p.name || state.auth.user?.name || 'אורח/ת')}</h1>
            <div class="muted">${esc(state.auth.user?.email || p.email || 'לא הוזן דוא"ל')}
              ${state.auth.user ? ' · <span class="sync-badge">☁ מסונכרן לחשבון</span>' : ''}</div></div>
          ${state.auth.user
            ? `<button class="btn-outline" data-action="sign-out">יציאה מהחשבון</button>`
            : `<button class="btn-outline" data-action="go-setup">${state.auth.mode === 'firebase' ? 'התחברות / הרשמה' : 'עריכת פרופיל'}</button>`}
        </div>
        <div class="card">
          <h2>פרטי משלוח</h2>
          <div class="pro-fields">
            <div class="field"><label>כתובת</label>
              <input id="pAddress" class="input" value="${esc(state.address)}" placeholder="רחוב, מספר, עיר"></div>
            <div class="field"><label>טלפון</label>
              <input id="pPhone" class="input" value="${esc(p.phone)}" placeholder="050-0000000"></div>
          </div>
        </div>
        <div class="card">
          <h2>רשתות מועדפות</h2>
          <p class="muted sm">רק הרשתות המסומנות נכללות בהשוואה.</p>
          <div class="chips">${chips}</div>
        </div>
      </div>
      <aside class="bld-side">
        <div class="side-card tinted"><h2>החיסכון שלי</h2>${stats}</div>
        <div class="side-card elevated"><h2>הזמנות שהוכנו</h2>${orders}
          <button class="btn-outline block" data-action="go-saved">הרשימות השמורות שלי</button></div>
        <button class="btn-ghost block" data-action="reset-profile">מחיקת הפרופיל והנתונים מהדפדפן</button>
      </aside>
    </div>
  </div>`;
}

function termsH() {
  return `<div class="wrap page legal">
    <h1 class="page-title">תנאי שימוש</h1>
    <p class="muted sm">עודכן לאחרונה: 9 באוגוסט 2026</p>
    <div class="card">
      <h2>1. כללי</h2>
      <p>אתר "ליםSlim" (להלן: "האתר") מופעל על ידי Segolan Holdings (להלן: "החברה") ומציג
      השוואת מחירים ומבצעים בין חנויות האונליין של רשתות מזון בישראל, לצד כלים לבניית
      רשימת קניות. השימוש באתר מהווה הסכמה מלאה לתנאים אלה. אם אינכם מסכימים לתנאים —
      אנא הימנעו משימוש באתר.</p>
      <h2>2. אופי המידע באתר</h2>
      <p>המחירים והמבצעים מחושבים מקבצי מחירונים פומביים שהרשתות מפרסמות מכוח הדין,
      ומתעדכנים על בסיס יומי. ייתכנו פערים בין הנתונים המוצגים לבין המחיר בפועל.
      דמי המשלוח, מינימום ההזמנה, חלונות האספקה ואזורי החלוקה המוצגים באתר הם
      <b>הערכות בלבד</b>. המחיר הסופי, זמינות המוצרים ותנאי האספקה נקבעים אך ורק
      באתר הרשת שבה מתבצעת ההזמנה.</p>
      <h2>3. העדר אחריות</h2>
      <p>האתר והמידע שבו מסופקים כמות שהם (AS-IS) וללא כל אחריות, מפורשת או משתמעת.
      החברה אינה מתחייבת לדיוק, שלמות, עדכניות או זמינות המידע והשירות, ולא תישא
      בכל אחריות ו/או חבות, ישירה או עקיפה, לכל נזק, הפסד או הוצאה שייגרמו למשתמש
      או לצד שלישי בקשר עם השימוש באתר או הסתמכות על המידע שבו — והשימוש הוא באחריות
      המשתמש בלבד. ההזמנה, התשלום והאספקה מתבצעים ישירות מול הרשת הרלוונטית; החברה
      אינה צד לעסקה, אינה מוכרת מוצרים ואינה אחראית להם.</p>
      <h2>4. קניין רוחני</h2>
      <p>© כל הזכויות באתר, בעיצובו ובסימניו שמורות ל־Segolan Holdings. אין להעתיק,
      לשכפל, להפיץ או לעשות שימוש מסחרי בתכני האתר ללא אישור מראש ובכתב מהחברה.
      שמות הרשתות, הלוגואים וסימני המסחר המוזכרים באתר שייכים לבעליהם; אזכורם נועד לזיהוי ולהשוואת מחירים בלבד ואין בו כדי להעיד על חסות, שיתוף פעולה או קשר מסחרי עם החברה.</p>
      <h2>5. מקורות מידע</h2>
      <p>נתוני המחירים והמבצעים: מיזם <a href="https://www.gov.il/he/pages/cpfta_prices_regulations"
      target="_blank" rel="noopener">שקיפות המחירים</a> של משרד הכלכלה והתעשייה, מתוך
      הקבצים שמפרסמות הרשתות (שופרסל, רמי לוי, ויקטורי, יינות ביתן / קרפור, יוחננוף,
      אושר עד, חצי חינם). השלמת כתובות: © <a href="https://www.openstreetmap.org/copyright"
      target="_blank" rel="noopener">OpenStreetMap</a> contributors (שירות Photon).
      תמונות מוצרים (בקירוב, לפי ברקוד): <a href="https://world.openfoodfacts.org/"
      target="_blank" rel="noopener">Open Food Facts</a>.
      זיהוי טקסט בסריקת קבלות: מנוע הקוד הפתוח
      <a href="https://github.com/tesseract-ocr/tesseract" target="_blank" rel="noopener">Tesseract</a>,
      הפועל כולו בדפדפן המשתמש.</p>
      <h2>6. פרטיות ומאגר מידע</h2>
      <p>במסגרת השימוש באתר נאספים ונשמרים פרטים שהמשתמש מוסר — ובהם שם, פרטי
      התקשרות, כתובת למשלוח ורשימות הקניות — וכן נתוני שימוש הנדרשים לתפעול השירות.
      המידע נשמר במאגרי החברה ומאובטח בהתאם לחוק הגנת הפרטיות, התשמ"א-1981,
      ולתקנות הגנת הפרטיות (אבטחת מידע), התשע"ז-2017. החברה עושה שימוש במידע לצורך
      הפעלת השירות, חישוב ההשוואות ושיפור השירות בלבד, ולא תעביר אותו לצדדים
      שלישיים אלא כנדרש על פי דין. חלק מהנתונים נשמר גם באחסון המקומי של דפדפן
      המשתמש לנוחותו. בהתאם לחוק, כל משתמש רשאי לעיין במידע השמור עליו ולבקש את
      תיקונו או מחיקתו בפנייה לדוא"ל
      <a href="mailto:segolen.holdings@gmail.com">segolen.holdings@gmail.com</a>.
      חיפוש כתובת ותמונות מוצרים כרוכים בפנייה לשירותים חיצוניים (OpenStreetMap /
      Open Food Facts) בהתאם לתנאי אותם שירותים.
      סריקת קבלות מתבצעת כולה במכשיר המשתמש: תמונת הקבלה מעובדת בדפדפן בלבד,
      אינה נשלחת לשרת כלשהו ואינה נשמרת על ידי החברה.
      בייבוא מתכון מקישור, שליפת דף המתכון עשויה להתבצע דרך שירותי תיווך (proxy)
      ציבוריים חינמיים; במקרה כזה מועברת לשירות התיווך כתובת הקישור בלבד, ותמיד
      ניתן להדביק את רשימת המצרכים כטקסט במקום. תוסף הדפדפן של ליםSlim שומר את
      רשימת ההעברה באחסון המקומי של הדפדפן בלבד, אינו אוסף מידע אישי, אינו ניגש
      לסיסמאות ואינו שולח נתונים לשום שרת.</p>
      <h2>7. שינויים ודין חל</h2>
      <p>החברה רשאית לעדכן את האתר ואת התנאים בכל עת. על תנאים אלה יחולו דיני מדינת
      ישראל, וסמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים במחוז תל אביב.</p>
    </div>
  </div>`;
}

function accessibilityH() {
  return `<div class="wrap page legal">
    <h1 class="page-title">הצהרת נגישות</h1>
    <p class="muted sm">עודכנה לאחרונה: 9 באוגוסט 2026</p>
    <div class="card">
      <h2>מחויבות לנגישות</h2>
      <p>Segolan Holdings פועלת להנגשת אתר "ליםSlim" לאנשים עם מוגבלות, מתוך תפיסה של
      שוויון הזדמנויות ובהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998,
      ולתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013,
      בשאיפה לעמידה בתקן הישראלי ת"י 5568 ברמה AA (בהתבסס על הנחיות WCAG 2.1).</p>
      <h2>התאמות הנגישות באתר</h2>
      <p>האתר תומך בניווט מלא במקלדת עם סימון מיקוד ברור, כתוב ב־HTML סמנטי עם תוויות
      ARIA לרכיבים אינטראקטיביים, מותאם לעברית וכיוון RTL, רספונסיבי למובייל, ושומר על
      ניגודיות צבעים נאותה. בנוסף זמין בכל עמודי האתר <b>תפריט נגישות</b> (הכפתור ♿
      בפינת המסך) המאפשר: הגדלת טקסט, ניגודיות גבוהה, גווני אפור, הדגשת קישורים,
      גופן קריא ועצירת אנימציות. ההעדפות נשמרות בדפדפן.</p>
      <h2>מגבלות ידועות</h2>
      <p>תמונות המוצרים מגיעות ממקור חיצוני (Open Food Facts) וייתכן שלחלקן חסר תיאור
      מלא; אתרי הרשתות שאליהם מפנה האתר אינם בשליטתנו ורמת הנגישות בהם באחריות
      מפעיליהם. אנו ממשיכים לפעול לשיפור הנגישות באופן שוטף.</p>
      <h2>פנייה בנושא נגישות</h2>
      <p>נתקלתם בקושי או שיש לכם הצעה לשיפור? נשמח לשמוע ולטפל בהקדם:
      Segolan Holdings — דוא"ל: <a href="mailto:segolen.holdings@gmail.com">segolen.holdings@gmail.com</a>.</p>
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
  if (typeof startCarouselAuto === 'function') startCarouselAuto();
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
    case 'receipt': body = receiptH(); break;
    case 'recipe': body = recipeH(); break;
    case 'terms': body = termsH(); break;
    case 'accessibility': body = accessibilityH(); break;
    default: body = buildH();
  }
  app.innerHTML = (isApp ? navH() : '') + body + (isApp ? footH() : '');
  bindScreen();
}

// The nav strip scrolls horizontally once the links outgrow narrow screens, so the
// active pill has to be scrolled into view. Fonts load with display=swap: the pills
// reflow after first paint and the offset set there gets clamped, so re-apply on
// every reflow of the strip (font swap, viewport resize) rather than once at render.
let navPillObs = null;
function keepNavPillVisible(link) {
  if (navPillObs) navPillObs.disconnect();
  const show = () => link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  show();
  if (typeof ResizeObserver !== 'function') return;
  navPillObs = new ResizeObserver(show);
  navPillObs.observe(link.parentElement);
  for (const pill of link.parentElement.children) navPillObs.observe(pill);
}

function bindScreen() {
  const activeLink = $('.nav-link.on');
  if (activeLink) keepNavPillVisible(activeLink);
  const si = $('#searchInput');
  if (si) {
    let timer = 0;
    si.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderSuggest(si.value), 120);
    });
    si.addEventListener('keydown', e => { if (e.key === 'Escape') hideSuggest(); });
    // the phone path collapses the list after each pick, so tapping the field
    // again has to bring the same results back
    si.addEventListener('focus', () => renderSuggest(si.value));
  }
  const sv = $('#rcptSaveList');
  if (sv) sv.addEventListener('change', () => { state.receipt.saveAsList = sv.checked; });
  const rcpSv = $('#rcpSaveList');
  if (rcpSv) rcpSv.addEventListener('change', () => { state.recipe.saveAsList = rcpSv.checked; });
  const rcpUrl = $('#rcpUrl');
  if (rcpUrl) {
    rcpUrl.addEventListener('input', () => { state.recipe.url = rcpUrl.value; });
    rcpUrl.addEventListener('keydown', e => { if (e.key === 'Enter') startRecipeFetch(rcpUrl.value); });
  }
  const rcpText = $('#rcpText');
  if (rcpText) rcpText.addEventListener('input', () => { state.recipe.text = rcpText.value; });
  // per-row product search (recipe rows + receipt rows): replaces only that
  // row's chips in place, so the input keeps focus while typing
  const bindChipSearch = (inp, getRow, listHFor) => {
    let timer = 0;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const row = getRow();
        if (!row) return;
        row.search = inp.value;
        row.cands = recipeMatches(inp.value.trim() || row.term).map(p => p.k);
        row.shown = RCP_CHIPS_FIRST;
        const list = inp.closest('.rcp-chips')?.querySelector('.rcp-chip-list');
        if (list) { list.innerHTML = listHFor(row); scanImages(); }
      }, 250);
    });
  };
  document.querySelectorAll('.rcp-search:not(.rcpt-alt-search)').forEach(inp => bindChipSearch(inp,
    () => state.recipe.ingredients[+inp.dataset.i],
    row => rcpChipsListH(row, +inp.dataset.i)));
  document.querySelectorAll('.rcpt-alt-search').forEach(inp => bindChipSearch(inp,
    () => {
      const it = state.receipt.items[+inp.dataset.i];
      return it && it.alt;
    },
    alt => chipsListH(alt.cands, alt.shown,
      state.receipt.items[+inp.dataset.i].pr?.k || null, 'rcpt-alt', +inp.dataset.i)));
  const rf = $('#rcptFile');
  if (rf) {
    rf.addEventListener('change', () => startReceiptScan(rf.files && rf.files[0]));
    const drop = $('#rcptDrop');
    if (drop) {
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('drag');
        startReceiptScan(e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }
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
  startCarouselAuto();
}
function bindField(sel, save) {
  const el = $(sel);
  if (el) el.addEventListener('input', () => save(el.value.trim()));
}

function hideSuggest() { const b = $('#suggestBox'); if (b) { b.hidden = true; b.innerHTML = ''; } }
/* Phone layout — same 680px breakpoint the stylesheet switches the app at. */
function isPhoneLayout() { return matchMedia('(max-width: 680px)').matches; }
function renderSuggest(query) {
  const box = $('#suggestBox');
  if (!box) return;
  const q = query.trim().toLowerCase();
  if (q.length < 2) { hideSuggest(); return; }
  const isCode = /^\d{3,}$/.test(q);
  const scored = [];
  for (const pr of state.products) {
    let score, codeHit = null;
    if (isCode) {
      codeHit = pr.codes.find(c => c === q) ||
                pr.codes.find(c => c.startsWith(q));
      if (codeHit) score = codeHit === q ? -1 : 1;
      else if (pr.nLow.includes(q)) score = 2;
      else continue;
    } else if (pr.nLow.startsWith(q)) score = 0;
    else if (pr.nLow.includes(' ' + q)) score = 1;
    else if (pr.nLow.includes(q) || pr.bLow.includes(q)) score = 2;
    else continue;
    scored.push([score, pr, codeHit]);
  }
  scored.sort((a, b) => a[0] - b[0] || avail(b[1]) - avail(a[1]) ||
    minActivePrice(a[1], true) - minActivePrice(b[1], true));
  const top = scored.slice(0, 8);
  if (!top.length) { box.innerHTML = '<div class="suggest-none">לא נמצאו מוצרים תואמים</div>'; box.hidden = false; return; }
  box.innerHTML = top.map(([, pr, codeHit]) => `
    <button class="suggest-row" data-action="add-search" data-key="${esc(pr.k)}">
      <span class="sug-main"><span class="sug-name">${esc(pr.n)}</span>
      <span class="sug-sub">${esc([codeHit ? 'מק"ט ' + codeHit : '', pr.c ? state.categories[pr.c] : '', pr.b, pr.u].filter(Boolean).join(' · ') || 'ללא פרטים')}</span></span>
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
  if (m.noOnline) {
    // in-store chain: department-sorted checklist instead of an online cart
    const inStoreItems = [...lines, ...subsAccepted.map(pr => ({ pr, qty: 1 }))];
    const inStoreTotal = r.sub + acceptedTotal;
    const text = inStoreListText(label, inStoreItems, inStoreTotal);
    copyText(text);
    state.orders.unshift({ store: label, date: state.date || new Date().toISOString().slice(0, 10),
      count: inStoreItems.length, total: inStoreTotal,
      items: inStoreItems.map(({ pr, qty }) => [pr.k, qty]) });
    state.orders = state.orders.slice(0, 20);
    saveLS(LS.orders, state.orders);
    state.lastHandoff = { label, count: inStoreItems.length, total: inStoreTotal,
      inStore: true, text, branches: m.branches || m.home };
    nav('#/done/' + encodeURIComponent(label));
    return;
  }
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
  // handoff payload for the ליםSlim browser extension (fills the cart inside
  // the user's own session on the chain's site)
  try {
    const payload = {
      id: Date.now().toString(36),
      chain: label,
      date: state.date,
      total,
      items: [
        ...lines.map(({ pr, qty }) => ({ name: pr.n, qty, ean: productEan(pr) })),
        ...subsAccepted.map(pr => ({ name: pr.n, qty: 1, ean: productEan(pr) })),
      ],
    };
    localStorage.setItem('slim-handoff-v1', JSON.stringify(payload));
    window.dispatchEvent(new Event('slim-handoff'));
  } catch (_) {}
  if (m.home) window.open(m.home, '_blank', 'noopener');
  state.orders.unshift({ store: label, date: state.date || new Date().toISOString().slice(0, 10),
    count: lines.length + subsAccepted.length, total,
    items: [...lines.map(({ pr, qty }) => [pr.k, qty]),
            ...subsAccepted.map(pr => [pr.k, 1])] });
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
    case 'go-receipt':
      state.visited = true; persistPrefs();
      state.receipt.returnTo = btn.dataset.from || '';
      nav('#/receipt'); break;
    case 'rcpt-pick': { const rf = $('#rcptFile'); if (rf) rf.click(); break; }
    case 'rcpt-toggle': {
      const it = state.receipt.items[+btn.dataset.idx];
      if (it) { it.on = !it.on; render(); }
      break;
    }
    case 'rcpt-inc': case 'rcpt-dec': {
      const it = state.receipt.items[+btn.dataset.idx];
      if (it) {
        it.qty = Math.max(1, Math.min(99, it.qty + (a === 'rcpt-inc' ? 1 : -1)));
        render();
      }
      break;
    }
    case 'rcpt-commit': commitReceipt(); break;
    case 'rcpt-reset': resetReceipt(); render(); break;
    case 'rcpt-alt-toggle': {
      const it = state.receipt.items[+btn.dataset.idx];
      if (it) {
        if (!it.alt) it.alt = receiptAltFor(it);
        else it.alt.open = !it.alt.open;
        render();
      }
      break;
    }
    case 'rcpt-alt-pick': {
      const it = state.receipt.items[+btn.dataset.i];
      const pr = state.byKey.get(btn.dataset.key);
      if (it && pr) {
        it.pr = pr; it.via = 'manual'; it.on = true;
        if (it.alt) it.alt.open = false;
        render();
      }
      break;
    }
    case 'rcpt-alt-more': {
      const it = state.receipt.items[+btn.dataset.i];
      if (it && it.alt) { it.alt.shown += RCP_CHIPS_STEP; render(); }
      break;
    }
    case 'go-recipe': state.visited = true; persistPrefs(); nav('#/recipe'); break;
    case 'rcp-fetch': startRecipeFetch(($('#rcpUrl') || {}).value); break;
    case 'rcp-paste-toggle':
      state.recipe.pasteOpen = !state.recipe.pasteOpen;
      render(); break;
    case 'rcp-paste-run': startRecipeText(($('#rcpText') || {}).value); break;
    case 'rcp-pick': {
      const row = state.recipe.ingredients[+btn.dataset.i];
      if (row) {
        row.chosen = row.chosen === btn.dataset.key ? null : btn.dataset.key;
        render();
      }
      break;
    }
    case 'rcp-more': {
      const row = state.recipe.ingredients[+btn.dataset.i];
      if (row) { row.shown += RCP_CHIPS_STEP; render(); }
      break;
    }
    case 'rcp-have': {
      const row = state.recipe.ingredients[+btn.dataset.i];
      if (row) { row.have = !row.have; render(); }
      break;
    }
    case 'rcp-inc': case 'rcp-dec': {
      const row = state.recipe.ingredients[+btn.dataset.i];
      if (row) {
        row.qty = Math.max(1, Math.min(99, row.qty + (a === 'rcp-inc' ? 1 : -1)));
        render();
      }
      break;
    }
    case 'rcp-commit': commitRecipe(); break;
    case 'rcp-reset': resetRecipe(); render(); break;
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
      if (!si2) break;
      si2.value = v;
      if (isPhoneLayout()) {
        // On a phone the dropdown plus the soft keyboard cover the list, so the
        // product you just added is invisible and there is no feedback. Collapse
        // and release focus; tapping the field reopens the same results.
        hideSuggest();
        si2.blur();
      } else {
        si2.focus();          // desktop keeps the list up for a quick second pick
        renderSuggest(v);
      }
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
    case 'category': {
      const v = btn.dataset.cat;
      state.catFilter = v === '' ? null : parseInt(v, 10);
      state.catPage = 0;
      state.catLetter = null;
      render(); break;
    }
    case 'cat-letter':
      state.catLetter = btn.dataset.letter || null;
      state.catPage = 0;
      render(); break;
    case 'cat-page': {
      state.catPage = Math.max(0, state.catPage + (+btn.dataset.dir));
      render();
      // back to the top of the grid — the new page starts there
      const grid = document.querySelector('.pop-block');
      if (grid) window.scrollTo({ top: Math.max(0, grid.offsetTop - 70) });
      break;
    }
    case 'pc-scroll': {
      const track = btn.closest('.promo-carousel')?.querySelector('.pc-track');
      if (track) {
        track.dataset.paused = '1';            // manual control pauses auto-advance
        setTimeout(() => { track.dataset.paused = ''; }, 6000);
        track.scrollBy({ left: (+btn.dataset.dir) * -Math.round(track.clientWidth * 0.8),
          behavior: 'smooth' });
      }
      break;                                   // no re-render — keep scroll position
    }
    case 'add-deal': {
      const m = parseInt(btn.dataset.m, 10) || 1;
      const cur = state.list.get(btn.dataset.key) || 0;
      state.list.set(btn.dataset.key, Math.min(99, cur < m ? m : cur + 1));
      persistList();
      toast(m > 1 ? `נוספו ${m} יחידות — כמות המבצע 🏷` : 'נוסף לרשימה 🏷');
      render();
      break;
    }
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
    case 'hide-ext-promo': saveLS('slim-ext-promo-hidden', true); render(); break;
    case 'save-profile': {
      const firstTime = !state.visited;      // device-mode "registration"
      state.profile.name = ($('#fName') || {}).value?.trim() || '';
      state.profile.email = ($('#fEmail') || {}).value?.trim() || '';
      state.address = ($('#fAddress') || {}).value?.trim() || state.address;
      saveLS(LS.profile, state.profile); persistPrefs();
      state.visited = true; persistPrefs();
      toast('הפרופיל נשמר בדפדפן');
      if (firstTime) welcomeToReceipt(); else nav('#/build');
      break;
    }
    case 'auth-tab':
      state.authMode = btn.dataset.mode;
      state.authError = '';
      render(); break;
    case 'auth-submit': authSubmit(); break;
    case 'auth-google': authGoogle(); break;
    case 'auth-reset': authReset(); break;
    case 'sign-out':
      clearTimeout(cloudTimer);                  // never sync the cleared state
      firebase.auth().signOut().then(() => {
        state.auth.user = null;
        for (const k of [LS.list, LS.profile, LS.saved, LS.orders, LS.stats]) {
          localStorage.removeItem(k);
        }
        state.list = new Map();
        state.profile = { name: '', email: '', phone: '' };
        state.saved = [];
        state.orders = [];
        state.stats = { comparisons: 0, lastSaving: 0, potential: 0 };
        state.address = '';
        state.addressCity = '';
        state.subs = {};
        state.lastHandoff = null;
        state.selectedLists = {};
        state.visited = true;
        persistPrefs();
        lastComparisonSig = '';
        toast('התנתקת מהחשבון — הנתונים האישיים נוקו מהמכשיר');
        nav('#/build');
        render();
      });
      break;
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
  initAuth();
  loadData().then(() => route());
});
