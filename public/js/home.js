(function runHomePage() {
  "use strict";

  const streams = document.querySelector("#home-stream-count");
  const viewers = document.querySelector("#home-viewer-count");

  async function refresh() {
    try {
      const stats = await window.MavMoleUi.loadServiceStats();
      streams.textContent = Number(stats.streams || 0).toLocaleString();
      viewers.textContent = Number(stats.viewers || 0).toLocaleString();
    } catch (_error) {
      streams.textContent = "—";
      viewers.textContent = "—";
    }
  }

  refresh();
  window.setInterval(refresh, 10000);
})();
