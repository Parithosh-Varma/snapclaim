(function(){
  const listEl = document.getElementById('list');
  const chListEl = document.getElementById('chList');
  const countEl = document.getElementById('count');
  const debugEl = document.getElementById('debug');
  const searchEl = document.getElementById('search');

  let allMessages = [];
  let channelIndex = [];
  let selected = null; // Set<channelId> — null = all

  function load() {
    chrome.storage.local.get({discordMessages:[], discordChannelIndex:[], dcsSelected: null}, r=>{
      allMessages = r.discordMessages||[];
      channelIndex = r.discordChannelIndex||[];
      selected = r.dcsSelected ? new Set(r.dcsSelected) : null;
      render();
    });
  }

  function saveSelected(){
    const arr = selected ? [...selected] : null;
    chrome.storage.local.set({ dcsSelected: arr });
  }

  function grouped(){
    const byId = new Map();
    allMessages.forEach(m=>{
      const id = m.channelId || m.channel || 'unknown';
      const name = m.channelName || id;
      if (!byId.has(id)) byId.set(id, { id, name, count:0, guildId: m.guildId||'' });
      byId.get(id).count++;
    });
    // also include indexed channels with 0 msgs
    channelIndex.forEach(c=>{
      if (!byId.has(c.channelId)) byId.set(c.channelId, { id:c.channelId, name:c.name, count:0, guildId:c.guildId });
    });
    return [...byId.values()].sort((a,b)=> b.count - a.count);
  }

  function visibleMessages(){
    const q = (searchEl.value||'').toLowerCase();
    return allMessages.filter(m=>{
      if (selected && selected.size>0 && !selected.has(m.channelId)) return false;
      if (q && !m.text.toLowerCase().includes(q) && !(m.channelName||'').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render(){
    const vis = visibleMessages();
    const groups = grouped();
    countEl.textContent = vis.length + ' / ' + allMessages.length + ' msgs';
    debugEl.textContent = 'Stored: ' + allMessages.length + ' • Visible: ' + vis.length +
      (selected ? ' • Filtered: ' + selected.size + ' convos' : ' • All convos') +
      ' • ' + new Date().toLocaleTimeString();

    // picker
    chListEl.innerHTML='';
    if (!groups.length){
      chListEl.innerHTML='<div style="padding:10px 12px;color:#a1a1aa;font-size:11px;">No conversations seen yet — open Discord and scroll.</div>';
    } else {
      groups.forEach(g=>{
        const row=document.createElement('label'); row.className='chRow';
        const cb=document.createElement('input'); cb.type='checkbox';
        cb.checked = selected ? selected.has(g.id) : true;
        cb.onchange=()=>{
          if (selected===null) selected = new Set(groups.map(x=>x.id));
          if (cb.checked) selected.add(g.id); else selected.delete(g.id);
          if (selected.size===groups.length) selected=null;
          saveSelected(); render();
        };
        const name=document.createElement('span'); name.className='chName'; name.textContent = g.name + (g.guildId && g.guildId!=='@me' ? '' : '');
        if (g.id==='unknown') name.textContent += ' (unknown)';
        const cnt=document.createElement('span'); cnt.className='chCount'; cnt.textContent = g.count;
        row.appendChild(cb); row.appendChild(name); row.appendChild(cnt);
        chListEl.appendChild(row);
      });
    }

    // messages
    if (!vis.length){ listEl.innerHTML='<div class="empty">No messages match. Select conversations above or clear the search.</div>'; return; }
    listEl.innerHTML='';
    [...vis].reverse().slice(0,300).forEach(m=>{
      const d=document.createElement('div'); d.className='msg';
      d.textContent=m.text;
      const meta=document.createElement('div'); meta.className='meta';
      const left = (m.channelName||m.channel||'').slice(0,50);
      meta.innerHTML = `<span class="badge">#${escapeHtml(left)}</span> <span>${new Date(m.timestamp).toLocaleTimeString()}</span>`;
      d.appendChild(meta);
      listEl.appendChild(d);
    });
    if (vis.length>300){
      const more=document.createElement('div'); more.style.cssText='text-align:center;color:#a1a1aa;font-size:11px;padding:6px;';
      more.textContent = 'Showing 300 of ' + vis.length + ' — Export filtered to get all.';
      listEl.appendChild(more);
    }
  }

  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.getElementById('clear').onclick=()=>{
    if (!confirm('Delete all saved messages?')) return;
    chrome.storage.local.set({discordMessages:[], discordChannelIndex:[]}, load);
  };
  document.getElementById('testBtn').onclick=()=>{
    chrome.storage.local.get({discordMessages:[]}, r=>{
      const arr=r.discordMessages||[];
      arr.push({ id:'test-'+Date.now(), text:'TEST — storage works ' + new Date().toISOString(), timestamp:new Date().toISOString(), channel:'/test', channelId:'test', channelName:'test', guildId:'', url: location.href });
      chrome.storage.local.set({discordMessages:arr.slice(-2000)}, load);
    });
  };
  document.getElementById('exportBtn').onclick=()=>{
    const vis = visibleMessages();
    const blob=new Blob([JSON.stringify(vis, null, 2)], {type:'application/json'});
    const url=URL.createObjectURL(blob);
    if (chrome.downloads) chrome.downloads.download({url, filename:'discord-context-'+Date.now()+'.json'});
    else window.open(url);
  };
  document.getElementById('selAll').onclick=()=>{ selected=null; saveSelected(); render(); };
  document.getElementById('selNone').onclick=()=>{ selected=new Set(); saveSelected(); render(); };
  searchEl.oninput=render;

  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') load(); });
  load();

  // try to inject if needed
  chrome.tabs.query({active:true, currentWindow:true}, tabs=>{
    const tab=tabs[0];
    if (tab && tab.url && tab.url.includes('discord.com')) {
      chrome.scripting?.executeScript?.({ target:{tabId:tab.id}, files:['content/content.js'] }, ()=> void chrome.runtime.lastError);
    }
  });
})();
