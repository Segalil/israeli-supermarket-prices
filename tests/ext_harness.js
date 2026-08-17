/* Drives canInstallExtension() from site/app.js against fabricated navigators,
   which is the only way to test Safari/Firefox from a Chromium test runner. */
'use strict';
const loadApp = require('./load_app');
const { canInstallExtension, EXTENSION_URL, productCodeFor } =
  loadApp(['canInstallExtension', 'EXTENSION_URL', 'productCodeFor']);

const UA = {
  chrome:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edge:    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  brave:   'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  safari:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad:    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  criOS:   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
};
const chromium = m => ({ mobile: m, brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] });

const cases = {
  // desktop Chromium, with and without the modern hints API
  chromeWithHints:   canInstallExtension({ userAgent: UA.chrome,  userAgentData: chromium(false) }),
  chromeUaOnly:      canInstallExtension({ userAgent: UA.chrome }),
  edgeUaOnly:        canInstallExtension({ userAgent: UA.edge }),
  braveUaOnly:       canInstallExtension({ userAgent: UA.brave }),
  // no userAgentData exists in these engines
  safari:            canInstallExtension({ userAgent: UA.safari }),
  firefox:           canInstallExtension({ userAgent: UA.firefox }),
  // mobile has no extension support at all, whatever the engine claims
  androidChromeHints: canInstallExtension({ userAgent: UA.android, userAgentData: chromium(true) }),
  androidChromeUaOnly: canInstallExtension({ userAgent: UA.android }),
  iphoneSafari:      canInstallExtension({ userAgent: UA.iphone }),
  ipadSafari:        canInstallExtension({ userAgent: UA.ipad }),
  chromeOnIOS:       canInstallExtension({ userAgent: UA.criOS }),
  empty:             canInstallExtension({}),
};
/* a merged banana: Shufersal's EAN is the key, the others are chain-scoped */
const banana = { k: '7290000964775', al: ['יוחננוף:623', 'רמי לוי:134'], n: 'בננה' };
const codes = {
  ramiLevy: productCodeFor(banana, 'רמי לוי'),
  yochananof: productCodeFor(banana, 'יוחננוף'),
  shufersal: productCodeFor(banana, 'שופרסל'),      // no scoped alias -> the EAN
  nameScopedIgnored: productCodeFor({ k: 'רמי לוי:במבה', al: [], n: 'במבה' }, 'רמי לוי'),
  noCodeAtAll: productCodeFor({ k: 'n:xyz', al: [], n: 'xyz' }, 'רמי לוי'),
};
process.stdout.write(JSON.stringify({ cases, url: EXTENSION_URL, codes }, null, 1));
