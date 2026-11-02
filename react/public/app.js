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

// Case study: shows only the report PDF. Title + PDF path come from
// assets/case-study/case-study.json; the section and its nav links stay
// hidden until the JSON sets published:true. Strings in as text, never HTML.
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
  const pdfview = slot("pdfview");
  if (pdfview) {
    pdfview.textContent = "";
    if (cs.reportPdf) {
      const obj = document.createElement("object");
      obj.className = "cs-pdfview";
      obj.data = String(cs.reportPdf);
      obj.type = "application/pdf";
      obj.setAttribute("aria-label", "Case study report PDF");
      const fallback = document.createElement("p");
      fallback.textContent = "Your browser can\u2019t show the PDF here \u2014 ";
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

  section.hidden = false;
  document.querySelectorAll("[data-case-link]").forEach((a) => { a.hidden = false; });
})();
