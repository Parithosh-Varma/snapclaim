// Gallery lightbox + scroll reveal. Respects reduced motion by doing nothing fancy.
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

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!reduce && "IntersectionObserver" in window) {
  const sections = document.querySelectorAll("section.exhibit");
  sections.forEach((s) => s.classList.add("reveal"));
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    }),
    { threshold: 0.08 }
  );
  sections.forEach((s) => io.observe(s));
}
