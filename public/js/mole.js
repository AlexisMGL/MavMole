(function runMolePage() {
  "use strict";

  const log = window.MavMoleLog.scope("Mole");
  const ui = window.MavMoleUi;
  const form = document.querySelector("#mole-form");
  const localUrlInput = document.querySelector("#local-url");
  const connectLocalButton = document.querySelector("#connect-local-button");
  const disconnectLocalButton = document.querySelector("#disconnect-local-button");
  const connectForwardButton = document.querySelector("#connect-forward-button");
  const stopForwardingButton = document.querySelector("#stop-forwarding-button");
  const tunnelMode = document.querySelector("#tunnel-mode");
  const streamName = document.querySelector("#stream-name");
  const streamPassword = document.querySelector("#stream-password");
  const privateStream = document.querySelector("#private-stream");
  const privateStreamLabel = document.querySelector("#private-stream-label");
  const tunnelHelp = document.querySelector("#tunnel-help");
  const localStatus = document.querySelector("#local-status");
  const relayStatus = document.querySelector("#relay-status");
  const forwardingStatus = document.querySelector("#forwarding-status");
  const viewerCount = document.querySelector("#viewer-count");
  const moleCount = document.querySelector("#mole-count");
  const activeStreamCount = document.querySelector("#active-stream-count");
  const tunnelId = document.querySelector("#tunnel-id");
  const notifications = document.querySelector("#mole-notifications");
  const forwardedCount = document.querySelector("#forwarded-count");
  const parser = new window.MavMoleTelemetry.MavlinkStreamParser();
  const decoder = new window.MavMoleTelemetry.TelemetryDecoder();
  const dashboard = window.MavMoleDashboard.create({ storageKey: "mavmole.mole.dashboard.v1" });

  let localSocket = null;
  let relaySocket = null;
  let localAttempt = 0;
  let relayAttempt = 0;
  let forwardingRequested = false;
  let relayAuthenticated = false;
  let connectForwardPending = false;
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
    connectLocalButton.disabled = connectForwardPending || localBusy || localConnected;
    disconnectLocalButton.disabled = !localSocket;
    localUrlInput.disabled = connectForwardPending || localBusy || localConnected;
    connectForwardButton.disabled = connectForwardPending || forwardingRequested || Boolean(relaySocket);
    connectForwardButton.textContent = connectForwardPending
      ? "Connecting + forwarding…"
      : forwardingRequested || relaySocket
        ? "Connected + forwarding"
        : "Connect + forward";
    stopForwardingButton.disabled = !forwardingRequested && !relaySocket;
    const tunnelLocked = connectForwardPending || Boolean(relaySocket);
    tunnelMode.disabled = tunnelLocked;
    streamName.disabled = tunnelLocked;
    streamPassword.disabled = tunnelLocked;
    privateStream.disabled = tunnelLocked || tunnelMode.value === "join";
  }

  function readTunnelConfig() {
    return ui.validateTunnelConfig({
      stream: streamName.value,
      password: streamPassword.value,
      private: privateStream.checked,
      mode: tunnelMode.value,
    }, "mole");
  }

  function syncTunnelMode() {
    const joining = tunnelMode.value === "join";
    if (joining) {
      privateStream.checked = false;
    }
    privateStreamLabel.hidden = joining;
    privateStream.disabled = joining || Boolean(relaySocket) || connectForwardPending;
    streamPassword.required = !joining && privateStream.checked;
    streamPassword.placeholder = joining ? "Required only for private tunnels" : "Only for private streams";
    streamPassword.autocomplete = joining ? "current-password" : "new-password";
    tunnelHelp.textContent = joining
      ? "Use exactly the same stream name and password as the existing tunnel."
      : "Public mode keeps the one-click demo behavior. Use a unique name to avoid mixing unrelated Moles.";
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
    relayAuthenticated = false;
    const oldRelay = relaySocket;
    relaySocket = null;
    closeSocket(oldRelay, "MavMole relay");
    ui.renderViewerCount(viewerCount, 0);
    ui.renderMoleCount(moleCount, 0);
    tunnelId.textContent = "—";
    tunnelId.removeAttribute("data-tunnel-id");
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
    if (!isOpen(relaySocket) || !relayAuthenticated) {
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
      return false;
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
      return false;
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
        return false;
      }
      ui.setStatus(localStatus, "Connected · waiting for MAVLink", "connected");
      renderControls();
      log.info("Mission Planner connected locally. Relay forwarding remains off.");
      return true;
    } catch (error) {
      if (attempt !== localAttempt || localSocket !== socket) {
        return false;
      }
      log.error("Could not connect locally to Mission Planner.", error);
      closeSocket(socket, "Mission Planner WebSocket");
      return false;
    }
  }

  async function connectAndForward() {
    if (connectForwardPending || forwardingRequested || relaySocket) {
      return;
    }
    connectForwardPending = true;
    renderControls();
    try {
      let connected = isOpen(localSocket);
      if (!connected && isConnecting(localSocket)) {
        const pendingSocket = localSocket;
        ui.setStatus(forwardingStatus, "Waiting for local connection…", "connecting");
        try {
          await ui.waitForOpen(pendingSocket, "Mission Planner");
          connected = localSocket === pendingSocket && isOpen(pendingSocket);
        } catch (_error) {
          connected = false;
        }
      }
      if (!connected) {
        connected = await connectLocal();
      }
      if (!connected) {
        ui.setStatus(forwardingStatus, "Off — local connection failed", "error");
        return;
      }
      await startForwarding();
    } finally {
      connectForwardPending = false;
      renderControls();
    }
  }

  async function startForwarding() {
    if (!isOpen(localSocket) || forwardingRequested || relaySocket) {
      return;
    }
    let tunnelConfig;
    try {
      tunnelConfig = readTunnelConfig();
    } catch (error) {
      ui.setStatus(relayStatus, error.message, "error");
      ui.setStatus(forwardingStatus, "Off — invalid tunnel configuration", "error");
      return;
    }
    forwardingRequested = true;
    relayAuthenticated = false;
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
      if (control?.type === "stream.presence") {
        ui.renderViewerCount(viewerCount, control.viewers);
        ui.renderMoleCount(moleCount, control.moles);
        ui.renderStreamCount(activeStreamCount, control.streams);
      } else if (control?.type === "stream.mole_active") {
        ui.showMoleNotice(notifications, control);
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
      relayAuthenticated = false;
      const wasRequested = forwardingRequested;
      forwardingRequested = false;
      ui.renderViewerCount(viewerCount, 0);
      ui.renderMoleCount(moleCount, 0);
      tunnelId.textContent = "—";
      tunnelId.removeAttribute("data-tunnel-id");
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
      const joined = await ui.authenticateTunnel(socket, tunnelConfig, "mole");
      if (attempt !== relayAttempt || relaySocket !== socket || !forwardingRequested) {
        return;
      }
      relayAuthenticated = true;
      tunnelId.textContent = joined.tunnelId.slice(0, 8);
      tunnelId.dataset.tunnelId = joined.tunnelId;
      tunnelId.title = joined.tunnelId;
      ui.setStatus(
        relayStatus,
        "Connected · " + joined.stream + (joined.secureTransport ? " · TLS" : " · local unencrypted transport"),
        "connected",
      );
      ui.setStatus(forwardingStatus, "Forwarding binary frames", "connected");
      renderControls();
      log.info("Relay forwarding is active.");
    } catch (error) {
      if (attempt !== relayAttempt || relaySocket !== socket) {
        return;
      }
      log.error("Could not start relay forwarding.", error);
      forwardingRequested = false;
      relayAuthenticated = false;
      relaySocket = null;
      closeSocket(socket, "MavMole relay");
      ui.setStatus(relayStatus, error.message, "error");
      ui.setStatus(forwardingStatus, "Off — relay connection failed", "error");
      renderControls();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    connectLocal();
  });
  disconnectLocalButton.addEventListener("click", () => disconnectLocal(true));
  connectForwardButton.addEventListener("click", connectAndForward);
  stopForwardingButton.addEventListener("click", () => stopForwarding(true));
  tunnelMode.addEventListener("change", () => {
    syncTunnelMode();
    renderControls();
  });
  privateStream.addEventListener("change", () => {
    streamPassword.required = privateStream.checked;
  });
  window.addEventListener("beforeunload", () => disconnectLocal(false));

  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  tunnelMode.value = requestedMode === "join" ? "join" : "create";
  syncTunnelMode();
  ui.loadPublicStreams().then((streams) => {
    const list = document.querySelector("#public-stream-list");
    list.replaceChildren(...streams.map((stream) => {
      const option = document.createElement("option");
      option.value = stream.name;
      option.label = stream.moles + " active Moles · " + stream.viewers + " viewers";
      return option;
    }));
  }).catch(() => {});
  ui.loadServiceStats().then((serviceStats) => {
    ui.renderStreamCount(activeStreamCount, serviceStats.streams);
  }).catch(() => {});
  dashboard.reset();
  renderControls();
  connectLocal({ automatic: true });
  log.info("Mole page ready. Starting local-only Mission Planner auto-connect.");
})();
