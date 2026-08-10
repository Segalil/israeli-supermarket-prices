/* Node harness for the recipe-import feature (no browser, no network): loads
   site/app.js via tests/load_app.js, then checks Hebrew ingredient-term
   extraction, schema.org Recipe JSON-LD parsing over the fixture page,
   pasted-text parsing, and candidate generation against a fixture catalog.
   Prints a JSON verdict; run by tests/test_recipe_import.py. */
'use strict';
const fs = require('fs');
const path = require('path');
const loadApp = require('./load_app');
const { prod } = loadApp;

const ROOT = path.join(__dirname, '..');
const harness = loadApp(['state', 'ingredientTerm', 'recipeFromJsonLd',
  'recipeFromPastedText', 'recipeFromLooseText', 'buildRecipeRows', 'recipeCandidates']);

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

/* ---- 1. ingredient line → shopping term ---- */
const TERM_CASES = [
  ['6 ביצים', 'ביצים'],
  ['2 כפות שמן זית', 'שמן זית'],
  ['1 בצל גדול קצוץ', 'בצל'],
  ['3 שיני שום כתושות', 'שום'],
  ['800 גרם עגבניות מרוסקות (2 קופסאות)', 'עגבניות מרוסקות'],
  ['חצי כפית כמון טחון', 'כמון'],
  ['צרור פטרוזיליה קצוצה להגשה', 'פטרוזיליה'],
  ['2 כוסות קמח לבן', 'קמח לבן'],
  ['מלח ופלפל שחור לפי הטעם', 'מלח ופלפל שחור'],
  ['לחם טרי להגשה', 'לחם'],
];
for (const [line, want] of TERM_CASES) {
  const got = harness.ingredientTerm(line);
  check(got === want, `term("${line}") = "${got}" != "${want}"`);
}

/* ---- 2. JSON-LD extraction from the fixture page ---- */
const html = fs.readFileSync(
  path.join(ROOT, 'samples', 'recipe-import', 'fixture-recipe.html'), 'utf8');
const rec = harness.recipeFromJsonLd(html);
check(!!rec, 'JSON-LD Recipe not found in fixture');
if (rec) {
  check(rec.name === 'שקשוקה קלאסית של סבתא', `recipe name = "${rec.name}"`);
  check(rec.ingredients.length === 11, `ingredients = ${rec.ingredients.length} != 11`);
}

/* ---- 3. pasted-text mode: headers/bullets filtered, instructions cut off ---- */
const pasted = harness.recipeFromPastedText(
  'מצרכים:\n- 2 כוסות קמח לבן\n- 3 ביצים\n\nלרוטב:\n- חצי כוס שמן זית\nאופן ההכנה\nמערבבים הכל');
check(!!pasted && pasted.ingredients.length === 3,
  `pasted lines = ${pasted && pasted.ingredients.length} != 3 (headers drop, ההכנה חותכת)`);
check(!!pasted && !pasted.ingredients.includes('מערבבים הכל'),
  'instruction line leaked past the אופן ההכנה header');

/* ---- 4. candidate generation over a fixture catalog ---- */
harness.state.products = [
  prod('7290000000017', 'ביצים L תבניתי 12 יחידות', [24.9, 23.9, null]),
  prod('7290000000024', 'שמן זית כתית מעולה 750 מל יד מרדכי', [49.9, null, 44.9]),
  prod('7290000000031', 'בצל יבש ארוז', [5.9, 4.9, null]),
  prod('7290000000048', 'שום ראש טרי', [3.9, null, null]),
  prod('7290000000055', 'פלפל אדום חממה', [9.9, 8.9, null]),
  prod('7290000000062', 'עגבניות מרוסקות 400 גרם פרי ניב', [7.9, 6.9, 7.5]),
  prod('7290000000079', 'פפריקה מתוקה 100 גרם', [8.9, null, null]),
  prod('7290000000086', 'כמון טחון פרג', [7.9, null, null]),
  prod('7290000000093', 'מלח שולחני דק 1 קג', [3.9, 2.9, null]),
  prod('7290000000109', 'פטרוזיליה צרור', [4.9, null, null]),
  prod('7290000000116', 'לחם אחיד פרוס', [7.9, 6.9, null]),
  // distractors — legitimate alternatives the human picks between, or noise
  prod('7290000000203', 'אבקת שום 100 גרם', [6.9, null, null]),
  prod('7290000000210', 'קמח לבן אוסם 1 קג', [6.9, 5.9, null]),
  prod('7290000000227', 'קמח מלא 1 קג', [8.9, null, null]),
  prod('7290000000234', 'פלפל שחור גרוס 50 גרם', [7.9, null, null]),
  prod('7290000000241', 'מלפפון חממה', [4.9, 3.9, null]),
  prod('7290000000258', 'שוקולד מריר 100 גרם', [5.9, null, null]),
];

const rows = harness.buildRecipeRows(rec ? rec.ingredients : []);
check(rows.length === 11, `rows = ${rows.length} != 11`);
const rowByRaw = new Map(rows.map(r => [r.raw, r]));
const expectCand = [
  ['6 ביצים', '7290000000017'],
  ['2 כפות שמן זית', '7290000000024'],
  ['3 שיני שום כתושות', '7290000000048'],
  ['800 גרם עגבניות מרוסקות (2 קופסאות)', '7290000000062'],
  ['מלח ופלפל שחור לפי הטעם', '7290000000093'],   // shorten-loop lands on מלח
  ['לחם טרי להגשה', '7290000000116'],
];
for (const [raw, key] of expectCand) {
  const row = rowByRaw.get(raw);
  check(!!row, `row missing for "${raw}"`);
  if (row) check(row.cands.includes(key), `cands for "${raw}" miss ${key}: [${row.cands}]`);
}
// human-in-the-middle invariants: nothing pre-chosen, flour is ambiguous on purpose
check(rows.every(r => r.chosen === null), 'a row arrived pre-chosen — must stay a human choice');
const flour = harness.buildRecipeRows(['2 כוסות קמח'])[0];
check(flour && flour.cands.length >= 2, 'קמח must yield multiple candidates to choose from');
// the noise product never surfaces for any shakshuka ingredient
check(!rows.some(r => r.cands.includes('7290000000258')), 'שוקולד מריר leaked into candidates');

console.log(JSON.stringify({ ok: !failures.length, failures, rows: rows.length }));
process.exit(failures.length ? 1 : 0);
