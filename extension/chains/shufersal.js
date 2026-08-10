/* Shufersal online adapter. Selector candidates are best-effort against the
   current site build — when none match, the panel's assisted mode still works
   (search link + "הוספתי"). Update selectors here when the site changes. */
window.SLIM_CHAIN = {
  label: 'שופרסל',
  barcodeSearch: true,
  searchUrl: q => `https://www.shufersal.co.il/online/he/search?text=${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.includes('/search') || location.search.includes('text='),
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
