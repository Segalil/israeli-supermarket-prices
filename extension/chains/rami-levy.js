/* Rami Levy online adapter (Vue SPA). Selector candidates are best-effort —
   assisted mode covers the rest. */
window.SLIM_CHAIN = {
  label: 'רמי לוי',
  barcodeSearch: true,
  searchUrl: q => `https://www.rami-levy.co.il/he/online/search?q=${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.includes('/search'),
  tileSelectors: [
    '.product-item', '.online-product', '[data-test="product-card"]', '.product-box',
  ],
  addSelectors: [
    'button.add-to-cart', '.btn-add-to-cart', 'button[aria-label*="הוסף"]',
    '.product-item button', '.plus-btn',
  ],
  verifySelectors: ['input[type="number"]', '.qty', '[class*="quantity"]'],
};
