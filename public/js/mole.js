(function runMolePage() {
  "use strict";

  const log = window.MavMoleLog.scope("Mole");
  const ui = window.MavMoleUi;
  const form = document.querySelector("#mole-form");
  const localUrlInput = document.querySelector("#local-url");
  const connectLocalButton = document.querySelector("#connect-local-button");
  const disconnectLocalButton = document.querySelector("#disconnect-local-button");
  const startForwardingButton = document.querySelector("#start-forwarding-button");
  const stopForwardingButton = document.querySelector("#stop-forwarding-button");
  const localStatus = document.querySelector("#local-status");
  const relayStatus = document.querySelector("#relay-status");
  const forwardingStatus = document.querySelector("#forwarding-status");
  const viewerCount = document.querySelector("#viewer-count");
  const forwardedCount = document.querySelector("#forwarded-count");
  const parser = new window.MavMoleTelemetry.MavlinkStreamParser();
  const decoder = new window.MavMoleTelemetry.TelemetryDecoder();
  const dashboard = window.MavMoleDashboard.create({ storageKey: "mavmole.mole.dashboard.v1" });

  let localSocket = null;
  let relaySocket = null;
  let localAttempt = 0;
  let relayAttempt = 0;
  let forwardingRequested = false;
  let forwardedFrames = 0;

  const stats = new ui.StreamStats({
    frames: document.querySelector("#frame-count"),
    bytes: document.querySelector("#byte-count"),
    rate: document.querySelector("#byte-rate"),
    dropped: document.querySelector("#dropped-count"),
  });

  function isOpen(socket) {
    return socket?.readyState === WebSocket.OPEN;
  }

  function isConnecting(socket) {
    return socket?.readyState === WebSocket.CONNECTING;
  }

  function renderControls() {
    const localBusy = isConnecting(localSocket);
    const localConnected = isOpen(localSocket);
    connectLocalButton.disabled = localBusy || localConnected;
    disconnectLocalButton.disabled = !localSocket;
    localUrlInput.disabled = localBusy || localConnected;
    startForwardingButton.disabled = !localConnected || forwardingRequested || Boolean(relaySocket);
    stopForwardingButton.disabled = !forwardingRequested && !relaySocket;
  }

  function closeSocket(socket, label) {
    if (isOpen(socket) || isConnecting(socket)) {
      log.info(`Closing ${label}.`);
      socket.close(1000, "Disconnected by user.");
    }
  }

  function renderForwardedCount() {
    forwardedCount.textContent = String(forwardedFrames);
  }

  function stopForwarding(updateStatuses = true) {
    relayAttempt += 1;
    forwardingRequested = false;
    const oldRelay = relaySocket;
    relaySocket = null;
    closeSocket(oldRelay, "MavMole relay");
    ui.renderViewerCount(viewerCount, 0);
    if (updateStatuses) {
      ui.setStatus(relayStatus, "Not connected", "idle");
      ui.setStatus(forwardingStatus, "Off — local dashboard remains active", "idle");
    }
    renderControls();
  }

  function disconnectLocal(updateStatuses = true) {
    localAttempt += 1;
    stopForwarding(false);
    const oldLocal = localSocket;
    localSocket = null;
    closeSocket(oldLocal, "Mission Planner WebSocket");
    if (updateStatuses) {
      ui.setStatus(localStatus, "Disconnected", "idle");
      ui.setStatus(relayStatus, "Not connected", "idle");
      ui.setStatus(forwardingStatus, "Off", "idle");
    }
    renderControls();
  }

  function ingestLocalFrame(data) {
    const byteLength = data.byteLength ?? data.size ?? 0;
    stats.record(byteLength);
    try {
      const messages = parser.push(data);
      for (const message of messages) {
        dashboard.ingestMessage(message);
        const changed = decoder.ingest(message);
        dashboard.update(decoder.state, changed);
      }
      if (messages.length > 0) {
        ui.setStatus(localStatus, `Connected · ${messages.length} MAVLink msg`, "connected");
      }
    } catch (error) {
      stats.drop();
      log.warn("Could not decode a local binary frame.", error);
    }

    if (!forwardingRequested) {
      return;
    }
    if (!isOpen(relaySocket)) {
      stats.drop();
      return;
    }
    relaySocket.send(data);
    forwardedFrames += 1;
    renderForwardedCount();
  }

  async function connectLocal({ automatic = false } = {}) {
    if (localSocket) {
      disconnectLocal(false);
    }
    const attempt = ++localAttempt;
    const localUrl = localUrlInput.value.trim();
    let parsedLocalUrl;
    try {
      parsedLocalUrl = new URL(localUrl);
      if (!["ws:", "wss:"].includes(parsedLocalUrl.protocol)) {
        throw new Error("The URL must start with ws:// or wss://.");
      }
    } catch (error) {
      ui.setStatus(localStatus, error.message, "error");
      log.error("Invalid Mission Planner URL.", error);
      renderControls();
      return;
    }

    stats.reset();
    parser.reset();
    decoder.reset();
    dashboard.reset();
    forwardedFrames = 0;
    renderForwardedCount();
    ui.setStatus(localStatus, automatic ? "Auto-connecting…" : "Connecting…", "connecting");
    ui.setStatus(forwardingStatus, "Off", "idle");

    let socket;
    try {
      socket = new WebSocket(parsedLocalUrl.href);
    } catch (error) {
      ui.setStatus(localStatus, "Browser blocked the local WebSocket", "error");
      renderControls();
      log.error("Browser refused the Mission Planner WebSocket.", error);
      return;
    }
    socket.binaryType = "arraybuffer";
    localSocket = socket;
    renderControls();
    log.info("Connecting locally to Mission Planner.", { url: parsedLocalUrl.href, automatic });

    socket.addEventListener("message", (event) => {
      if (localSocket !== socket) {
        return;
      }
      if (typeof event.data === "string") {
        stats.drop();
        log.warn("Ignored a text frame from Mission Planner.", { characters: event.data.length });
        return;
      }
      ingestLocalFrame(event.data);
    });
    socket.addEventListener("error", (event) => {
      if (localSocket === socket) {
        ui.setStatus(localStatus, "Mission Planner unavailable", "error");
      }
      log.error("Mission Planner WebSocket error.", event);
    });
    socket.addEventListener("close", (event) => {
      if (localSocket !== socket) {
        return;
      }
      localSocket = null;
      stopForwarding(false);
      ui.setStatus(
        localStatus,
        automatic && event.code !== 1000
          ? "Auto-connect failed — retry when Mission Planner is ready"
          : `Closed (code ${event.code})`,
        event.code === 1000 ? "idle" : "error",
      );
      ui.setStatus(relayStatus, "Not connected", "idle");
      ui.setStatus(forwardingStatus, "Off", "idle");
      renderControls();
      log.warn("Mission Planner connection closed.", { code: event.code, reason: event.reason });
    });

    try {
      await ui.waitForOpen(socket, "Mission Planner");
      if (attempt !== localAttempt || localSocket !== socket) {
        return;
      }
      ui.setStatus(localStatus, "Connected · waiting for MAVLink", "connected");
      renderControls();
      log.info("Mission Planner connected locally. Relay forwarding remains off.");
    } catch (error) {
      if (attempt !== localAttempt || localSocket !== socket) {
        return;
      }
      log.error("Could not connect locally to Mission Planner.", error);
      closeSocket(socket, "Mission Planner WebSocket");
    }
  }

  async function startForwarding() {
    if (!isOpen(localSocket) || forwardingRequested || relaySocket) {
      return;
    }
    forwardingRequested = true;
    const attempt = ++relayAttempt;
    const relayUrl = ui.relayWebSocketUrl("mole");
    let socket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (error) {
      forwardingRequested = false;
      ui.setStatus(relayStatus, "Connection blocked", "error");
      ui.setStatus(forwardingStatus, "Off — relay connection blocked", "error");
      renderControls();
      log.error("Browser refused the MavMole relay WebSocket.", error);
      return;
    }
    socket.binaryType = "arraybuffer";
    relaySocket = socket;
    ui.setStatus(relayStatus, "Connecting…", "connecting");
    ui.setStatus(forwardingStatus, "Starting…", "connecting");
    renderControls();
    log.info("Connecting to the MavMole relay for optional forwarding.", { url: relayUrl });

    socket.addEventListener("message", (event) => {
      if (relaySocket !== socket) {
        return;
      }
      const control = ui.parseRelayControl(event.data);
      if (control) {
        ui.renderViewerCount(viewerCount, control.viewers);
      }
    });
    socket.addEventListener("error", (event) => {
      if (relaySocket === socket) {
        ui.setStatus(relayStatus, "Connection error", "error");
      }
      log.error("Relay WebSocket error.", event);
    });
    socket.addEventListener("close", (event) => {
      if (relaySocket !== socket) {
        return;
      }
      relaySocket = null;
      const wasRequested = forwardingRequested;
      forwardingRequested = false;
      ui.renderViewerCount(viewerCount, 0);
      ui.setStatus(relayStatus, `Closed (code ${event.code})`, event.code === 1000 ? "idle" : "error");
      ui.setStatus(forwardingStatus, wasRequested ? "Off — relay closed" : "Off", wasRequested ? "error" : "idle");
      renderControls();
      log.warn("Relay connection closed; the local dashboard is still active.", { code: event.code, reason: event.reason });
    });

    try {
      await ui.waitForOpen(socket, "MavMole relay");
      if (attempt !== relayAttempt || relaySocket !== socket || !forwardingRequested) {
        return;
      }
      ui.setStatus(relayStatus, "Connected", "connected");
      ui.setStatus(forwardingStatus, "Forwarding binary frames", "connected");
      renderControls();
      log.info("Relay forwarding is active.");
    } catch (error) {
      if (attempt !== relayAttempt || relaySocket !== socket) {
        return;
      }
      log.error("Could not start relay forwarding.", error);
      forwardingRequested = false;
      relaySocket = null;
      closeSocket(socket, "MavMole relay");
      ui.setStatus(forwardingStatus, "Off — relay connection failed", "error");
      renderControls();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    connectLocal();
  });
  disconnectLocalButton.addEventListener("click", () => disconnectLocal(true));
  startForwardingButton.addEventListener("click", startForwarding);
  stopForwardingButton.addEventListener("click", () => stopForwarding(true));
  window.addEventListener("beforeunload", () => disconnectLocal(false));

  dashboard.reset();
  renderControls();
  globalThis.setTimeout(() => connectLocal({ automatic: true }), 0);
  log.info("Mole page ready. Starting local-only Mission Planner auto-connect.");
})();
