/* SnapClaim ui.js — presentational enhancements only.
 * No backend calls, no storage schema changes, no app.js logic touched.
 * Runs before app.js (classic script); everything hooks via DOM observers. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- theme ---------- */
  var THEME_KEY = "sc_theme";
  function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; }
    catch (e) { return "auto"; }
  }
  function applyTheme(t) {
    var v = t === "light" || t === "dark" ? t : "auto";
    document.documentElement.setAttribute("data-theme", v);
    ["light", "auto", "dark"].forEach(function (k) {
      var b = $("sc-theme-" + k);
      if (b) b.setAttribute("aria-pressed", String(k === v));
    });
    try { localStorage.setItem(THEME_KEY, v); } catch (e) {}
  }
  ["light", "auto", "dark"].forEach(function (k) {
    var b = $("sc-theme-" + k);
    if (b) b.addEventListener("click", function () { applyTheme(k); });
  });
  applyTheme(currentTheme());

  /* ---------- live announcements + focus + stepper ---------- */
  var STEPS = [
    ["sReview", "Capture"], ["sMark", "Mark"], ["sSay", "Say"],
    ["sNum", "Numbers"], ["sCheck", "Checked"],
  ];
  var STEP_INDEX = { sReview: 1, sMark: 2, sSay: 3, sNum: 4, sCheck: 5, sReport: 6 };
  var live = $("appLive");
  function announce(msg) { if (live) live.textContent = msg; }
  function paintSteppers(activeId) {
    var idx = STEP_INDEX[activeId] || 0;
    document.querySelectorAll("ol[data-stepper]").forEach(function (ol) {
      if (!ol.children.length) {
        STEPS.forEach(function (s, i) {
          var li = document.createElement("li");
          var dot = document.createElement("span");
          dot.className = "stepdot"; dot.textContent = String(i + 1); dot.setAttribute("aria-hidden", "true");
          var lab = document.createElement("span"); lab.textContent = s[1];
          li.appendChild(dot); li.appendChild(lab); ol.appendChild(li);
        });
      }
      Array.prototype.forEach.call(ol.children, function (li, i) {
        var n = i + 1;
        li.classList.toggle("done", n < idx || idx === 6);
        if (n === idx) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      });
    });
  }
  var booted = false;
  function currentScreen() {
    var on = document.querySelector(".screen.on");
    return on ? on.id : (document.body.classList.contains("tabbing") ? "tabs" : null);
  }
  var lastScreen = null;
  function onScreenChange() {
    var id = currentScreen();
    if (id === lastScreen) return;
    lastScreen = id;
    paintSteppers(id);
    if (!id || id === "tabs") return;
    var h = document.querySelector("#" + id + " h1");
    var label = h ? h.textContent : id;
    var step = STEP_INDEX[id];
    if (booted && document.hasFocus()) {
      if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) {} }
      announce(step ? ("Step " + step + " of 5: " + label) : label);
    }
  }
  new MutationObserver(onScreenChange).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.querySelectorAll(".screen").forEach(function (s) {
    new MutationObserver(onScreenChange).observe(s, { attributes: true, attributeFilter: ["class"] });
  });
  window.addEventListener("load", function () {
    setTimeout(function () { booted = true; onScreenChange(); }, 400);
  });

  /* ---------- offline banner ---------- */
  var banner = $("offlineBanner");
  function updateOffline() { if (banner) banner.hidden = navigator.onLine; }
  window.addEventListener("online", updateOffline);
  window.addEventListener("offline", updateOffline);
  updateOffline();

  /* ---------- first-run onboarding ---------- */
  try {
    if (!localStorage.getItem("sc_onboard_seen")) {
      var ob = $("onboard");
      var hint = $("sc-ob-install");
      var isiOS = /iPhone|iPad|iPod/.test(navigator.userAgent || "");
      var standalone = (window.navigator && window.navigator.standalone) || window.matchMedia("(display-mode: standalone)").matches;
      if (hint && !standalone) {
        hint.textContent = isiOS
          ? "iPhone: Share, then Add to Home Screen to install."
          : "Tip: browser menu, then Add to Home screen to install.";
      }
      if (ob) {
        ob.hidden = false;
        var close = $("sc-ob-close");
        if (close) {
          close.addEventListener("click", function () {
            ob.hidden = true;
            try { localStorage.setItem("sc_onboard_seen", "1"); } catch (e) {}
            close.blur();
          });
          setTimeout(function () { try { close.focus({ preventScroll: true }); } catch (e) {} }, 100);
        }
      }
    }
  } catch (e) {}

  /* ---------- haptics ---------- */
  function buzz(ms) {
    if (REDUCED) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  ["shutter", "usePhoto", "measureBtn", "sendBtn", "renderBtn"].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener("click", function () { buzz(10); });
  });

  /* ---------- skeleton shimmer for async surfaces ---------- */
  var style = document.createElement("style");
  style.textContent = ".sc-shimmer{border-radius:var(--r-md);min-height:120px;margin-top:12px;" +
    "background:linear-gradient(100deg,transparent 20%,var(--surface-2) 50%,transparent 80%);background-size:200% 100%;" +
    "animation:sc-shimmer 1.2s linear infinite}@keyframes sc-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}";
  document.head.appendChild(style);
  function skeletonize(btnId, targetId) {
    var btn = $(btnId), target = $(targetId);
    if (!btn || !target) return;
    btn.addEventListener("click", function () {
      if (target.children.length) return;
      var ph = document.createElement("div");
      ph.className = "sc-shimmer"; ph.setAttribute("aria-hidden", "true");
      target.appendChild(ph);
      btn.setAttribute("aria-busy", "true");
      setTimeout(function () {
        if (ph.parentNode === target) target.removeChild(ph);
        btn.removeAttribute("aria-busy");
      }, 25000);
    });
    new MutationObserver(function () {
      btn.removeAttribute("aria-busy");
      Array.prototype.forEach.call(target.querySelectorAll(".sc-shimmer"), function (n) {
        if (target.children.length > 1 && n.parentNode === target) target.removeChild(n);
      });
    }).observe(target, { childList: true });
  }
  skeletonize("measureBtn", "measured");
  skeletonize("sendBtn", "findings");
  skeletonize("renderBtn", "annex");
  skeletonize("skepticBtn", "skOut");
  /* ---------- thumbnails in case lists (pair rows with CaseStore order) ---------- */
  function enhanceLists() {
    if (!window.CaseStore) return;
    window.CaseStore.list().then(function (cases) {
      [["recentList", 0], ["caseList", 0]].forEach(function (pair) {
        var ul = $(pair[0]);
        if (!ul) return;
        var rows = ul.querySelectorAll(":scope > li");
        var list = pair[0] === "recentList" ? cases.slice(0, 3) : cases;
        Array.prototype.forEach.call(rows, function (li, i) {
          var btn = li.querySelector("button");
          var c = list[i];
          if (!btn || !c || btn.querySelector("[data-sc-thumb]")) return;
          var url = c.photos && c.photos[0] && c.photos[0].url;
          if (!url) return;
          var img = document.createElement("img");
          img.className = "case-thumb"; img.src = url; img.alt = "";
          img.setAttribute("aria-hidden", "true"); img.setAttribute("data-sc-thumb", "1");
          img.loading = "lazy";
          btn.insertBefore(img, btn.firstChild);
          img.addEventListener("error", function () { img.remove(); });
        });
      });
    }).catch(function () {});
  }
  ["recentList", "caseList"].forEach(function (id) {
    var ul = $(id);
    if (ul) new MutationObserver(enhanceLists).observe(ul, { childList: true });
  });
  enhanceLists();

  /* ---------- mark canvas: inspect mode + zoom (tap mapping unaffected) ---------- */
  var canvas = $("markCanvas");
  var inspectBtn = $("sc-inspect");
  var zoom = { z: 1, tx: 0, ty: 0, inspect: false };
  function applyZoom() {
    if (!canvas) return;
    if (zoom.z <= 1) { zoom.z = 1; zoom.tx = 0; zoom.ty = 0; }
    canvas.style.transform = "translate(" + zoom.tx + "px," + zoom.ty + "px) scale(" + zoom.z + ")";
  }
  function setZoom(z) {
    zoom.z = Math.max(1, Math.min(4, z));
    applyZoom();
  }
  var zin = $("sc-zoom-in"), zout = $("sc-zoom-out");
  if (zin) zin.addEventListener("click", function () { setZoom(zoom.z * 1.25); });
  if (zout) zout.addEventListener("click", function () { setZoom(zoom.z / 1.25); });
  if (canvas) {
    canvas.addEventListener("dblclick", function () { setZoom(zoom.z > 1 ? 1 : 2); });
    canvas.addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom.z * (e.deltaY < 0 ? 1.12 : 0.9));
    }, { passive: false });
  }
  if (inspectBtn && canvas) {
    var stage = canvas.parentElement;
    var pointers = new Map();
    var pinchD0 = 0, panLast = null;
    inspectBtn.addEventListener("click", function () {
      zoom.inspect = !zoom.inspect;
      inspectBtn.setAttribute("aria-pressed", String(zoom.inspect));
      if (!zoom.inspect) setZoom(1);
    });
    stage.addEventListener("pointerdown", function (e) {
      if (!zoom.inspect) return;
      e.stopPropagation(); e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        pinchD0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        panLast = null;
      } else { panLast = { x: e.clientX, y: e.clientY }; }
    }, true);
    stage.addEventListener("pointermove", function (e) {
      if (!zoom.inspect || !pointers.has(e.pointerId)) return;
      e.stopPropagation(); e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        if (pinchD0 > 0) setZoom(zoom.z * (d / pinchD0));
        pinchD0 = d;
      } else if (panLast) {
        zoom.tx += e.clientX - panLast.x; zoom.ty += e.clientY - panLast.y;
        panLast = { x: e.clientX, y: e.clientY };
        applyZoom();
      }
    }, true);
    ["pointerup", "pointercancel"].forEach(function (t) {
      stage.addEventListener(t, function (e) {
        pointers.delete(e.pointerId); pinchD0 = 0; panLast = null;
      }, true);
    });
  }

  /* ---------- storage meter ---------- */
  function updateMeter() {
    var meter = $("sc-store-meter");
    if (!meter || !navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (est) {
      if (est && est.quota) meter.style.width = Math.min(100, Math.round((est.usage / est.quota) * 100)) + "%";
    }).catch(function () {});
  }
  var tSettings = $("tSettings");
  if (tSettings) new MutationObserver(function () {
    if (tSettings.classList.contains("on")) updateMeter();
  }).observe(tSettings, { attributes: true, attributeFilter: ["class"] });
  updateMeter();

  /* ---------- coin label mirror ---------- */
  var coinKind = $("coinKind"), coinLabel = $("sc-coin-label");
  if (coinKind && coinLabel) {
    coinKind.addEventListener("change", function () {
      var opt = coinKind.options[coinKind.selectedIndex];
      coinLabel.textContent = "Using " + (opt ? opt.text : coinKind.value + " mm");
    });
  }
  /* ---------- bottom-sheet dialog: tap backdrop to close ---------- */
  var dlg = $("caseDlg");
  if (dlg) {
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
  }

  /* ---------- primary findings mirror on the Checked screen ---------- */
  var findings = $("findings"), primary = $("sc-primary");
  function mirrorPrimary() {
    if (!findings || !primary) return;
    if (findings.children.length) primary.innerHTML = findings.innerHTML;
  }
  if (findings && primary) {
    new MutationObserver(mirrorPrimary).observe(findings, { childList: true, subtree: true });
    var sCheck = $("sCheck");
    if (sCheck) new MutationObserver(function () {
      if (sCheck.classList.contains("on")) mirrorPrimary();
    }).observe(sCheck, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------- mask overlay toggle (Mark toolbar + Numbers) ---------- */
  var maskBtn = $("sc-mask-toggle"), maskBtnNum = $("sc-mask-toggle-num");
  var numPhoto = $("sc-num-photo"), numFigure = $("sc-num-figure");
  function copyMarkedPhoto() {
    var src = $("markCanvas");
    if (!src || !numPhoto || !numFigure) return;
    var hasMark = src.width > 300 || src.height > 150;
    numFigure.hidden = !hasMark;
    if (maskBtnNum) maskBtnNum.style.display = hasMark ? "" : "none";
    if (!hasMark) return;
    numPhoto.width = src.width; numPhoto.height = src.height;
    try { numPhoto.getContext("2d").drawImage(src, 0, 0); }
    catch (e) { numFigure.hidden = true; }
  }
  function setOverlay(on) {
    if (maskBtn) maskBtn.setAttribute("aria-pressed", String(on));
    var numBadge = $("numBadge");
    if (numBadge && !on) numBadge.hidden = true;
    if (maskBtnNum) {
      maskBtnNum.setAttribute("aria-pressed", String(on));
      maskBtnNum.textContent = on ? "Hide mask overlay" : "Show mask overlay";
    }
    try { if (window.__snapclaimOverlay) window.__snapclaimOverlay(on); } catch (e) {}
    copyMarkedPhoto();
    try { if (on && window.updateNumBadge) window.updateNumBadge(); } catch (e) {}
  }
  if (maskBtn) maskBtn.addEventListener("click", function () {
    setOverlay(maskBtn.getAttribute("aria-pressed") !== "true");
  });
  if (maskBtnNum) maskBtnNum.addEventListener("click", function () {
    setOverlay(maskBtnNum.getAttribute("aria-pressed") !== "true");
  });
  var sNum = $("sNum");
  if (sNum) new MutationObserver(function () {
    if (sNum.classList.contains("on")) copyMarkedPhoto();
  }).observe(sNum, { attributes: true, attributeFilter: ["class"] });

  /* ---------- deep links (?capture=1, ?tab=cases|settings) ---------- */
  window.addEventListener("load", function () {
    setTimeout(function () {
      try {
        var q = new URLSearchParams(window.location.search);
        if (q.get("capture") === "1") {
          var b = document.querySelector('#tabs button[data-tab="capture"]');
          if (b) b.click();
        } else if (q.get("tab")) {
          var t = document.querySelector('#tabs button[data-tab="' + q.get("tab") + '"]');
          if (t) t.click();
        }
      } catch (e) {}
    }, 600);
  });
})();
