// mg.js — deterministic motion helpers for SnapClaim scenes. Pure functions
// of t only. No clocks, no random (use rand with an explicit seed).
(function () {
  var mg = {};
  mg.clamp = function (x, a, b) { if (a === undefined) a = 0; if (b === undefined) b = 1; return Math.max(a, Math.min(b, x)); };
  mg.lerp = function (a, b, p) { return a + (b - a) * p; };
  mg.ease = {
    outCubic: function (x) { return 1 - Math.pow(1 - x, 3); },
    inOutCubic: function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
    outBack: function (x) { var c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
    outExpo: function (x) { return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); }
  };
  mg.tween = function (t, t0, t1, from, to, easeFn) {
    var p = mg.clamp((t - t0) / Math.max(t1 - t0, 1e-6));
    return mg.lerp(from, to, (easeFn || mg.ease.outCubic)(p));
  };
  mg.seg = function (t, t0, t1) { return mg.clamp((t - t0) / Math.max(t1 - t0, 1e-6)); };
  mg.stagger = function (i, step) { return i * step; };
  mg.rand = function (seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  mg.fmt = function (n, d) { return Number(n).toFixed(d === undefined ? 1 : d); };
  mg.svg = function (el, attrs) { for (var k in attrs) el.setAttribute(k, attrs[k]); return el; };
  window.mg = mg;
})();
