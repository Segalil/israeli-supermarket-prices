/* Yohananof adapter (React/MUI app). Search route confirmed:
   /search?q={term}. The catalog renders only after the user picks a branch
   (their standard first-visit step) — the panel's verification + assisted
   mode guide the user through it. Selectors are best-effort. */
window.SLIM_CHAIN = {
  label: 'יוחננוף',
  barcodeSearch: true,
  searchUrl: q => `https://yochananof.co.il/search?q=${encodeURIComponent(q)}`,
  isSearchPage: () => location.pathname.startsWith('/search'),
  tileSelectors: ['[data-testid*="product"]', '[class*="ProductCard"]', '[class*="product-card"]', 'li[class*="Mui"]'],
  addSelectors: ['button[aria-label*="הוס"]', '[class*="add"] button', 'button[class*="Add"]'],
  verifySelectors: ['input[type="number"]', '[class*="quantity"]', '[class*="Counter"]'],
};
