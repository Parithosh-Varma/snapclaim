// Mobile menu: close on outside click, Escape, or choosing a link.
const menu = document.querySelector(".menu");
if (menu) {
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { menu.open = false; }));
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
        pill.className = "pill pill-ok";
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
    if (cs.reportPdf) {
      const h = document.createElement("h3");
      h.className = "doc-sec";
      h.textContent = "Full report";
      pdfview.appendChild(h);
      const obj = document.createElement("object");
      obj.className = "cs-pdfview";
      obj.data = String(cs.reportPdf);
      obj.type = "application/pdf";
      obj.setAttribute("aria-label", "Case study report PDF");
      const fallback = document.createElement("p");
      fallback.textContent = "Your browser can't show the PDF here — ";
      const a = document.createElement("a");
      a.href = String(cs.reportPdf);
      a.textContent = "download the full report (PDF)";
      fallback.appendChild(a);
      fallback.appendChild(document.createTextNode("."));
      obj.appendChild(fallback);
      pdfview.appendChild(obj);
    } else {
      pdfview.remove();
    }
  }
  if (cs.reportPdf) {
    const body = slot("outcome");
    if (body) {
      const p = document.createElement("p");
      p.className = "cs-pdf";
      const a = document.createElement("a");
      a.className = "btn btn-go btn-sm";
      a.href = String(cs.reportPdf);
      a.textContent = "Download the full report (PDF)";
      p.appendChild(a);
      body.after(p);
    }
  }

  section.hidden = false;
  document.querySelectorAll("[data-case-link]").forEach((a) => { a.hidden = false; });
})();
