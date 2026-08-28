(function runDiggerPage() {
  "use strict";

  const TRAIL_DURATION_MS = 3 * 60 * 1000;
  const TRAIL_SAMPLE_MS = 1000;
  const ESRI_SATELLITE_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const SOURCE_COLOURS = ["#d95d39", "#3478c7", "#2e9b68", "#9b59b6", "#d29b21", "#168c96", "#cb4b78"];
  const log = window.MavMoleLog.scope("Digger");
  const ui = window.MavMoleUi;
  const form = document.querySelector("#digger-tunnel-form");
  const connectButton = document.querySelector("#connect-button");
  const disconnectButton = document.querySelector("#disconnect-button");
  const streamName = document.querySelector("#stream-name");
  const streamPassword = document.querySelector("#stream-password");
  const relayStatus = document.querySelector("#relay-status");
  const receivingStatus = document.querySelector("#receiving-status");
  const viewerCount = document.querySelector("#viewer-count");
  const moleCount = document.querySelector("#mole-count");
  const activeStreamCount = document.querySelector("#active-stream-count");
  const tunnelId = document.querySelector("#tunnel-id");
  const notifications = document.querySelector("#mole-notifications");
  const lastFrame = document.querySelector("#last-frame");
  const sourceList = document.querySelector("#fleet-source-list");
  const fleetStatus = document.querySelector("#fleet-status");
  const activeMoleLabel = document.querySelector("#active-mole-label");
  const dashboard = window.MavMoleDashboard.create();
  let relaySocket = null;
  let relayAuthenticated = false;
  let activeSourceId = null;
  let sourceColourIndex = 0;
  const sources = new Map();

  const stats = new ui.StreamStats({
    frames: document.querySelector("#frame-count"),
    bytes: document.querySelector("#byte-count"),
    rate: document.querySelector("#byte-rate"),
  });

  function isOpen(socket) {
    return socket?.readyState === WebSocket.OPEN;
  }

  function isConnecting(socket) {
    return socket?.readyState === WebSocket.CONNECTING;
  }

  class FleetMap {
    constructor(element, emptyElement, onSelect) {
      this.element = element;
      this.emptyElement = emptyElement;
      this.onSelect = onSelect;
      this.layers = new Map();
      this.map = window.L.map(element, {
        attributionControl: true,
        zoomControl: true,
      }).setView([20, 0], 2);
      window.L.tileLayer(ESRI_SATELLITE_TILES, {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }).addTo(this.map);
      this.fadeTimer = window.setInterval(() => this.refreshFade(), 5000);
    }

    ensureSource(source) {
      if (!this.layers.has(source.id)) {
        this.layers.set(source.id, {
          marker: null,
          segments: [],
          lastPoint: null,
        });
      }
      return this.layers.get(source.id);
    }

    createMarker(source, position) {
      const icon = window.L.divIcon({
        className: "fleet-marker",
        html:
          '<span class="fleet-marker-symbol" style="--fleet-colour:' + source.colour + '" aria-hidden="true">' +
          '<svg viewBox="0 0 20 20"><path d="M10 1 L17 19 L10 15 L3 19 Z"></path></svg></span>',
        iconSize: [29, 29],
        iconAnchor: [14.5, 14.5],
      });
      const marker = window.L.marker([position.lat, position.lon], { icon })
        .addTo(this.map)
        .bindTooltip(source.label, { direction: "top", offset: [0, -12] });
      marker.on("click", () => this.onSelect(source.id));
      return marker;
    }

    update(source, position, now) {
      if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
        return;
      }
      const layer = this.ensureSource(source);
      const isNewMarker = !layer.marker;
      if (!layer.marker) {
        layer.marker = this.createMarker(source, position);
      } else {
        layer.marker.setLatLng([position.lat, position.lon]);
      }
      const symbol = layer.marker.getElement()?.querySelector(".fleet-marker-symbol");
      if (symbol) {
        symbol.style.transform = "rotate(" + (Number.isFinite(position.heading) ? position.heading : 0) + "deg)";
      }

      if (!layer.lastPoint || now - layer.lastPoint.time >= TRAIL_SAMPLE_MS) {
        const nextPoint = { lat: position.lat, lon: position.lon, time: now };
        if (layer.lastPoint) {
          const segment = window.L.polyline(
            [
              [layer.lastPoint.lat, layer.lastPoint.lon],
              [nextPoint.lat, nextPoint.lon],
            ],
            {
              color: source.colour,
              opacity: 0.9,
              weight: 4,
              lineCap: "round",
            },
          ).addTo(this.map);
          layer.segments.push({ line: segment, time: now });
        }
        layer.lastPoint = nextPoint;
      }

      this.emptyElement.hidden = true;
      this.refreshFade(now);
      if (isNewMarker) {
        this.fitSources();
      }
    }

    markOffline(sourceId) {
      const layer = this.layers.get(sourceId);
      if (!layer?.marker) {
        return;
      }
      this.map.removeLayer(layer.marker);
      layer.marker = null;
      this.refreshEmpty();
    }

    setSelected(sourceId) {
      for (const [id, layer] of this.layers.entries()) {
        const element = layer.marker?.getElement();
        if (element) {
          element.style.zIndex = id === sourceId ? "500" : "";
          element.style.filter = id === sourceId ? "drop-shadow(0 0 6px #ffffff)" : "";
        }
      }
    }

    refreshFade(now = Date.now()) {
      for (const [sourceId, layer] of this.layers.entries()) {
        layer.segments = layer.segments.filter((segment) => {
          const age = now - segment.time;
          if (age >= TRAIL_DURATION_MS) {
            this.map.removeLayer(segment.line);
            return false;
          }
          const freshness = 1 - age / TRAIL_DURATION_MS;
          segment.line.setStyle({ opacity: 0.05 + 0.85 * Math.pow(freshness, 1.35) });
          return true;
        });
        if (!layer.marker && layer.segments.length === 0) {
          this.layers.delete(sourceId);
        }
      }
      this.refreshEmpty();
    }

    refreshEmpty() {
      const hasVisibleData = Array.from(this.layers.values())
        .some((layer) => layer.marker || layer.segments.length > 0);
      this.emptyElement.hidden = hasVisibleData;
    }

    fitSources() {
      const points = Array.from(this.layers.values())
        .map((layer) => layer.marker?.getLatLng())
        .filter(Boolean);
      if (points.length === 1) {
        this.map.setView(points[0], 16);
      } else if (points.length > 1) {
        this.map.fitBounds(window.L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
      }
    }

    reset() {
      for (const layer of this.layers.values()) {
        if (layer.marker) {
          this.map.removeLayer(layer.marker);
        }
        for (const segment of layer.segments) {
          this.map.removeLayer(segment.line);
        }
      }
      this.layers.clear();
      this.emptyElement.hidden = false;
      this.map.setView([20, 0], 2);
    }

    invalidate() {
      window.setTimeout(() => this.map.invalidateSize(), 0);
    }
  }

  const fleetMap = new FleetMap(
    document.querySelector("#fleet-map"),
    document.querySelector("#fleet-map-empty"),
    selectSource,
  );

  function tunnelConfig() {
    return ui.validateTunnelConfig({
      stream: streamName.value,
      password: streamPassword.value,
      mode: "join",
    }, "digger");
  }

  function setControls(connectedOrConnecting) {
    connectButton.disabled = connectedOrConnecting;
    disconnectButton.disabled = !relaySocket;
    streamName.disabled = connectedOrConnecting;
    streamPassword.disabled = connectedOrConnecting;
  }

  function describeFrame(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const preview = Array.from(bytes.slice(0, 32), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return bytes.byteLength + " bytes\n" + preview + (bytes.byteLength > 32 ? " ..." : "");
  }

  function sourceLabel(sourceId) {
    return "Mole " + Number(sourceId).toString(36).toUpperCase().slice(-5);
  }

  function ensureSource(sourceId, label) {
    const numericId = Number(sourceId) >>> 0;
    let source = sources.get(numericId);
    if (!source) {
      source = {
        id: numericId,
        label: label || sourceLabel(numericId),
        colour: SOURCE_COLOURS[sourceColourIndex % SOURCE_COLOURS.length],
        parser: new window.MavMoleTelemetry.MavlinkStreamParser(),
        decoder: new window.MavMoleTelemetry.TelemetryDecoder(),
        online: true,
        lastFrameAt: 0,
        leftAt: 0,
      };
      sourceColourIndex += 1;
      sources.set(numericId, source);
    } else {
      source.online = true;
      source.leftAt = 0;
      if (label) {
        source.label = label;
      }
    }
    if (activeSourceId === null) {
      selectSource(numericId);
    } else {
      renderSourceList();
    }
    updateFleetStatus();
    return source;
  }

  function selectSource(sourceId) {
    const source = sources.get(Number(sourceId) >>> 0);
    if (!source) {
      return;
    }
    activeSourceId = source.id;
    activeMoleLabel.textContent = source.label;
    dashboard.reset();
    if (source.decoder.state.messageCount > 0) {
      dashboard.update(source.decoder.state, [
        "position",
        "airspeed",
        "agl",
        "batteryVoltage",
        "batteryCurrent",
        "batteryRemaining",
      ]);
    }
    fleetMap.setSelected(source.id);
    renderSourceList();
  }

  function renderSourceList() {
    sourceList.replaceChildren();
    if (sources.size === 0) {
      const empty = document.createElement("p");
      empty.className = "fleet-source-empty";
      empty.textContent = "No Mole has shared MAVLink yet.";
      sourceList.appendChild(empty);
      return;
    }
    for (const source of sources.values()) {
      const button = document.createElement("button");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      const state = document.createElement("small");
      button.type = "button";
      button.className = "fleet-source-button";
      button.style.setProperty("--fleet-colour", source.colour);
      button.dataset.state = source.online ? "online" : "offline";
      button.setAttribute("aria-pressed", String(source.id === activeSourceId));
      title.textContent = source.label;
      state.textContent = source.online
        ? source.lastFrameAt > 0
          ? "Live MAVLink"
          : "Connected · waiting for data"
        : "Disconnected · trail fading";
      copy.append(title, state);
      button.appendChild(copy);
      button.addEventListener("click", () => selectSource(source.id));
      sourceList.appendChild(button);
    }
  }

  function updateFleetStatus() {
    const active = Array.from(sources.values()).filter((source) => source.online && source.lastFrameAt > 0).length;
    if (active === 0) {
      fleetStatus.textContent = relayAuthenticated ? "Waiting for Mole data" : "Connect to a tunnel";
      fleetStatus.dataset.state = "waiting";
    } else {
      fleetStatus.textContent = active + " active Mole" + (active === 1 ? "" : "s");
      fleetStatus.dataset.state = "live";
    }
  }

  function markSourceOffline(sourceId) {
    const source = sources.get(Number(sourceId) >>> 0);
    if (!source) {
      return;
    }
    source.online = false;
    source.leftAt = Date.now();
    fleetMap.markOffline(source.id);
    if (activeSourceId === source.id) {
      const replacement = Array.from(sources.values()).find((candidate) => candidate.online);
      if (replacement) {
        selectSource(replacement.id);
      }
    }
    renderSourceList();
    updateFleetStatus();
  }

  function resetSources() {
    sources.clear();
    activeSourceId = null;
    sourceColourIndex = 0;
    activeMoleLabel.textContent = "No Mole selected";
    sourceList.replaceChildren();
    fleetMap.reset();
    renderSourceList();
    updateFleetStatus();
  }

  function handleControl(control) {
    if (control.type === "stream.presence") {
      ui.renderViewerCount(viewerCount, control.viewers);
      ui.renderMoleCount(moleCount, control.moles);
      ui.renderStreamCount(activeStreamCount, control.streams);
    } else if (control.type === "stream.mole_active") {
      ensureSource(control.sourceId, control.label);
      ui.showMoleNotice(notifications, control);
    } else if (control.type === "stream.mole_left") {
      markSourceOffline(control.sourceId);
    }
  }

  function ingestSourceFrame(sourceId, payload) {
    const source = ensureSource(sourceId);
    const now = Date.now();
    source.lastFrameAt = now;
    const messages = source.parser.push(payload);
    for (const message of messages) {
      if (source.id === activeSourceId) {
        dashboard.ingestMessage(message);
      }
      const changed = source.decoder.ingest(message, now);
      if (source.id === activeSourceId) {
        dashboard.update(source.decoder.state, changed);
      }
      if (changed.includes("position")) {
        fleetMap.update(source, source.decoder.state.position, now);
      }
    }
    if (messages.length > 0) {
      ui.setStatus(receivingStatus, "Receiving " + sources.size + " separated MAVLink source" + (sources.size === 1 ? "" : "s"), "connected");
    } else {
      ui.setStatus(receivingStatus, "Receiving binary stream", "connected");
    }
    renderSourceList();
    updateFleetStatus();
    return messages.length;
  }

  function disconnect(updateStatuses = true) {
    const oldSocket = relaySocket;
    relaySocket = null;
    relayAuthenticated = false;
    if (isOpen(oldSocket) || isConnecting(oldSocket)) {
      oldSocket.close(1000, "Disconnected by user.");
    }
    setControls(false);
    resetSources();
    tunnelId.textContent = "Not joined";
    tunnelId.removeAttribute("data-tunnel-id");
    if (updateStatuses) {
      ui.setStatus(relayStatus, "Disconnected", "idle");
      ui.setStatus(receivingStatus, "Stopped", "idle");
      ui.renderViewerCount(viewerCount, 0);
      ui.renderMoleCount(moleCount, 0);
    }
  }

  async function connect() {
    let config;
    try {
      config = tunnelConfig();
    } catch (error) {
      ui.setStatus(relayStatus, error.message, "error");
      return;
    }

    disconnect(false);
    stats.reset();
    dashboard.reset();
    lastFrame.textContent = "No frame received yet.";
    const relayUrl = ui.relayWebSocketUrl("digger");
    const socket = new WebSocket(relayUrl);
    socket.binaryType = "arraybuffer";
    relaySocket = socket;
    setControls(true);
    ui.setStatus(relayStatus, "Connecting…", "connecting");
    ui.setStatus(receivingStatus, "Waiting", "idle");

    socket.addEventListener("message", (event) => {
      if (relaySocket !== socket) {
        return;
      }
      if (typeof event.data === "string") {
        const control = ui.parseRelayControl(event.data);
        if (control) {
          handleControl(control);
        }
        return;
      }
      if (!relayAuthenticated) {
        return;
      }
      const envelope = ui.unpackRelayFrame(event.data);
      const byteLength = envelope.payload.byteLength ?? 0;
      stats.record(byteLength);
      lastFrame.textContent = describeFrame(envelope.payload);
      try {
        const mavlinkMessages = ingestSourceFrame(envelope.sourceId, envelope.payload);
        log.debug("Received a Mole frame.", {
          sourceId: envelope.sourceId,
          bytes: byteLength,
          mavlinkMessages,
        });
      } catch (error) {
        log.warn("Could not decode a Mole frame.", error);
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
      setControls(false);
      tunnelId.textContent = "Not joined";
      tunnelId.removeAttribute("data-tunnel-id");
      ui.setStatus(
        relayStatus,
        event.reason || "Closed (code " + event.code + ")",
        event.code === 1000 ? "idle" : "error",
      );
      ui.setStatus(receivingStatus, "Stopped", "idle");
      ui.renderViewerCount(viewerCount, 0);
      ui.renderMoleCount(moleCount, 0);
    });

    try {
      await ui.waitForOpen(socket, "MavMole relay");
      if (relaySocket !== socket) {
        return;
      }
      const joined = await ui.authenticateTunnel(socket, config, "digger");
      if (relaySocket !== socket) {
        return;
      }
      relayAuthenticated = true;
      tunnelId.textContent = joined.tunnelId.slice(0, 8);
      tunnelId.dataset.tunnelId = joined.tunnelId;
      tunnelId.title = joined.tunnelId;
      for (const source of joined.sources || []) {
        ensureSource(source.sourceId, source.label);
      }
      ui.setStatus(
        relayStatus,
        "Connected · " + joined.stream + (joined.secureTransport ? " · TLS" : " · local unencrypted transport"),
        "connected",
      );
      ui.setStatus(receivingStatus, "Waiting for Mole data", "connected");
      updateFleetStatus();
      fleetMap.invalidate();
    } catch (error) {
      if (relaySocket !== socket) {
        return;
      }
      ui.setStatus(relayStatus, error.message, "error");
      disconnect(false);
      setControls(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    connect();
  });
  disconnectButton.addEventListener("click", () => disconnect(true));
  window.addEventListener("beforeunload", () => disconnect(false));

  window.setInterval(() => {
    const now = Date.now();
    for (const [sourceId, source] of sources.entries()) {
      if (!source.online && source.leftAt > 0 && now - source.leftAt >= TRAIL_DURATION_MS) {
        sources.delete(sourceId);
      }
    }
    if (activeSourceId !== null && !sources.has(activeSourceId)) {
      const replacement = sources.values().next().value;
      if (replacement) {
        selectSource(replacement.id);
      } else {
        activeSourceId = null;
        activeMoleLabel.textContent = "No Mole selected";
        dashboard.reset();
      }
    }
    renderSourceList();
    updateFleetStatus();
  }, 10000);

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
  renderSourceList();
  updateFleetStatus();
  log.info("Digger page ready.");
})();
