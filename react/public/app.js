// Mobile menu: button toggles the link list; closes on outside click, Escape, or link choice.
const menuBtn = document.getElementById("menuBtn");
const menuList = document.getElementById("menuList");
if (menuBtn && menuList) {
  const setOpen = (open) => {
    menuBtn.setAttribute("aria-expanded", String(open));
    menuList.hidden = !open;
  };
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menuList.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!menuList.hidden && !e.target.closest(".menu")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuList.hidden) {
      setOpen(false);
      menuBtn.focus();
    }
  });
  menuList.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
}

// Theme toggle: flips between light and dark, starting from whatever is showing now.
const toggle = document.querySelector(".theme-toggle");
if (toggle) {
  const root = document.documentElement;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme || (dark.matches ? "dark" : "light");
  const label = () => toggle.setAttribute("aria-label", current() === "dark" ? "Switch to light theme" : "Switch to dark theme");
  label();
  dark.addEventListener("change", label);
  toggle.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", next === "dark" ? "#0d1526" : "#fbfaf7"));
    try { localStorage.setItem("theme", next); } catch (e) {}
    label();
  });
}

// Case study: rendered from assets/case-study/case-study.json, which the
// owner fills in (photos + numbers from a real measurement). The section and
// its nav links stay hidden until the JSON sets published:true, so nothing
// half-finished ever ships. All strings are inserted as text, never HTML.
(async () => {
  const section = document.getElementById("case-study");
  if (!section) return;
  const slot = (key) => section.querySelector(`[data-cs="${key}"]`);
  let cs = null;
  try {
    const res = await fetch("assets/case-study/case-study.json", { cache: "no-store" });
    if (!res.ok) return;
    cs = await res.json();
  } catch (e) {
    return;
  }
  if (!cs || cs.published !== true) return;

  const setText = (key, value) => {
    const el = slot(key);
    if (!el || value == null || value === "") { if (el) el.remove(); return; }
    el.textContent = String(value);
  };
  setText("title", cs.title);
  setText("sub", cs.sub);

  const photos = slot("photos");
  if (photos) {
    photos.textContent = "";
    for (const p of cs.photos || []) {
      if (!p || !p.src) continue;
      const fig = document.createElement("figure");
      if (p.wide === true) fig.style.gridColumn = "1 / -1";
      const img = document.createElement("img");
      img.src = String(p.src);
      img.alt = String(p.alt || "");
      img.loading = "lazy";
      img.width = 1200;
      img.height = 900;
      fig.appendChild(img);
      if (p.caption) {
        const cap = document.createElement("figcaption");
        cap.textContent = String(p.caption);
        fig.appendChild(cap);
      }
      photos.appendChild(fig);
    }
    if (!photos.children.length) photos.remove();
  }

  const quote = slot("quote");
  if (quote) {
    quote.textContent = "";
    if (cs.quote && cs.quote.text) {
      if (cs.quote.cite) {
        const cite = document.createElement("span");
        cite.textContent = String(cs.quote.cite);
        quote.appendChild(cite);
      }
      quote.appendChild(document.createTextNode(`\u201C${String(cs.quote.text)}\u201D`));
    } else {
      quote.remove();
    }
  }

  const tableWrap = slot("table");
  if (tableWrap) {
    tableWrap.textContent = "";
    const rows = (cs.measurements || []).filter((r) => r && r.item);
    if (rows.length) {
      const table = document.createElement("table");
      const cap = document.createElement("caption");
      cap.className = "visually-hidden";
      cap.textContent = "Case study measurements";
      table.appendChild(cap);
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      for (const h of ["Item", "Value", "Evidence"]) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = h;
        hr.appendChild(th);
      }
      const sth = document.createElement("th");
      sth.scope = "col";
      const svh = document.createElement("span");
      svh.className = "visually-hidden";
      svh.textContent = "Status";
      sth.appendChild(svh);
      hr.appendChild(sth);
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const r of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = String(r.item);
        tr.appendChild(th);
        for (const k of ["value", "evidence"]) {
          const td = document.createElement("td");
          if (k === "evidence") td.className = "mono";
          td.textContent = r[k] != null && r[k] !== "" ? String(r[k]) : "—";
          tr.appendChild(td);
        }
        const st = document.createElement("td");
        const pill = document.createElement("span");
        pill.className = String(r.status || "").toLowerCase() === "confirmed" ? "pill pill-ok" : "pill";
        pill.textContent = String(r.status || "Confirmed");
        st.appendChild(pill);
        tr.appendChild(st);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    } else {
      tableWrap.remove();
    }
  }

  setText("method", cs.method);
  setText("verification", cs.verification);

  const compare = slot("compare");
  if (compare) {
    compare.textContent = "";
    const rows = (cs.compare && cs.compare.rows) || [];
    if (rows.length) {
      const h = document.createElement("h3");
      h.className = "doc-sec";
      h.textContent = (cs.compare && cs.compare.heading) || "Measured vs guessed";
      compare.appendChild(h);
      const strip = document.createElement("div");
      strip.className = "cs-compare";
      for (const r of rows) {
        if (!r || !r.label) continue;
        const stat = document.createElement("div");
        stat.className = "cs-stat";
        const lab = document.createElement("small");
        lab.textContent = String(r.label);
        const val = document.createElement("b");
        val.textContent = String(r.value || "—");
        stat.appendChild(lab);
        stat.appendChild(val);
        if (r.note) {
          const note = document.createElement("span");
          note.textContent = String(r.note);
          stat.appendChild(note);
        }
        strip.appendChild(stat);
      }
      compare.appendChild(strip);
    } else {
      compare.remove();
    }
  }

  setText("outcome", cs.outcome);
  const pdfview = slot("pdfview");
  if (pdfview) {
    pdfview.textContent = "";
    const pages = Array.isArray(cs.pages) ? cs.pages.filter(Boolean) : [];
    if (pages.length) {
      const wrap = document.createElement("div");
      wrap.className = "cs-pages";
      pages.forEach((src, i) => {
        const img = document.createElement("img");
        img.src = String(src);
        img.alt = `Case study report, page ${i + 1} of ${pages.length}`;
        img.loading = "lazy";
        wrap.appendChild(img);
      });
      pdfview.appendChild(wrap);
    } else if (cs.reportPdf) {
      const obj = document.createElement("object");
      obj.className = "cs-pdfview";
      obj.data = String(cs.reportPdf);
      obj.type = "application/pdf";
      obj.setAttribute("aria-label", "Case study report PDF");
      pdfview.appendChild(obj);
    } else {
      pdfview.remove();
    }
    if (cs.reportPdf) {
      const p = document.createElement("p");
      p.className = "cs-pdf";
      const a = document.createElement("a");
      a.className = "btn btn-go btn-sm";
      a.href = String(cs.reportPdf);
      a.textContent = "Download the full report (PDF)";
      p.appendChild(a);
      pdfview.append(p);
    }
  }

  section.hidden = false;
  document.querySelectorAll("[data-case-link]").forEach((a) => { a.hidden = false; });
})();

// Progress page: live repo stats from the public GitHub API (no key).
// Renders into #gh-stats/#gh-commits/#gh-people when present; the static
// milestone timeline below needs no JavaScript. Fails soft when offline
// or rate-limited so the page never looks broken.
(() => {
  const stats = document.getElementById("gh-stats");
  if (!stats) return;
  const note = document.getElementById("gh-note");
  const commitsEl = document.getElementById("gh-commits");
  const peopleEl = document.getElementById("gh-people");
  const repo = "Parithosh-Varma/snapclaim";
  const api = `https://api.github.com/repos/${repo}`;

  const rel = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? "yesterday" : `${d} days ago`;
  };
  const get = (url) => fetch(url, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const set = (key, value) => {
    const el = stats.querySelector(`[data-gh="${key}"]`);
    if (el) el.textContent = value;
  };

  Promise.all([
    get(api),
    get(`${api}/commits?per_page=5`),
    get(`${api}/contributors?per_page=6`),
  ]).then(([r, commits, people]) => {
    set("stars", String(r.stargazers_count ?? "—"));
    set("forks", String(r.forks_count ?? "—"));
    set("issues", String(r.open_issues_count ?? "—"));
    set("pushed", r.pushed_at ? rel(r.pushed_at) : "—");
    if (note) note.textContent = "Live from the public repo — refresh for the latest.";

    if (commitsEl) {
      commitsEl.textContent = "";
      for (const c of commits || []) {
        if (!c || !c.commit) continue;
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = c.html_url || `https://github.com/${repo}/commits`;
        a.textContent = String(c.commit.message || "").split("\n")[0];
        li.appendChild(a);
        const meta = document.createElement("small");
        const who = (c.commit.author && c.commit.author.name) || (c.author && c.author.login) || "someone";
        const when = c.commit.author && c.commit.author.date ? ` · ${rel(c.commit.author.date)}` : "";
        meta.textContent = `${who}${when}`;
        li.appendChild(meta);
        commitsEl.appendChild(li);
      }
      if (!commitsEl.children.length) commitsEl.textContent = "No commits found.";
    }

    if (peopleEl) {
      peopleEl.textContent = "";
      for (const p of people || []) {
        if (!p || !p.login) continue;
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = p.html_url || `https://github.com/${p.login}`;
        const img = document.createElement("img");
        img.src = `https://avatars.githubusercontent.com/u/${p.id}?v=4&s=64`;
        img.alt = "";
        img.loading = "lazy";
        img.width = 32;
        img.height = 32;
        a.appendChild(img);
        const span = document.createElement("span");
        span.textContent = `${p.login} · ${p.contributions ?? 0}`;
        a.appendChild(span);
        li.appendChild(a);
        peopleEl.appendChild(li);
      }
      if (!peopleEl.children.length) peopleEl.textContent = "No contributors found.";
    }
  }).catch(() => {
    if (note) note.textContent = "Live stats unavailable (offline or rate-limited) — the milestones below are current.";
    if (commitsEl) commitsEl.textContent = "Could not load commits.";
    if (peopleEl) peopleEl.textContent = "Could not load contributors.";
  });
})();
