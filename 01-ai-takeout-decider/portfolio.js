const progressBar = document.querySelector("#readingProgress");
const navLinks = [...document.querySelectorAll(".case-nav a")];
const trackedSections = [...document.querySelectorAll("[data-section]")];

function updateReadingProgress() {
  if (!progressBar) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
  progressBar.style.width = `${Math.round(progress * 100)}%`;
}

const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

  if (!visible) return;
  const sectionId = visible.target.id;
  navLinks.forEach((link) => {
    const isCurrent = link.getAttribute("href") === `#${sectionId}`;
    if (isCurrent) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}, {
  rootMargin: "-20% 0px -65% 0px",
  threshold: [0, 0.15, 0.5]
});

trackedSections.forEach((section) => sectionObserver.observe(section));
window.addEventListener("scroll", updateReadingProgress, { passive: true });
window.addEventListener("resize", updateReadingProgress);
updateReadingProgress();
