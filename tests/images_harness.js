/* Exercises the product-image ladder in site/app.js: chain CDN first,
   OpenFoodFacts only when every CDN candidate errors, 'none' when all fail.
   Run: node tests/images_harness.js  (prints PASS/FAIL lines, exits 1 on FAIL) */
'use strict';
const loadApp = require('./load_app');

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (cond || !detail ? '' : ' — ' + detail));
  if (!cond) failures++;
}

/* ---- stubs the ladder touches ---- */
const imageLog = [];        // every URL an Image() was pointed at
let cdnAnswers = () => true; // per-test policy for Image loads
global.Image = class {
  set src(url) {
    imageLog.push(url);
    const ok = cdnAnswers(url);
    setTimeout(() => (ok ? this.onload && this.onload() : this.onerror && this.onerror()), 0);
  }
};
const fetchLog = [];
let offAnswer = null;       // null → OFF has nothing
global.fetch = url => {
  fetchLog.push(url);
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(
      offAnswer ? { status: 1, product: { image_front_small_url: offAnswer } } : { status: 0 }),
  });
};

const { imageCandidates, resolveImage, productEan, productVisual } =
  loadApp(['imageCandidates', 'resolveImage', 'productEan', 'productVisual']);

(async () => {
  /* candidate construction */
  const cands = imageCandidates('7290122782554');
  check('a real EAN yields the Rami Levy CDN URL first',
    cands[0] === 'https://img.rami-levy.co.il/product/7290122782554/small.jpg', JSON.stringify(cands));
  check('a chain-internal short code gets no CDN guess (403-family, not an EAN)',
    imageCandidates('134').length === 0);
  check('a non-numeric key gets no CDN guess', imageCandidates('n:חלב|g1000.0').length === 0);

  /* ladder order: CDN hit never consults OFF */
  imageLog.length = fetchLog.length = 0;
  cdnAnswers = () => true;
  const hit = await resolveImage('7290122782554');
  check('CDN hit is returned as-is', hit === 'https://img.rami-levy.co.il/product/7290122782554/small.jpg', hit);
  check('CDN hit never calls OpenFoodFacts', fetchLog.length === 0, fetchLog.join());

  /* CDN miss falls through to OFF */
  imageLog.length = fetchLog.length = 0;
  cdnAnswers = () => false;
  offAnswer = 'https://images.openfoodfacts.org/x/front_small.jpg';
  const off = await resolveImage('7290122782554');
  check('CDN miss falls back to the OFF image', off === offAnswer, off);
  check('the CDN was actually tried first', imageLog.length >= 1 && fetchLog.length === 1);

  /* everything missing resolves to null → caller caches none */
  offAnswer = null;
  check('all-miss resolves null', (await resolveImage('7290122782554')) === null);

  /* productVisual still only tags slots for barcoded products */
  const barcoded = loadApp.prod('7290122782554', 'רוטב טריאקי', [10], ['7290122782554']);
  const produce = loadApp.prod('n:בננה|g1000.0', 'בננה', [5], []);
  check('barcoded product renders an image slot', productVisual(barcoded).includes('data-ean="7290122782554"'));
  check('EAN-less produce keeps the emoji/letter avatar', !productVisual(produce).includes('data-ean'));
  check('productEan ignores short internal codes', productEan(loadApp.prod('רמי לוי:134', 'בננה', [5], [])) === null);

  process.exit(failures ? 1 : 0);
})();
