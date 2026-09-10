(function runHomePage() {
  "use strict";

  const streams = document.querySelector("#home-stream-count");
  const viewers = document.querySelector("#home-viewer-count");
  let latestStats = null;

  function render() {
    if (!latestStats) return;
    const format = window.MavMoleI18n?.number || ((value) => value.toLocaleString());
    streams.textContent = format(Number(latestStats.streams || 0));
    viewers.textContent = format(Number(latestStats.viewers || 0));
  }

  async function refresh() {
    try {
      const stats = await window.MavMoleUi.loadServiceStats();
      latestStats = stats;
      render();
    } catch (_error) {
      streams.textContent = "—";
      viewers.textContent = "—";
    }
  }

  window.addEventListener("mavmole:languagechange", render);
  refresh();
  window.setInterval(refresh, 10000);
})();
