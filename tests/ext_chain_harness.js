/* Exercises the chain adapters' barcode logic without a browser. */
'use strict';
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'extension', 'chains');

function loadChain(file) {
  global.window = {};
  new Function(fs.readFileSync(path.join(DIR, file), 'utf8'))();
  return global.window.SLIM_CHAIN;
}

/* the smallest element that cfg.tileCode actually touches */
function fakeTile(code, { onSelf = true } = {}) {
  const holder = { getAttribute: a => (a === 'data-product-code' ? code : null) };
  return {
    getAttribute: a => (onSelf && a === 'data-product-code' ? code : null),
    closest: () => (onSelf ? holder : null),
    querySelector: () => (onSelf ? null : holder),
  };
}

const shufersal = loadChain('shufersal.js');
const out = {
  chains: fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort(),
  altCodes: {
    legacyFamily:      shufersal.altCodes('7290000066295'),
    tooShortToBeSafe:  shufersal.altCodes('7290000000022'),
    threeDigits:       shufersal.altCodes('7290000000107'),
    normalBarcode:     shufersal.altCodes('7290019014614'),
    otherIsraeliPrefix: shufersal.altCodes('7296073005841'),
    notThirteenDigits: shufersal.altCodes('729000006629'),
    garbage:           shufersal.altCodes('abc'),
  },
  tileCode: {
    onSelf:   shufersal.tileCode(fakeTile('P_66295')),
    nested:   shufersal.tileCode(fakeTile('P_7290019014614', { onSelf: false })),
    noPrefix: shufersal.tileCode(fakeTile('66295')),
    absent:   shufersal.tileCode({ getAttribute: () => null, closest: () => null, querySelector: () => null }),
  },
  // every adapter still exposes the contract the panel relies on
  contract: Object.fromEntries(fs.readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => {
    const c = loadChain(f);
    return [f, { label: !!c.label, searchUrl: typeof c.searchUrl === 'function',
                 tiles: Array.isArray(c.tileSelectors),
                 altCodes: typeof c.altCodes === 'function',
                 tileCode: typeof c.tileCode === 'function' }];
  })),
};
process.stdout.write(JSON.stringify(out, null, 1));
