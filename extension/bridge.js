/* Runs on the ליםSlim site: captures the basket handoff into extension storage
   and announces the extension to the page (for UI hints). No page data beyond
   the handoff the user explicitly created ever leaves the browser. */
(() => {
  const KEY = 'slim-handoff-v1';

  function capture() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const handoff = JSON.parse(raw);
      chrome.storage.local.set({ handoff, progress: {} });
    } catch (_) { /* ignore malformed payloads */ }
  }

  const announce = () => {
    document.documentElement.dataset.slimExtension =
      chrome.runtime.getManifest().version;
  };
  if (document.documentElement) announce();
  document.addEventListener('DOMContentLoaded', announce);

  capture();                                       // basket prepared earlier
  window.addEventListener('slim-handoff', capture); // fired by the site on handoff
})();
