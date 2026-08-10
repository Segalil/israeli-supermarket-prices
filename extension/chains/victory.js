/* Victory online adapter — validated live: /search/{barcode} resolves the
   exact product, tile `.item`, add button `button.add-to-cart` ("הוסיפו"). */
window.SLIM_CHAIN = {
  label: 'ויקטורי',
  barcodeSearch: true,
  searchUrl: q => `https://www.victoryonline.co.il/search/${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.startsWith('/search'),
  tileSelectors: ['.item', '.special-item', '[class*="product"]'],
  addSelectors: ['button.add-to-cart', '.product-actions button'],
  verifySelectors: ['input[type="number"]', '[class*="quantity"]', '[class*="qty"]'],
};
