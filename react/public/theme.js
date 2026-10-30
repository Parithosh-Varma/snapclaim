// Applies the saved theme before first paint: localStorage settings ->
// data-theme on <html> ("light" | "auto" | "dark", default "auto").
// Classic script in <head>; app.js owns the Settings buttons that change it.
(function () {
  var theme = "auto";
  try {
    var s = JSON.parse(localStorage.getItem("snapclaim.settings.v1") || "{}");
    if (s && (s.theme === "light" || s.theme === "dark" || s.theme === "auto")) theme = s.theme;
  } catch (e) { /* no storage: auto */ }
  document.documentElement.dataset.theme = theme;
})();
