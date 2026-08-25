(function runMolePage() {
  "use strict";

  const log = window.MavMoleLog.scope("Mole");
  const ui = window.MavMoleUi;
  const form = document.querySelector("#mole-form");
  const localUrlInput = document.querySelector("#local-url");
  const connectButton = document.querySelector("#connect-button");
  const disconnectButton = document.querySelector("#disconnect-button");
  const localStatus = document.querySelector("#local-status");
  const relayStatus = document.querySelector("#relay-status");
  const forwardingStatus = document.querySelector("#forwarding-status");
  let localSocket = null;
  let relaySocket = null;
  let attempt = 0;

  const stats = new ui.StreamStats({
    frames: document.querySelector("#frame-count"),
    bytes: document.querySelector("#byte-count"),
    rate: document.querySelector("#byte-rate"),
    dropped: document.querySelector("#dropped-count"),
  });

  function setControls(isBusy) {
    connectButton.disabled = isBusy;
    disconnectButton.disabled = !isBusy;
    localUrlInput.disabled = isBusy;
  }

  function closeSocket(socket, label) {
    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      log.info(`Closing ${label}.`);
      socket.close(1000, "Disconnected by user.");
    }
  }

  function disconnect(updateStatuses = true) {
    attempt += 1;
    const oldLocal = localSocket;
    const oldRelay = relaySocket;
    localSocket = null;
    relaySocket = null;
    closeSocket(oldLocal, "Mission Planner WebSocket");
    closeSocket(oldRelay, "MavMole relay");
    setControls(false);

    if (updateStatuses) {
      ui.setStatus(localStatus, "Disconnected", "idle");
      ui.setStatus(relayStatus, "Disconnected", "idle");
      ui.setStatus(forwardingStatus, "Stopped", "idle");
    }
  }

  function handleRelayClose(socket, event) {
    if (relaySocket !== socket) {
      return;
    }

    relaySocket = null;
    ui.setStatus(relayStatus, `Closed (code ${event.code})`, "error");
    ui.setStatus(forwardingStatus, "Stopped: relay closed", "error");
    log.warn("Relay connection closed.", { code: event.code, reason: event.reason });

    const oldLocal = localSocket;
    localSocket = null;
    closeSocket(oldLocal, "Mission Planner WebSocket");
    setControls(false);
  }

  function handleLocalClose(socket, event) {
    if (localSocket !== socket) {
      return;
    }

    localSocket = null;
    ui.setStatus(localStatus, `Closed (code ${event.code})`, "error");
    ui.setStatus(forwardingStatus, "Stopped: local source closed", "error");
    log.warn("Mission Planner connection closed.", { code: event.code, reason: event.reason });

    const oldRelay = relaySocket;
    relaySocket = null;
    closeSocket(oldRelay, "MavMole relay");
    setControls(false);
  }

  async function connect() {
    disconnect(false);
    stats.reset();
    const currentAttempt = ++attempt;
    const localUrl = localUrlInput.value.trim();
    let parsedLocalUrl;

    try {
      parsedLocalUrl = new URL(localUrl);
      if (!['ws:', 'wss:'].includes(parsedLocalUrl.protocol)) {
        throw new Error("The URL must start with ws:// or wss://.");
      }
    } catch (error) {
      ui.setStatus(localStatus, error.message, "error");
      log.error("Invalid Mission Planner URL.", error);
      return;
    }

    setControls(true);
    ui.setStatus(relayStatus, "Connecting...", "connecting");
    ui.setStatus(localStatus, "Waiting for relay...", "connecting");
    ui.setStatus(forwardingStatus, "Not started", "idle");

    const relayUrl = ui.relayWebSocketUrl("mole");
    const newRelaySocket = new WebSocket(relayUrl);
    newRelaySocket.binaryType = "arraybuffer";
    relaySocket = newRelaySocket;
    log.info("Connecting to MavMole relay.", { url: relayUrl });

    newRelaySocket.addEventListener("error", (event) => {
      if (relaySocket === newRelaySocket) {
        ui.setStatus(relayStatus, "Connection error", "error");
      }
      log.error("Relay WebSocket error.", event);
    });
    newRelaySocket.addEventListener("close", (event) => handleRelayClose(newRelaySocket, event));

    try {
      await ui.waitForOpen(newRelaySocket, "MavMole relay");
      if (currentAttempt !== attempt) {
        return;
      }

      ui.setStatus(relayStatus, "Connected", "connected");
      log.info("Connected to MavMole relay.");

      const newLocalSocket = new WebSocket(parsedLocalUrl.href);
      newLocalSocket.binaryType = "arraybuffer";
      localSocket = newLocalSocket;
      ui.setStatus(localStatus, "Connecting...", "connecting");
      log.info("Connecting to Mission Planner WebSocket.", { url: parsedLocalUrl.href });

      newLocalSocket.addEventListener("message", (event) => {
        if (localSocket !== newLocalSocket) {
          return;
        }

        if (typeof event.data === "string") {
          stats.drop();
          log.warn("Ignored a text frame from Mission Planner.", { characters: event.data.length });
          return;
        }

        const byteLength = event.data.byteLength ?? event.data.size ?? 0;
        if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
          stats.drop();
          log.warn("Dropped a local binary frame because the relay is unavailable.", { bytes: byteLength });
          return;
        }

        relaySocket.send(event.data);
        stats.record(byteLength);
        log.debug("Forwarded a local binary frame to MavMole.", {
          bytes: byteLength,
          frame: stats.frames,
        });
      });
      newLocalSocket.addEventListener("error", (event) => {
        if (localSocket === newLocalSocket) {
          ui.setStatus(localStatus, "Connection error (check F12 Console)", "error");
        }
        log.error("Mission Planner WebSocket error.", event);
      });
      newLocalSocket.addEventListener("close", (event) => handleLocalClose(newLocalSocket, event));

      await ui.waitForOpen(newLocalSocket, "Mission Planner");
      if (currentAttempt !== attempt) {
        return;
      }

      ui.setStatus(localStatus, "Connected", "connected");
      ui.setStatus(forwardingStatus, "Forwarding binary frames", "connected");
      log.info("Connected to Mission Planner. Binary forwarding is active.");
    } catch (error) {
      if (currentAttempt !== attempt) {
        return;
      }

      log.error("Connection sequence failed.", error);
      ui.setStatus(forwardingStatus, "Connection failed (check F12 Console)", "error");
      const relayWasConnected = newRelaySocket.readyState === WebSocket.OPEN;
      disconnect(false);
      setControls(false);

      if (relayWasConnected) {
        ui.setStatus(relayStatus, "Connected, then closed after local failure", "idle");
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    connect();
  });

  disconnectButton.addEventListener("click", () => disconnect(true));
  window.addEventListener("beforeunload", () => disconnect(false));
  log.info("Mole page ready.");
})();
