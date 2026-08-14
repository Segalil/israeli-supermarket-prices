/* Shufersal online adapter. Selector candidates are best-effort against the
   current site build — when none match, the panel's assisted mode still works
   (search link + "הוספתי"). Update selectors here when the site changes. */
window.SLIM_CHAIN = {
  label: 'שופרסל',
  barcodeSearch: true,
  searchUrl: q => `https://www.shufersal.co.il/online/he/search?text=${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.includes('/search') || location.search.includes('text='),
  /* Shufersal's search key is its INTERNAL product code, which for most items
     equals the EAN (the tile reads data-product-code="P_7290019014614") but for
     a legacy family is a short number instead ("P_66295"). The transparency
     file publishes the full EAN either way, so searching it returns nothing for
     those — 882 of Shufersal's 13,953 barcoded rows. Verified live: text=
     7290000066295 gives no tiles, text=66295 returns "במבה מתוקה בטעם תות".
     Fewer than four digits is not attempted: "22" stops being a code lookup and
     becomes a text search that returns מוצרלה 22% and "22 chic לק עמיד". */
  altCodes: ean => {
    if (!/^7290000\d{6}$/.test(ean)) return [];
    const short = ean.slice(7).replace(/^0+/, '');
    return short.length >= 4 ? [short] : [];
  },
  /* tiles carry the internal code, so the panel can confirm it grabbed the
     right product instead of trusting the first result */
  tileCode: tile => {
    const el = tile.closest('[data-product-code]') || tile.querySelector('[data-product-code]');
    const raw = (el || tile).getAttribute && (el || tile).getAttribute('data-product-code');
    return raw ? raw.replace(/^P_/, '') : null;
  },
  tileSelectors: [
    'li.miglog-prod', '.miglog-prod-inStock', '[data-miglog-productcode]',
    'ul.tileBlock li.tileBlock-item',
  ],
  addSelectors: [
    'button.js-add-to-cart', 'button.miglog-btn-add', '.btnAdd',
    'button[data-selector="btn-addToCart"]', 'button.addToCartBtn',
  ],
  verifySelectors: ['.miglog-quantity', 'input.js-miglog-quantity', '[class*="qtyDropdown"]', 'input[type="number"]'],
};
