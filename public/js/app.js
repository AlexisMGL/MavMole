(function createMavMoleUi(global) {
  "use strict";

  function formatBytes(value) {
    if (value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KiB`;
    }

    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }

  function relayWebSocketUrl(role) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws?role=${encodeURIComponent(role)}`;
  }

  function setStatus(element, text, state = "idle") {
    element.textContent = text;
    element.dataset.state = state;
  }

  function waitForOpen(socket, label) {
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`${label} connection failed.`));
      };
      const onClose = (event) => {
        cleanup();
        reject(new Error(`${label} closed before connecting (code ${event.code}).`));
      };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
    });
  }

  class StreamStats {
    constructor(elements) {
      this.elements = elements;
      this.frames = 0;
      this.bytes = 0;
      this.dropped = 0;
      this.sampleBytes = 0;
      this.sampleTime = performance.now();
      this.timer = window.setInterval(() => this.renderRate(), 1000);
      this.render();
    }

    record(byteLength) {
      this.frames += 1;
      this.bytes += byteLength;
      this.render();
    }

    drop() {
      this.dropped += 1;
      this.render();
    }

    reset() {
      this.frames = 0;
      this.bytes = 0;
      this.dropped = 0;
      this.sampleBytes = 0;
      this.sampleTime = performance.now();
      this.render();
      this.renderRate();
    }

    render() {
      this.elements.frames.textContent = this.frames.toLocaleString();
      this.elements.bytes.textContent = formatBytes(this.bytes);

      if (this.elements.dropped) {
        this.elements.dropped.textContent = this.dropped.toLocaleString();
      }
    }

    renderRate() {
      const now = performance.now();
      const elapsedSeconds = (now - this.sampleTime) / 1000;
      const bytesSinceSample = this.bytes - this.sampleBytes;
      const bytesPerSecond = elapsedSeconds > 0 ? bytesSinceSample / elapsedSeconds : 0;

      this.elements.rate.textContent = `${formatBytes(Math.round(bytesPerSecond))}/s`;
      this.sampleBytes = this.bytes;
      this.sampleTime = now;
    }
  }

  global.MavMoleUi = {
    formatBytes,
    relayWebSocketUrl,
    setStatus,
    waitForOpen,
    StreamStats,
  };
})(window);
