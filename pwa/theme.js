/* Theme bootstrap: apply saved theme before first paint (no FOUC).
 * External file (not inline) so the CSP needs no hash or 'unsafe-inline'. */
try {
  var t = localStorage.getItem("sc_theme") || "auto";
  document.documentElement.setAttribute("data-theme", t === "light" || "dark" ? t : "auto");
} catch (e) { document.documentElement.setAttribute("data-theme", "auto"); }
