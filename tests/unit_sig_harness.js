/* Runs site/app.js's unitSig() over unit strings fed in on argv and prints the
   results as JSON, so test_unit_sig.py can compare them against the Python
   unit_signature() the dataset pipeline merges with. */
'use strict';
const loadApp = require('./load_app');

const { unitSig, perUnitPrice } = loadApp(['unitSig', 'perUnitPrice']);

const inputs = JSON.parse(process.argv[2] || '[]');
const out = inputs.map(u => {
  const s = unitSig(u);
  return s ? [s.kind, s.amount] : null;
});
process.stdout.write(JSON.stringify({
  sigs: out,
  perUnit: {
    // 10 shekels for 500g is 20 per kilo; for 2 litres it is 5 per litre
    g500: perUnitPrice(10, unitSig('500 גרם')),
    l2: perUnitPrice(10, unitSig('2 ליטר')),
    unit1: perUnitPrice(10, unitSig("1 יח'")),
  },
}));
