(function () {
  console.log('%c[DCS] content script starting on ' + location.href, 'background:#5865f2;color:white;padding:2px 6px;border-radius:4px');

  const SEEN = new Set();

  function clean(s) { return (s||'').replace(/\s+/g,' ').trim(); }

  function parseChannel() {
    // URL: /channels/{guildId}/{channelId}
    const m = location.pathname.match(/\/channels\/([^/]+)\/([^/]+)/);
    const guildId = m ? m[1] : '';
    const channelId = m ? m[2] : location.pathname;
    // Name: header title in Discord
    let channelName = '';
    try {
      const h = document.querySelector('h1[class*="title"], [data-slate-editor]') || document.querySelector('header h1, header h2, [class*="headerText"]');
      // better: the channel header with aria-label
      const titleEl = document.querySelector('[class*="titleWrapper"] h1, [class*="title"] h1, header [class*="name"]');
      if (titleEl) channelName = clean(titleEl.innerText);
      if (!channelName) {
        const dm = document.querySelector('[class*="upperContainer"] [class*="name"]');
        if (dm) channelName = clean(dm.innerText);
      }
    } catch {}
    if (!channelName) channelName = channelId;
    return { guildId, channelId, channelName, url: location.href, path: location.pathname };
  }

  function save(messages) {
    if (!messages.length) return;
    console.log('[DCS] saving', messages.length, messages[0].text.slice(0,120));
    chrome.storage.local.get({ discordMessages: [] }, (r) => {
      const all = [...(r.discordMessages||[]), ...messages];
      const seen = new Set(); const out=[];
      for (const m of all) if (!seen.has(m.text + '|' + m.channelId)) { seen.add(m.text + '|' + m.channelId); out.push(m); }
      chrome.storage.local.set({ discordMessages: out.slice(-2000) }, () => {
        console.log('[DCS] now stored', out.length);
      });
    });
    try {
      chrome.runtime.sendMessage({type:'SAVE_MESSAGES', messages}, () => void chrome.runtime.lastError);
    } catch {}
  }

  function harvest() {
    const out = [];
    const ch = parseChannel();
    document.querySelectorAll('[id^="message-content-"]').forEach(el => {
      const t = clean(el.innerText);
      if (t.length < 3 || t.length > 4000) return;
      const k = t + '|' + ch.channelId;
      if (SEEN.has(k)) return;
      SEEN.add(k);
      out.push({ id: String(Date.now()+Math.random()), text: t, timestamp: new Date().toISOString(), url: ch.url, channel: ch.path, channelId: ch.channelId, channelName: ch.channelName, guildId: ch.guildId });
    });
    if (out.length === 0) {
      const list = document.querySelector('[data-list-id="chat-messages"]');
      if (list) list.querySelectorAll('li, div[data-list-item-id]').forEach(li => {
        const content = li.querySelector('[id^="message-content-"], [class*="messageContent"]') || li;
        const t = clean(content.innerText);
        if (t.length < 10 || t.length > 2000) return;
        if (/^(Online|Offline|Members|Direct Messages)$/i.test(t)) return;
        const k = t + '|' + ch.channelId;
        if (SEEN.has(k)) return;
        SEEN.add(k);
        out.push({ id: String(Date.now()+Math.random()), text: t, timestamp: new Date().toISOString(), url: ch.url, channel: ch.path, channelId: ch.channelId, channelName: ch.channelName, guildId: ch.guildId });
      });
    }
    return out;
  }

  // capture channel list for picker (sidebar)
  function scrapeChannels() {
    const channels = [];
    document.querySelectorAll('a[data-list-item-id*="channels___"], a[href*="/channels/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/channels\/([^/]+)\/([^/]+)/);
      if (!m) return;
      const name = clean(a.innerText || a.getAttribute('aria-label') || '') || m[2];
      if (name.length > 40) return;
      channels.push({ guildId: m[1], channelId: m[2], name, href });
    });
    if (channels.length) {
      chrome.storage.local.get({ discordChannelIndex: [] }, r => {
        const all = [...(r.discordChannelIndex||[]), ...channels];
        const byId = new Map();
        all.forEach(c => byId.set(c.channelId, c));
        chrome.storage.local.set({ discordChannelIndex: [...byId.values()].slice(-200) });
      });
    }
  }

  setTimeout(() => { save(harvest()); scrapeChannels(); }, 1000);
  setInterval(() => { const h = harvest(); if (h.length) save(h); scrapeChannels(); }, 2000);
  const mo = new MutationObserver(() => { const h = harvest(); if (h.length) save(h); });
  mo.observe(document.body, { childList: true, subtree: true });

  chrome.storage.local.get({ dcsDebug: null }, () => {
    const ch = parseChannel();
    save([{ id: 'dbg-'+Date.now(), text: 'DCS heartbeat — ' + new Date().toLocaleTimeString() + ' on #' + ch.channelName, timestamp: new Date().toISOString(), url: ch.url, channel: ch.path, channelId: ch.channelId, channelName: ch.channelName, guildId: ch.guildId }]);
  });

  console.log('[DCS] listeners attached');
})();
