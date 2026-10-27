const MAX_STORED = 1000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SAVE_MESSAGES' || !Array.isArray(msg.messages)) return false;
  console.log('[DCS BG] SAVE_MESSAGES', msg.messages.length);
  chrome.storage.local.get({ discordMessages: [] }, (result) => {
    const existing = result.discordMessages || [];
    const combined = existing.concat(msg.messages);
    const seen = new Set(); const deduped=[];
    for (const m of combined) if (!seen.has(m.text)) { seen.add(m.text); deduped.push(m); }
    const trimmed = deduped.slice(-MAX_STORED);
    chrome.storage.local.set({ discordMessages: trimmed }, () => {
      console.log('[DCS BG] stored now', trimmed.length);
      sendResponse({ ok: true, stored: trimmed.length });
    });
  });
  return true;
});

console.log('[DCS BG] service worker start');
