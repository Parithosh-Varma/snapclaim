// Shared motion helpers. Every video draws one pure frame(t) from time alone,
// so any frame can be rendered in any order.
(function () {
  var K = {};
  K.cl = function (x, a, b) { a = a == null ? 0 : a; b = b == null ? 1 : b; return Math.max(a, Math.min(b, x)); };
  K.lerp = function (a, b, p) { return a + (b - a) * p; };
  // Progress of a segment that starts at `a` and lasts `d` seconds, 0..1, linear.
  K.p = function (t, a, d) { return K.cl((t - a) / d); };
  K.outCubic = function (x) { return 1 - Math.pow(1 - x, 3); };
  K.outQuint = function (x) { return 1 - Math.pow(1 - x, 5); };
  K.inOut = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  K.outBack = function (x) { var c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  // Closed-form damped spring, 0 -> 1 with a little overshoot.
  K.spring = function (x, k, z) {
    if (x <= 0) return 0;
    k = k || 14; z = z || 0.42;
    return 1 - Math.exp(-z * k * x) * Math.cos(k * Math.sqrt(1 - z * z) * x);
  };
  K.ex = function (t, a, d) { return K.outQuint(K.p(t, a, d)); };
  K.sp = function (t, a, d, k, z) { return K.spring((t - a) / d, k, z); };
  // Fade in at a, hold, fade out ending at b.
  K.io = function (t, a, b, f) { f = f || 0.25; return Math.min(K.ex(t, a, f), 1 - K.p(t, b - f, f)); };
  K.$ = function (id) { return document.getElementById(id); };
  K.css = function (id, props) { var s = K.$(id).style; for (var k in props) s[k] = props[k]; };
  K.op = function (id, v) { K.$(id).style.opacity = v; };
  K.fmt = function (n) { return Math.round(n).toLocaleString("en-US"); };
  // Register the composition with HyperFrames: one paused GSAP timeline that
  // drives frame(t) for the full duration.
  K.mount = function (duration, frame) {
    var tl = gsap.timeline({ paused: true });
    var proxy = { t: 0 };
    tl.to(proxy, { t: duration, duration: duration, ease: "none", onUpdate: function () { frame(proxy.t); } }, 0);
    window.__timelines = window.__timelines || {};
    window.__timelines["root"] = tl;
    frame(0);
  };
  window.K = K;
})();
