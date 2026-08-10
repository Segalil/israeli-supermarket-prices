/* Hazi Hinam adapter — validated live: /searchResults/{barcode} resolves the
   exact product, tile [class*="product-item"], add button .product_cube-add. */
window.SLIM_CHAIN = {
  label: 'חצי חינם',
  barcodeSearch: true,
  searchUrl: q => `https://shop.hazi-hinam.co.il/searchResults/${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.startsWith('/searchResults'),
  tileSelectors: ['[class*="product-item"]', '[class*="product_cube"]', 'app-product-box'],
  addSelectors: ['button.product_cube-add', '[class*="product_cube-add"]', 'button[aria-label*="הוס"]'],
  verifySelectors: ['input[type="number"]', '[class*="quantity"]', '[class*="counter"]'],
};
