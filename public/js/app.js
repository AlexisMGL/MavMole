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

  function parseRelayControl(data) {
    if (typeof data !== "string") {
      return null;
    }

    try {
      const message = JSON.parse(data);
      return typeof message?.type === "string" ? message : null;
    } catch (_error) {
      return null;
    }
  }

  function validateTunnelConfig(config, role) {
    const stream = String(config.stream || "").trim().replace(/\s+/g, " ");
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u.test(stream)) {
      throw new Error("Stream name must contain 1 to 48 letters, numbers, spaces, dots, dashes or underscores.");
    }
    const password = String(config.password || "");
    const creatingPrivate = role === "mole" && config.mode !== "join" && config.private;
    if (creatingPrivate && (password.length < 4 || password.length > 128)) {
      throw new Error("Private tunnel passwords must contain 4 to 128 characters.");
    }
    return {
      stream,
      password,
      private: role === "mole" && config.mode !== "join" && config.private === true,
      mode: role === "digger" || config.mode === "join" ? "join" : "create",
    };
  }

  function authenticateTunnel(socket, config, role) {
    const normalized = validateTunnelConfig(config, role);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Tunnel authentication timed out."));
      }, 10000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
      };
      const onMessage = (event) => {
        const message = parseRelayControl(event.data);
        if (message?.type === "tunnel.joined") {
          cleanup();
          resolve(message);
        } else if (message?.type === "tunnel.error") {
          cleanup();
          reject(new Error(message.message || "Unable to join the tunnel."));
        }
      };
      const onClose = (event) => {
        cleanup();
        reject(new Error(event.reason || "The relay closed during tunnel authentication."));
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose, { once: true });
      socket.send(JSON.stringify({
        type: "tunnel.join",
        stream: normalized.stream,
        password: normalized.password,
        private: normalized.private,
        mode: normalized.mode,
      }));
    });
  }

  function unpackRelayFrame(data) {
    const bytes = new Uint8Array(data);
    const hasEnvelope =
      bytes.byteLength >= 8 &&
      bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x01;
    if (!hasEnvelope) {
      return { sourceId: 0, payload: data };
    }
    const sourceId = new DataView(data).getUint32(4, false);
    return {
      sourceId,
      payload: data.slice(8),
    };
  }

  function renderViewerCount(element, count) {
    const viewers = Math.max(0, Number.parseInt(count, 10) || 0);
    element.textContent = `${viewers} viewer${viewers === 1 ? "" : "s"}`;
  }

  function renderStreamCount(element, count) {
    const streams = Math.max(0, Number.parseInt(count, 10) || 0);
    element.textContent = streams + " stream" + (streams === 1 ? "" : "s");
  }

  function renderMoleCount(element, count) {
    const moles = Math.max(0, Number.parseInt(count, 10) || 0);
    element.textContent = moles + " active Mole" + (moles === 1 ? "" : "s");
  }

  function showMoleNotice(container, message) {
    if (!container || !message?.sourceId) {
      return;
    }
    const notice = document.createElement("div");
    notice.className = "mole-notice";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const close = document.createElement("button");
    title.textContent = "New Mole sharing MAVLink";
    detail.textContent = (message.label || "A Mole") + " joined " + (message.stream || "this stream") + ".";
    close.type = "button";
    close.className = "mole-notice-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    copy.append(title, detail);
    notice.append(copy, close);
    container.appendChild(notice);

    let removed = false;
    const remove = () => {
      if (removed) {
        return;
      }
      removed = true;
      notice.classList.add("is-leaving");
      window.setTimeout(() => notice.remove(), 350);
    };
    close.addEventListener("click", remove);
    window.setTimeout(remove, 5000);
  }

  async function loadServiceStats() {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Service statistics are unavailable.");
    }
    return response.json();
  }

  async function loadPublicStreams() {
    const response = await fetch("/api/streams", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Public stream list is unavailable.");
    }
    const payload = await response.json();
    return Array.isArray(payload.streams) ? payload.streams : [];
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
    parseRelayControl,
    validateTunnelConfig,
    authenticateTunnel,
    unpackRelayFrame,
    renderViewerCount,
    renderStreamCount,
    renderMoleCount,
    showMoleNotice,
    loadServiceStats,
    loadPublicStreams,
    waitForOpen,
    StreamStats,
  };
})(window);
