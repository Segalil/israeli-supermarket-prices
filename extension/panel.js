/* The transfer panel, injected on a chain's site when a matching handoff
   exists. Walks the list item by item: opens the chain's own search for each
   product (barcode where supported), tries the chain adapter's add-to-cart
   selectors, and falls back to assisted mode — the user clicks "הוספתי" and
   the panel advances. All actions run inside the user's own session. */
(async () => {
  const cfg = window.SLIM_CHAIN;
  if (!cfg || !chrome?.storage) return;

  const { handoff, progress = {}, progressTriedName: triedNameStored = {} } =
    await chrome.storage.local.get(['handoff', 'progress', 'progressTriedName']);
  const triedNameMap = progress.id === handoff?.id ? triedNameStored : {};
  const progressTriedName = () => triedNameMap;
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

  function goSearch(item) {
    const term = (cfg.barcodeSearch && item.ean) ? item.ean : item.name;
    location.href = cfg.searchUrl(term);
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

  function setStatus(msg) {
    const el = document.getElementById('slimStatus');
    if (el) el.textContent = msg;
  }

  /* try to add the current item on a search-results page */
  async function tryAutoAdd() {
    const item = current();
    if (!item) return;
    setStatus('מחפש את המוצר בדף…');
    const tile = await waitFor(cfg.tileSelectors);
    if (!tile) {
      // barcode search found nothing — retry once by product name
      const triedName = progressTriedName();
      if (cfg.barcodeSearch && item.ean && !triedName[state.idx] &&
          location.href.includes(item.ean)) {
        triedName[state.idx] = true;
        await chrome.storage.local.set({ progressTriedName: triedName });
        setStatus('לא נמצא לפי ברקוד — מנסה לפי שם…');
        location.href = cfg.searchUrl(item.name);
        return;
      }
      setStatus('לא נמצאו תוצאות — הוסיפו ידנית או דלגו');
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
