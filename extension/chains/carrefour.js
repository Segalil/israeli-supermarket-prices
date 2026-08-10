/* Carrefour (יינות ביתן) adapter — same platform as Victory, validated live:
   /search/{barcode} resolves the exact product, tile `.item`,
   add button `button.add-to-cart`. */
window.SLIM_CHAIN = {
  label: 'יינות ביתן / קרפור',
  barcodeSearch: true,
  searchUrl: q => `https://www.carrefour.co.il/search/${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.startsWith('/search'),
  tileSelectors: ['.item', '.special-item', '[class*="product"]'],
  addSelectors: ['button.add-to-cart', '.product-actions button'],
  verifySelectors: ['input[type="number"]', '[class*="quantity"]', '[class*="qty"]'],
};
