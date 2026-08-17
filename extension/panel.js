/* The transfer panel, injected on a chain's site when a matching handoff
   exists. Walks the list item by item: opens the chain's own search for each
   product (barcode where supported), tries the chain adapter's add-to-cart
   selectors, and falls back to assisted mode — the user clicks "הוספתי" and
   the panel advances. All actions run inside the user's own session. */
(async () => {
  const cfg = window.SLIM_CHAIN;
  if (!cfg || !chrome?.storage) return;

  const { handoff, progress = {}, progressTerm: termStored = {} } =
    await chrome.storage.local.get(['handoff', 'progress', 'progressTerm']);
  const termMap = progress.id === handoff?.id ? termStored : {};
  const progressTerm = () => termMap;
  if (!handoff || !Array.isArray(handoff.items) || !handoff.items.length) return;
  if (handoff.chain !== cfg.label) return;         // a different chain was chosen
  if (progress.dismissed === handoff.id) return;   // user closed the panel for this handoff

  const state = {
    idx: progress.id === handoff.id ? (progress.idx || 0) : 0,
    done: progress.id === handoff.id ? (progress.done || {}) : {},
    auto: progress.id === handoff.id ? !!progress.auto : false,
    listOpen: false,
  };
  // items the chain's catalog doesn't carry ride along for a manual attempt —
  // the auto walk skips them up front
  handoff.items.forEach((it, i) => {
    if (it.missing && state.done[i] === undefined) state.done[i] = 'skip';
  });

  const save = () => chrome.storage.local.set({
    progress: { id: handoff.id, idx: state.idx, done: state.done, auto: state.auto },
  });

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    };
    try { navigator.clipboard.writeText(text).catch(fallback); }
    catch (_) { fallback(); }
  }
  function itemListText() {
    return handoff.items.map((it, i) =>
      `${i + 1}. ${it.name} — ${it.ean ? 'מק"ט ' + it.ean : 'ללא מק"ט'} — ×${it.qty}` +
      (it.missing ? ' (לא נמצא בקטלוג הרשת)' : '')).join('\n');
  }

  /* ---------- UI ---------- */
  const root = document.createElement('div');
  root.id = 'slim-panel';
  root.dir = 'rtl';
  document.documentElement.appendChild(root);

  function doneCount() { return Object.keys(state.done).length; }
  function current() { return handoff.items[state.idx]; }

  function render() {
    const total = handoff.items.length;
    const item = current();
    const finished = doneCount() >= total || !item;
    root.innerHTML = `
      <div class="slim-head">
        <b>ליםSlim · העברת סל</b>
        <span class="slim-count">${doneCount()}/${total}</span>
        <button class="slim-x" data-act="close" title="סגירה">×</button>
      </div>
      ${finished ? `
        <div class="slim-done">🎉 כל הפריטים טופלו! בדקו את העגלה והמשיכו לתשלום באתר.</div>
        <button class="slim-btn primary" data-act="close">סיום</button>`
      : `
        <div class="slim-item">
          <div class="slim-item-name">${esc(item.name)}</div>
          <div class="slim-item-meta">כמות: ${item.qty}${item.ean ? ` · ברקוד ${esc(item.ean)}` : ''}</div>
          <div class="slim-status" id="slimStatus">${state.auto ? 'מוסיף אוטומטית…' : 'פתחו בחיפוש והוסיפו לעגלה'}</div>
        </div>
        <div class="slim-actions">
          <button class="slim-btn primary" data-act="auto">${state.auto ? '⏸ השהיה' : '▶ מילוי אוטומטי'}</button>
          <button class="slim-btn" data-act="search">🔎 חיפוש הפריט</button>
          <button class="slim-btn" data-act="added">✓ הוספתי</button>
          <button class="slim-btn subtle" data-act="skip">דילוג</button>
        </div>
        <div class="slim-list">${handoff.items.map((it, i) => `
          <span class="slim-dot${state.done[i] ? ' ok' : ''}${i === state.idx ? ' cur' : ''}"
            title="${esc(it.name)}"></span>`).join('')}</div>`}
      <button class="slim-btn subtle slim-toggle" data-act="toggle-list">
        ${state.listOpen ? 'הסתרת הרשימה' : `📋 כל הרשימה — שם, מק״ט וכמות (${total})`}</button>
      ${state.listOpen ? `
        <div class="slim-rows">${handoff.items.map((it, i) => `
          <div class="slim-row${state.done[i] === true ? ' ok' : ''}${it.missing ? ' miss' : ''}">
            <span class="slim-row-qty">×${it.qty}</span>
            <span class="slim-row-main">
              <span class="slim-row-name">${esc(it.name)}</span>
              <span class="slim-row-code">${it.missing
                ? 'לא נמצא בקטלוג הרשת — שווה לנסות ידנית'
                : it.ean ? `מק"ט ${esc(it.ean)}` : 'ללא מק"ט — חיפוש לפי שם'}</span>
            </span>
            <button class="slim-mini" data-act="row-copy" data-i="${i}"
              title="העתקת המק&quot;ט (או השם) להדבקה בחיפוש">⧉</button>
            <button class="slim-mini" data-act="row-search" data-i="${i}"
              title="פתיחת הפריט בחיפוש האתר">🔎</button>
          </div>`).join('')}</div>
        <button class="slim-btn subtle" data-act="copy-all">⧉ העתקת כל הרשימה</button>` : ''}
    `;
  }

  function advance() {
    for (let i = 0; i < handoff.items.length; i++) {
      const j = (state.idx + 1 + i) % handoff.items.length;
      if (!state.done[j]) { state.idx = j; save(); render(); return true; }
    }
    state.idx = handoff.items.length; save(); render(); return false;
  }

  /* What to type into the chain's search, best first. The EAN is the precise
     key where the chain indexes it; altCodes covers chains whose internal code
     differs from the barcode for some items; the name is the last resort. */
  function searchTerms(item) {
    const terms = [];
    if (cfg.barcodeSearch) {
      // item.code is the code THIS chain files the product under (produce and
      // other no-EAN items are chain-scoped) — it outranks the generic EAN,
      // which may belong to a different chain's listing of the merged product
      if (item.code) terms.push(String(item.code));
      if (item.ean && String(item.ean) !== String(item.code)) terms.push(String(item.ean));
      if (typeof cfg.altCodes === 'function' && item.ean) {
        for (const alt of cfg.altCodes(item.ean) || []) {
          if (alt && !terms.includes(String(alt))) terms.push(String(alt));
        }
      }
    }
    if (item.name) terms.push(item.name);
    return terms.length ? terms : [item.name || ''];
  }

  /* On the NAME step of chains that expose no tile code there is nothing to
     verify against, and the first tile can be a different product entirely —
     a search for "משקה סויה אלטרנטיב" leads with soy SAUCE. Require the tile's
     text to share most of the item's meaningful words before auto-adding. */
  function nameMatchesTile(tile, item) {
    const words = String(item.name || '').split(/\s+/)
      .filter(w => w.length >= 3 && !/^[\d.,%*]+$/.test(w));
    if (!words.length) return true;
    const text = (tile.textContent || '');
    const hit = words.filter(w => text.includes(w)).length;
    return hit >= Math.max(1, Math.ceil(words.length / 2));
  }

  function goSearch(item, step = 0) {
    const terms = searchTerms(item);
    const i = Math.min(step, terms.length - 1);
    const map = progressTerm();
    map[state.idx] = i;
    chrome.storage.local.set({ progressTerm: map });
    location.href = cfg.searchUrl(terms[i]);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(selectors, timeout = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await sleep(300);
    }
    return null;
  }

  async function waitForAll(selectors, timeout = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length) return [...els];
      }
      await sleep(300);
    }
    return [];
  }

  /* Prefer the tile whose internal code matches what we asked for. Without this
     the panel added whichever product happened to rank first, which is a real
     risk on the name fallback and on any short-code search. Chains that expose
     no code keep the old behaviour: first tile. */
  function pickTile(tiles, item) {
    if (typeof cfg.tileCode !== 'function') return tiles[0];
    const wanted = new Set(searchTerms(item).filter(t => /^\d+$/.test(t)));
    if (!wanted.size) return tiles[0];
    let sawAnyCode = false;
    for (const t of tiles) {
      const code = cfg.tileCode(t);
      if (code) sawAnyCode = true;
      if (code && wanted.has(String(code))) return t;
    }
    return sawAnyCode ? null : tiles[0];
  }

  function setStatus(msg) {
    const el = document.getElementById('slimStatus');
    if (el) el.textContent = msg;
  }

  /* try to add the current item on a search-results page */
  async function tryAutoAdd() {
    const item = current();
    if (!item) return;
    setStatus('מחפש את המוצר בדף…');
    const tiles = await waitForAll(cfg.tileSelectors);
    if (!tiles.length) {
      // nothing found — walk down the term ladder before giving up
      const terms = searchTerms(item);
      const step = (progressTerm()[state.idx] || 0) + 1;
      if (step < terms.length) {
        setStatus(step === terms.length - 1
          ? 'לא נמצא לפי ברקוד — מנסה לפי שם…'
          : 'לא נמצא לפי ברקוד — מנסה קוד פנימי…');
        goSearch(item, step);
        return;
      }
      setStatus('לא נמצאו תוצאות — הוסיפו ידנית או דלגו');
      return;
    }
    const tile = pickTile(tiles, item);
    if (!tile) {
      setStatus('נמצאו תוצאות אך אף אחת לא תואמת את המוצר — הוסיפו ידנית או דלגו');
      return;
    }
    const terms = searchTerms(item);
    const onNameStep = (progressTerm()[state.idx] || 0) >= terms.length - 1 && !!item.name;
    if (onNameStep && typeof cfg.tileCode !== 'function' && !nameMatchesTile(tile, item)) {
      setStatus('התוצאות לא נראות כמו המוצר — הוסיפו ידנית או דלגו');
      return;
    }
    let addBtn = null;
    for (const sel of cfg.addSelectors) {
      addBtn = tile.querySelector(sel) || document.querySelector(sel);
      if (addBtn) break;
    }
    if (!addBtn) { setStatus('לא זוהה כפתור הוספה — הוסיפו ידנית ולחצו ׳הוספתי׳'); return; }
    for (let i = 0; i < item.qty; i++) {
      addBtn.click();
      await sleep(900);
    }
    // verify the add registered — on first use chains open an area/login modal
    // instead of adding, and the user must complete it once
    const verified = !cfg.verifySelectors ||
      !!(await waitFor(cfg.verifySelectors.map(s => `${cfg.tileSelectors[0]} ${s}`), 3000));
    if (!verified) {
      state.auto = false; save(); render();
      setStatus('נראה שהרשת מבקשת לבחור אזור משלוח או להתחבר — השלימו את זה פעם אחת, ואז לחצו ▶ שוב או ׳הוספתי׳');
      return;
    }
    setStatus('נוסף לעגלה ✓');
    state.done[state.idx] = true;
    save(); render();
    await sleep(800);
    if (state.auto && advance()) goSearch(current());
  }

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') {
      chrome.storage.local.set({ progress: { dismissed: handoff.id } });
      root.remove();
    } else if (act === 'search') {
      state.auto = false; save();
      goSearch(current());
    } else if (act === 'added') {
      state.done[state.idx] = true;
      advance();
    } else if (act === 'skip') {
      state.done[state.idx] = 'skip';
      advance();
    } else if (act === 'auto') {
      state.auto = !state.auto; save(); render();
      if (state.auto) {
        if (cfg.isSearchPage()) tryAutoAdd();
        else goSearch(current());
      }
    } else if (act === 'toggle-list') {
      state.listOpen = !state.listOpen;
      render();
    } else if (act === 'row-copy') {
      const it = handoff.items[+btn.dataset.i];
      if (it) {
        copyText(it.ean || it.name);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '⧉'; }, 1200);
      }
    } else if (act === 'row-search') {
      const i = +btn.dataset.i;
      if (handoff.items[i]) {
        state.idx = i; state.auto = false; save();
        goSearch(handoff.items[i]);
      }
    } else if (act === 'copy-all') {
      copyText(itemListText());
      btn.textContent = '✓ הועתק — הדביקו בפנקס או עברו פריט-פריט';
      setTimeout(() => { btn.textContent = '⧉ העתקת כל הרשימה'; }, 2200);
    }
  });

  // resume on a pending item (missing-at-chain items arrive pre-skipped)
  if (state.done[state.idx]) advance(); else render();
  /* arriving on a search page mid-run (after goSearch navigation) */
  if (state.auto && cfg.isSearchPage() && doneCount() < handoff.items.length) {
    tryAutoAdd();
  }
})();
