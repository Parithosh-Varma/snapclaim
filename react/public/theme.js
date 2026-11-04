// Applies the saved theme before first paint: localStorage settings ->
// data-theme on <html> ("light" | "auto" | "dark", default "auto"), and keeps
// the browser chrome (meta theme-color) on the colour actually being shown.
// Classic script in <head>; app.js owns the Settings buttons that change it.
(function () {
  var CHROME = { light: "#E9EEF4", dark: "#141310" };
  var theme = "auto";
  try {
    var s = JSON.parse(localStorage.getItem("snapclaim.settings.v1") || "{}");
    if (s && (s.theme === "light" || s.theme === "dark" || s.theme === "auto")) theme = s.theme;
  } catch (e) { /* no storage: auto */ }

  var root = document.documentElement;
  root.dataset.theme = theme;

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var meta = document.querySelector('meta[name="theme-color"]');
  function paint() {
    var dark = theme === "dark" || (theme === "auto" && !!(mq && mq.matches));
    if (meta) meta.setAttribute("content", dark ? CHROME.dark : CHROME.light);
  }
  paint();

  // Settings flips data-theme in place (no reload), and "auto" must follow the
  // OS while the app is open; repaint the chrome for both.
  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (root.dataset.theme) theme = root.dataset.theme;
      paint();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener("change", paint);
    else if (mq.addListener) mq.addListener(paint); // Safari < 14
  }
})();
