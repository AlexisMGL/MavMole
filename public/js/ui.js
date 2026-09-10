(function enhanceInterface() {
  "use strict";
  // Content remains visible without JavaScript, and motion follows the OS setting.
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!preference.matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.06 });
    document.querySelectorAll(".roles-section, .service-facts, .flight-dashboard, .fleet-overview, .viewer-panel, .raw-diagnostics").forEach((element) => {
      element.classList.add("reveal-on-scroll");
      observer.observe(element);
    });
    preference.addEventListener("change", () => {
      if (preference.matches) {
        observer.disconnect();
        document.querySelectorAll(".reveal-on-scroll").forEach((element) => element.classList.add("is-revealed"));
      }
    });
  }
})();
