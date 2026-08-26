(function runDiggerPage() {
  "use strict";

  const log = window.MavMoleLog.scope("Digger");
  const ui = window.MavMoleUi;
  const connectButton = document.querySelector("#connect-button");
  const disconnectButton = document.querySelector("#disconnect-button");
  const relayStatus = document.querySelector("#relay-status");
  const receivingStatus = document.querySelector("#receiving-status");
  const viewerCount = document.querySelector("#viewer-count");
  const lastFrame = document.querySelector("#last-frame");
  const parser = new window.MavMoleTelemetry.MavlinkStreamParser();
  const decoder = new window.MavMoleTelemetry.TelemetryDecoder();
  const dashboard = window.MavMoleDashboard.create();
  let relaySocket = null;

  const stats = new ui.StreamStats({
    frames: document.querySelector("#frame-count"),
    bytes: document.querySelector("#byte-count"),
    rate: document.querySelector("#byte-rate"),
  });

  function setControls(isConnected) {
    connectButton.disabled = isConnected;
    disconnectButton.disabled = !isConnected;
  }

  function describeFrame(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const preview = Array.from(bytes.slice(0, 32), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return `${bytes.byteLength} bytes\n${preview}${bytes.byteLength > 32 ? " ..." : ""}`;
  }

  function disconnect(updateStatuses = true) {
    const oldSocket = relaySocket;
    relaySocket = null;

    if (oldSocket && (oldSocket.readyState === WebSocket.OPEN || oldSocket.readyState === WebSocket.CONNECTING)) {
      log.info("Closing MavMole relay connection.");
      oldSocket.close(1000, "Disconnected by user.");
    }

    setControls(false);
    if (updateStatuses) {
      ui.setStatus(relayStatus, "Disconnected", "idle");
      ui.setStatus(receivingStatus, "Stopped", "idle");
      ui.renderViewerCount(viewerCount, 0);
    }
  }

  async function connect() {
    disconnect(false);
    stats.reset();
    parser.reset();
    decoder.reset();
    dashboard.reset();
    lastFrame.textContent = "No frame received yet.";
    const relayUrl = ui.relayWebSocketUrl("digger");
    const socket = new WebSocket(relayUrl);
    socket.binaryType = "arraybuffer";
    relaySocket = socket;
    setControls(true);
    ui.setStatus(relayStatus, "Connecting...", "connecting");
    ui.setStatus(receivingStatus, "Waiting", "idle");
    log.info("Connecting to MavMole relay.", { url: relayUrl });

    socket.addEventListener("message", (event) => {
      if (relaySocket !== socket) {
        return;
      }

      if (typeof event.data === "string") {
        const control = ui.parseRelayControl(event.data);
        if (control) {
          ui.renderViewerCount(viewerCount, control.viewers);
          return;
        }
        log.warn("Ignored an unexpected text frame from the relay.", { characters: event.data.length });
        return;
      }

      const byteLength = event.data.byteLength ?? event.data.size ?? 0;
      stats.record(byteLength);
      lastFrame.textContent = describeFrame(event.data);

      const messages = parser.push(event.data);
      if (messages.length > 0) {
        for (const message of messages) {
          dashboard.ingestMessage(message);
          const changed = decoder.ingest(message);
          dashboard.update(decoder.state, changed);
        }
        ui.setStatus(receivingStatus, "Receiving MAVLink telemetry", "connected");
      } else {
        ui.setStatus(receivingStatus, "Receiving binary stream", "connected");
      }

      log.debug("Received a binary frame from MavMole.", {
        bytes: byteLength,
        frame: stats.frames,
        mavlinkMessages: messages.length,
      });
    });

    socket.addEventListener("error", (event) => {
      if (relaySocket === socket) {
        ui.setStatus(relayStatus, "Connection error (check F12 Console)", "error");
      }
      log.error("Relay WebSocket error.", event);
    });

    socket.addEventListener("close", (event) => {
      if (relaySocket !== socket) {
        return;
      }

      relaySocket = null;
      setControls(false);
      ui.setStatus(relayStatus, `Closed (code ${event.code})`, event.code === 1000 ? "idle" : "error");
      ui.setStatus(receivingStatus, "Stopped", "idle");
      ui.renderViewerCount(viewerCount, 0);
      log.warn("Relay connection closed.", { code: event.code, reason: event.reason });
    });

    try {
      await ui.waitForOpen(socket, "MavMole relay");
      if (relaySocket !== socket) {
        return;
      }

      ui.setStatus(relayStatus, "Connected", "connected");
      ui.setStatus(receivingStatus, "Waiting for Mole data", "connected");
      log.info("Connected. Waiting for binary frames from the Mole.");
    } catch (error) {
      if (relaySocket !== socket) {
        return;
      }

      log.error("Could not connect to the relay.", error);
      disconnect(false);
      setControls(false);
    }
  }

  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", () => disconnect(true));
  window.addEventListener("beforeunload", () => disconnect(false));
  dashboard.reset();
  log.info("Digger page ready.");
})();
