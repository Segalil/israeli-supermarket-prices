/* Toolbar popup: shows whether a transfer list is waiting and for which chain. */
chrome.storage.local.get(['handoff', 'progress']).then(({ handoff, progress = {} }) => {
  const line = document.getElementById('statusLine');
  const detail = document.getElementById('statusDetail');
  if (handoff && Array.isArray(handoff.items) && handoff.items.length &&
      progress.dismissed !== handoff.id) {
    const done = progress.id === handoff.id
      ? Object.keys(progress.done || {}).length : 0;
    line.textContent = `רשימה ממתינה להעברה ב${handoff.chain}`;
    detail.textContent = `${handoff.items.length} מוצרים · הועברו ${done} · פתחו את אתר הרשת והפאנל יופיע`;
  } else {
    line.textContent = 'אין רשימה ממתינה כרגע';
    detail.textContent = 'הכינו הזמנה באתר ליםSlim והתוסף ימשיך משם';
  }
});
