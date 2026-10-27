// Balloon readout: hovering or focusing a receipt balloon shows its calculation in the title block.
const RECEIPTS = {
  R001: ["scale_calibration", "27 mm ÷ 287 px = ", "0.094077 mm/px"],
  R002: ["area_ratio", "24,800 px ÷ 480,000 px × 100 = ", "5.17 %"],
  R003: ["region_count", "disconnected mask components = ", "1"],
  R004: ["calibrated_length", "913 px × 0.094077 mm/px = ", "85.9 mm"],
  R005: ["severity_classification", "5.17 % > 5 % moderate ceiling → ", "significant"],
  R006: ["area_ratio", "6,200 px ÷ 480,000 px × 100 = ", "1.29 %"],
  R007: ["region_count", "disconnected mask components = ", "2"],
  R008: ["severity_classification", "1 % < 1.29 % ≤ 5 % → ", "moderate"],
};

const readout = document.getElementById("readout");
const balloons = document.querySelectorAll(".balloons .b");

function show(id) {
  const r = RECEIPTS[id];
  if (!r || !readout) return;
  readout.querySelector(".ro-id").textContent = id;
  readout.querySelector(".ro-method").textContent = r[0];
  const calc = readout.querySelector(".ro-calc");
  calc.textContent = r[1];
  const out = document.createElement("b");
  out.textContent = r[2];
  calc.append(out);
  readout.classList.toggle("is-scale", id === "R001");
  balloons.forEach((b) => b.classList.toggle("is-on", b.dataset.r === id));
}

balloons.forEach((b, i) => {
  b.style.setProperty("--i", String(i));
  b.addEventListener("mouseenter", () => show(b.dataset.r));
  b.addEventListener("focus", () => show(b.dataset.r));
});

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
