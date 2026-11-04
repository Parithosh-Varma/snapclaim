// Gallery lightbox: click a tile to enlarge, click anywhere or Esc to close.
const grid = document.getElementById("photo-grid");
const box = document.getElementById("lightbox");
const img = document.getElementById("lightbox-img");

grid.addEventListener("click", (e) => {
  const tile = e.target.closest(".tile");
  if (!tile) return;
  img.src = tile.dataset.full;
  img.alt = tile.querySelector("img").alt;
  box.hidden = false;
});

box.addEventListener("click", () => {
  box.hidden = true;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") box.hidden = true;
});
