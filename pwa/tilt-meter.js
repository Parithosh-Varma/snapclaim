// Live "hold flatter" level for the capture step.
// The coin's ellipse corrects a tilted photo afterwards (#12); this helps the
// user avoid needing it. Past 60° the coin is refused, so the meter says so
// before the photo is taken. Phone sensors only: nothing leaves the device.

export const TILT_WARN_DEG = 30;
export const TILT_REFUSE_DEG = 60;

const DEG = Math.PI / 180;

/**
 * How far the camera is from facing the surface square on, in degrees.
 * The back camera looks along the phone's -z axis; its angle from vertical is
 * acos(|cos β · cos γ|). A floor or ceiling is square at 0°, a wall at 90°.
 * Turning sideways along a wall (yaw) is invisible to gravity, so it reads 0.
 */
export function tiltFromOrientation(beta, gamma, surface = "wall") {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const c = Math.min(1, Math.abs(Math.cos(beta * DEG) * Math.cos(gamma * DEG)));
  const fromVertical = Math.acos(c) / DEG;
  return surface === "floor" ? fromVertical : 90 - fromVertical;
}

/** "ok" up to 30°, "flatter" up to 60°, "refuse" past that (the coin check's limit). */
export function tiltZone(deg) {
  if (deg === null) return "unknown";
  if (deg > TILT_REFUSE_DEG) return "refuse";
  if (deg > TILT_WARN_DEG) return "flatter";
  return "ok";
}

export function tiltMessage(deg, surface = "wall") {
  const zone = tiltZone(deg);
  const target = surface === "floor" ? "the floor" : "the wall";
  if (zone === "ok") return `Square to ${target}. Good to shoot.`;
  if (zone === "flatter") return `Tilted ${Math.round(deg)}°. Hold the phone flatter to ${target}.`;
  if (zone === "refuse") return `Tilted ${Math.round(deg)}°: too steep, the coin will be refused. Face ${target} straight on.`;
  return "";
}

const COLORS = { ok: "#1f7a4d", flatter: "#a86a00", refuse: "#b3261e", unknown: "#5b6b61" };

/**
 * Shows the level inside `el`. Stays hidden on devices without orientation
 * sensors (desktops). On iOS the sensors need a tap first, so a button asks.
 * Returns a function that stops listening.
 */
export function mountTiltMeter(el, { win = globalThis, surface = "wall" } = {}) {
  const Orientation = win.DeviceOrientationEvent;
  if (!el || !Orientation || typeof win.addEventListener !== "function") return () => {};

  el.innerHTML = `
    <div style="display:none;align-items:center;gap:10px;margin:0 0 12px">
      <svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden="true">
        <circle r="18" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/>
        <circle r="${(18 * TILT_WARN_DEG) / 90}" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 2"/>
        <circle data-bubble r="5"/>
      </svg>
      <span data-text role="status" style="font-size:13px"></span>
      <span style="margin-left:auto;display:flex;gap:4px">
        <button type="button" data-surface="wall" style="min-height:32px;padding:4px 8px;font-size:12px">Wall</button>
        <button type="button" data-surface="floor" style="min-height:32px;padding:4px 8px;font-size:12px">Floor</button>
      </span>
    </div>
    <button type="button" data-ask hidden style="margin:0 0 12px;font-size:13px">Show the tilt level</button>`;
  const bubble = el.querySelector("[data-bubble]");
  const text = el.querySelector("[data-text]");
  const ask = el.querySelector("[data-ask]");
  const row = el.firstElementChild;
  const surfaceButtons = [...el.querySelectorAll("[data-surface]")];

  let smooth = null;
  let frame = 0;
  const paintSurface = () => surfaceButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.surface === surface)));
  surfaceButtons.forEach((b) => (b.onclick = () => { surface = b.dataset.surface; paintSurface(); render(); }));
  paintSurface();

  function render() {
    frame = 0;
    if (smooth === null) return;
    const deg = tiltFromOrientation(smooth.beta, smooth.gamma, surface);
    if (deg === null) return;
    const zone = tiltZone(deg);
    const r = (18 * Math.min(deg, 90)) / 90;
    // the bubble drifts toward the low side, like a spirit level
    const angle = Math.atan2(smooth.beta - (surface === "floor" ? 0 : 90), smooth.gamma);
    bubble.setAttribute("cx", String(r * Math.cos(angle)));
    bubble.setAttribute("cy", String(r * Math.sin(angle)));
    bubble.setAttribute("fill", COLORS[zone]);
    text.style.color = COLORS[zone];
    text.textContent = tiltMessage(deg, surface);
    row.style.display = "flex";
  }

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    // light smoothing so hand shake doesn't flicker the message
    smooth = smooth === null ? { beta: e.beta, gamma: e.gamma } : { beta: smooth.beta * 0.8 + e.beta * 0.2, gamma: smooth.gamma * 0.8 + e.gamma * 0.2 };
    if (!frame) frame = (win.requestAnimationFrame ?? ((f) => setTimeout(f, 16)))(render);
  }

  const listen = () => win.addEventListener("deviceorientation", onOrientation);
  if (typeof Orientation.requestPermission === "function") {
    // iOS: permission can only be asked from a tap. Desktop browsers expose the
    // same call without a sensor behind it, so only offer it on touch screens.
    if (!win.matchMedia?.("(pointer: coarse)").matches) return () => {};
    ask.hidden = false;
    ask.onclick = async () => {
      try {
        if ((await Orientation.requestPermission()) === "granted") { ask.hidden = true; listen(); }
        else ask.textContent = "Motion access was denied. The level stays off.";
      } catch {
        ask.textContent = "The tilt level is not available here.";
      }
    };
  } else {
    listen();
  }
  return () => win.removeEventListener("deviceorientation", onOrientation);
}
