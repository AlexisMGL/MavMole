(function createTelemetryDashboard(global) {
  "use strict";

  const STORAGE_KEY = "mavmole.dashboard.v1";
  const PROFILE_FORMAT = "mavmole-dashboard";
  const PROFILE_VERSION = 2;
  const CUSTOM_WIDGET_TYPES = new Set(["value", "chart", "gauge"]);
  const MAX_CUSTOM_WIDGETS = 32;
  const MAX_HISTORY_POINTS = 240;
  const WIDGETS = Object.freeze([
    { id: "position", label: "Position" },
    { id: "airspeed", label: "Airspeed" },
    { id: "agl", label: "AGL altitude" },
    { id: "battery", label: "Battery" },
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    order: WIDGETS.map((widget) => widget.id),
    visible: Object.fromEntries(WIDGETS.map((widget) => [widget.id, true])),
    speedUnit: "mps",
    altitudeUnit: "m",
    layout: "balanced",
    accent: "#b86238",
    trailPoints: 80,
    airspeedScaleMps: 50,
    altitudeScaleM: 150,
    customWidgets: [],
  });

  function cloneDefaults() {
    return {
      ...DEFAULT_SETTINGS,
      order: [...DEFAULT_SETTINGS.order],
      visible: { ...DEFAULT_SETTINGS.visible },
      customWidgets: [],
    };
  }

  function safeText(value, fallback = "") {
    return typeof value === "string" ? value.trim().slice(0, 80) : fallback;
  }

  function createWidgetId() {
    if (global.crypto?.randomUUID) {
      return global.crypto.randomUUID();
    }
    return `widget-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function sanitizeCustomWidget(value) {
    if (!value || typeof value !== "object" || !CUSTOM_WIDGET_TYPES.has(value.type)) {
      return null;
    }
    const fieldKey = safeText(value.fieldKey);
    if (!/^\d+\.[A-Za-z0-9_]+(?:\[\d+\])?$/.test(fieldKey)) {
      return null;
    }

    const minimum = Number(value.min);
    const maximum = Number(value.max);
    const requestedId = safeText(value.id);
    return {
      id: /^[A-Za-z0-9-]{1,80}$/.test(requestedId) ? requestedId : createWidgetId(),
      type: value.type,
      fieldKey,
      messageName: safeText(value.messageName, "MAVLink"),
      fieldLabel: safeText(value.fieldLabel, fieldKey.split(".").slice(1).join(".")),
      label: safeText(value.label),
      unit: safeText(value.unit),
      decimals: Math.round(clamp(Number(value.decimals) || 0, 0, 6)),
      absolute: Boolean(value.absolute),
      min: Number.isFinite(minimum) ? minimum : 0,
      max: Number.isFinite(maximum) && maximum > minimum ? maximum : 100,
      windowSeconds: clamp(Number(value.windowSeconds) || 60, 5, 600),
    };
  }

  function normalizeSettings(saved) {
    if (!saved || typeof saved !== "object") {
      return cloneDefaults();
    }

    const knownIds = new Set(WIDGETS.map((widget) => widget.id));
    const savedOrder = Array.isArray(saved.order) ? saved.order.filter((id) => knownIds.has(id)) : [];
    const missingIds = DEFAULT_SETTINGS.order.filter((id) => !savedOrder.includes(id));
    const customWidgets = Array.isArray(saved.customWidgets)
      ? saved.customWidgets.map(sanitizeCustomWidget).filter(Boolean).slice(0, MAX_CUSTOM_WIDGETS)
      : [];
    const customIds = new Set();
    for (const widget of customWidgets) {
      if (customIds.has(widget.id)) {
        widget.id = createWidgetId();
      }
      customIds.add(widget.id);
    }
    const visible = Object.fromEntries(
      WIDGETS.map((widget) => [widget.id, saved.visible?.[widget.id] !== false]),
    );
    return {
      ...cloneDefaults(),
      order: [...savedOrder, ...missingIds],
      visible,
      speedUnit: ["mps", "kmh", "kt"].includes(saved.speedUnit) ? saved.speedUnit : DEFAULT_SETTINGS.speedUnit,
      altitudeUnit: ["m", "ft"].includes(saved.altitudeUnit) ? saved.altitudeUnit : DEFAULT_SETTINGS.altitudeUnit,
      layout: ["balanced", "equal", "single"].includes(saved.layout) ? saved.layout : DEFAULT_SETTINGS.layout,
      accent: /^#[0-9a-f]{6}$/i.test(saved.accent) ? saved.accent : DEFAULT_SETTINGS.accent,
      trailPoints: clamp(Number(saved.trailPoints) || DEFAULT_SETTINGS.trailPoints, 10, 250),
      airspeedScaleMps: clamp(Number(saved.airspeedScaleMps) || DEFAULT_SETTINGS.airspeedScaleMps, 5, 200),
      altitudeScaleM: clamp(Number(saved.altitudeScaleM) || DEFAULT_SETTINGS.altitudeScaleM, 10, 5000),
      customWidgets,
    };
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") {
        return cloneDefaults();
      }

      return normalizeSettings(saved);
    } catch (_error) {
      return cloneDefaults();
    }
  }

  function saveSettings(settings) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_error) {
      // The dashboard still works when storage is unavailable.
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function distanceMeters(first, second) {
    const radians = Math.PI / 180;
    const lat1 = first.lat * radians;
    const lat2 = second.lat * radians;
    const latDelta = (second.lat - first.lat) * radians;
    const lonDelta = (second.lon - first.lon) * radians;
    const value =
      Math.sin(latDelta / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function formatSpeed(metersPerSecond, unit) {
    if (!Number.isFinite(metersPerSecond)) {
      return { value: "—", unit: unit === "kt" ? "kt" : unit === "kmh" ? "km/h" : "m/s" };
    }

    if (unit === "kt") {
      return { value: (metersPerSecond * 1.943844).toFixed(1), unit: "kt" };
    }
    if (unit === "kmh") {
      return { value: (metersPerSecond * 3.6).toFixed(1), unit: "km/h" };
    }
    return { value: metersPerSecond.toFixed(1), unit: "m/s" };
  }

  function formatAltitude(meters, unit) {
    if (!Number.isFinite(meters)) {
      return { value: "—", unit: unit === "ft" ? "ft" : "m" };
    }
    if (unit === "ft") {
      return { value: (meters * 3.28084).toFixed(0), unit: "ft" };
    }
    return { value: meters.toFixed(1), unit: "m" };
  }

  let googleMapsPromise = null;

  async function loadGoogleMaps() {
    if (global.google?.maps?.Map) {
      return global.google.maps;
    }
    if (googleMapsPromise) {
      return googleMapsPromise;
    }

    googleMapsPromise = fetch("/api/config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Map configuration returned ${response.status}.`);
        }
        return response.json();
      })
      .then((config) => {
        if (!config.googleMapsApiKey) {
          throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
        }
        return new Promise((resolve, reject) => {
          const callbackName = `__mavMoleGoogleMapsReady${Date.now()}`;
          global[callbackName] = () => {
            delete global[callbackName];
            resolve(global.google.maps);
          };
          const script = document.createElement("script");
          const query = new URLSearchParams({
            key: config.googleMapsApiKey,
            callback: callbackName,
            loading: "async",
            v: "weekly",
            auth_referrer_policy: "origin",
          });
          script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
          script.async = true;
          script.onerror = () => {
            delete global[callbackName];
            reject(new Error("Google Maps JavaScript API failed to load."));
          };
          document.head.appendChild(script);
        });
      });
    return googleMapsPromise;
  }

  class SatelliteMap {
    constructor(container, statusElement) {
      this.container = container;
      this.statusElement = statusElement;
      this.map = null;
      this.marker = null;
      this.polyline = null;
      this.pendingTrail = [];
      this.initialize();
    }

    async initialize() {
      try {
        const maps = await loadGoogleMaps();
        this.map = new maps.Map(this.container, {
          center: { lat: 0, lng: 0 },
          zoom: 18,
          mapTypeId: "satellite",
          disableDefaultUI: true,
          clickableIcons: false,
          keyboardShortcuts: false,
          gestureHandling: "cooperative",
        });
        this.polyline = new maps.Polyline({
          map: this.map,
          strokeColor: "#f07a3c",
          strokeOpacity: 0.95,
          strokeWeight: 3,
        });
        this.marker = new maps.Marker({
          map: this.map,
          title: "Aircraft",
          zIndex: 4,
        });
        this.container.parentElement.dataset.mapState = "satellite";
        this.statusElement.textContent = "Google Satellite";
        this.update(this.pendingTrail);
      } catch (error) {
        this.container.parentElement.dataset.mapState = "fallback";
        this.statusElement.textContent = "Local trail";
        this.statusElement.title = error.message;
      }
    }

    reset() {
      this.pendingTrail = [];
      this.polyline?.setPath([]);
      this.marker?.setMap(null);
    }

    update(trail) {
      this.pendingTrail = trail;
      if (!this.map || trail.length === 0) {
        return;
      }

      const path = trail.map((point) => ({ lat: point.lat, lng: point.lon }));
      const last = trail.at(-1);
      const position = path.at(-1);
      this.polyline.setPath(path);
      this.marker.setMap(this.map);
      this.marker.setPosition(position);
      this.marker.setIcon({
        path: global.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        fillColor: "#f07a3c",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        rotation: Number.isFinite(last.heading) ? last.heading : 0,
        scale: 6,
      });
      this.map.setCenter(position);
    }
  }

  class Dashboard {
    constructor() {
      this.root = document.querySelector("#telemetry-grid");
      this.settingsDialog = document.querySelector("#dashboard-settings");
      this.settings = loadSettings();
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;
      this.fieldRegistry = new Map();
      this.observedMessages = new Map();
      this.customHistory = new Map();

      this.elements = {
        freshness: document.querySelector("#telemetry-freshness"),
        satelliteMap: document.querySelector("#satellite-map"),
        mapProviderStatus: document.querySelector("#map-provider-status"),
        positionEmpty: document.querySelector("#position-empty"),
        positionTrail: document.querySelector("#position-trail"),
        vehicleMarker: document.querySelector("#vehicle-marker"),
        latitude: document.querySelector("#latitude-value"),
        longitude: document.querySelector("#longitude-value"),
        heading: document.querySelector("#heading-value"),
        mapLink: document.querySelector("#map-link"),
        airspeedValue: document.querySelector("#airspeed-value"),
        airspeedUnit: document.querySelector("#airspeed-unit"),
        airspeedArc: document.querySelector("#airspeed-arc"),
        airspeedSource: document.querySelector("#airspeed-source"),
        aglValue: document.querySelector("#agl-value"),
        aglUnit: document.querySelector("#agl-unit"),
        aglFill: document.querySelector("#agl-fill"),
        aglSource: document.querySelector("#agl-source"),
        batteryVoltage: document.querySelector("#battery-voltage"),
        batteryCurrent: document.querySelector("#battery-current"),
        batteryPower: document.querySelector("#battery-power"),
        batteryRemaining: document.querySelector("#battery-remaining"),
        batteryBar: document.querySelector("#battery-bar"),
        batterySource: document.querySelector("#battery-source"),
      };

      this.satelliteMap = new SatelliteMap(this.elements.satelliteMap, this.elements.mapProviderStatus);

      this.bindSettings();
      this.applySettings();
      this.freshnessTimer = global.setInterval(() => this.renderFreshness(), 1000);
    }

    reset() {
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;
      this.fieldRegistry.clear();
      this.observedMessages.clear();
      this.customHistory.clear();
      this.satelliteMap.reset();
      this.elements.positionTrail.setAttribute("points", "");
      this.elements.vehicleMarker.setAttribute("hidden", "");
      this.elements.positionEmpty.hidden = false;
      this.elements.latitude.textContent = "—";
      this.elements.longitude.textContent = "—";
      this.elements.heading.textContent = "—";
      this.elements.mapLink.removeAttribute("href");
      this.elements.mapLink.setAttribute("aria-disabled", "true");
      this.renderAirspeed(null);
      this.renderAgl(null);
      this.renderBattery(null);
      this.renderAllCustomWidgets();
      this.renderFreshness();
    }

    update(state, changed) {
      this.state = state;
      const changedSet = new Set(changed);

      if (changedSet.has("position")) {
        this.renderPosition(state.position);
      }
      if (changedSet.has("airspeed")) {
        this.renderAirspeed(state.airspeed);
      }
      if (changedSet.has("agl")) {
        this.renderAgl(state.agl);
      }
      if (changedSet.has("battery")) {
        this.renderBattery(state);
      }
      this.renderFreshness();
    }

    ingestMessage(packet, now = Date.now()) {
      const decoded = packet.decoded;
      if (!decoded) {
        return;
      }

      let message = this.observedMessages.get(decoded.messageId);
      let catalogChanged = false;
      if (!message) {
        message = {
          id: decoded.messageId,
          name: decoded.messageName,
          fields: new Map(),
        };
        this.observedMessages.set(decoded.messageId, message);
        catalogChanged = true;
      }

      const updatedKeys = new Set();
      for (const [fieldName, rawValue] of Object.entries(decoded.fields)) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        values.forEach((value, index) => {
          if (!Number.isFinite(value)) {
            return;
          }
          const suffix = Array.isArray(rawValue) ? `[${index}]` : "";
          const fieldLabel = `${fieldName}${suffix}`;
          const key = `${decoded.messageId}.${fieldLabel}`;
          const metadata = {
            key,
            messageId: decoded.messageId,
            messageName: decoded.messageName,
            fieldName,
            fieldLabel,
            value,
            updatedAt: now,
          };
          this.fieldRegistry.set(key, metadata);
          updatedKeys.add(key);
          if (!message.fields.has(key)) {
            message.fields.set(key, metadata);
            catalogChanged = true;
          }
        });
      }

      for (const widget of this.settings.customWidgets) {
        if (!updatedKeys.has(widget.fieldKey)) {
          continue;
        }
        const metadata = this.fieldRegistry.get(widget.fieldKey);
        if (widget.type === "chart") {
          const history = this.customHistory.get(widget.id) || [];
          history.push({ time: now, value: widget.absolute ? Math.abs(metadata.value) : metadata.value });
          const cutoff = now - widget.windowSeconds * 1000;
          this.customHistory.set(
            widget.id,
            history.filter((point) => point.time >= cutoff).slice(-MAX_HISTORY_POINTS),
          );
        }
        this.renderCustomWidget(widget);
      }

      if (catalogChanged && this.settingsDialog.open) {
        this.syncFieldOptions();
      }
    }

    renderFreshness() {
      const timestamp = this.state?.lastTelemetryAt || 0;
      if (timestamp === 0) {
        this.elements.freshness.textContent = "Waiting for MAVLink";
        this.elements.freshness.dataset.state = "waiting";
        return;
      }

      const age = Date.now() - timestamp;
      if (age < 2500) {
        this.elements.freshness.textContent = "Telemetry live";
        this.elements.freshness.dataset.state = "live";
      } else {
        this.elements.freshness.textContent = `Last update ${Math.round(age / 1000)}s ago`;
        this.elements.freshness.dataset.state = "stale";
      }
    }

    renderPosition(position) {
      if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lon)) {
        return;
      }

      const point = {
        lat: position.lat,
        lon: position.lon,
        heading: position.heading,
        updatedAt: position.updatedAt,
      };
      const previous = this.trail.at(-1);
      if (
        position.updatedAt !== this.lastTrailTimestamp &&
        (!previous || distanceMeters(previous, point) >= 0.25)
      ) {
        this.trail.push(point);
        this.trail = this.trail.slice(-this.settings.trailPoints);
        this.lastTrailTimestamp = position.updatedAt;
      } else if (previous) {
        previous.heading = position.heading;
      }

      this.elements.positionEmpty.hidden = true;
      this.elements.vehicleMarker.removeAttribute("hidden");
      this.elements.latitude.textContent = position.lat.toFixed(6);
      this.elements.longitude.textContent = position.lon.toFixed(6);
      this.elements.heading.textContent = Number.isFinite(position.heading)
        ? `${position.heading.toFixed(0)}°`
        : "—";
      this.elements.mapLink.href = `https://www.google.com/maps?q=${position.lat},${position.lon}&t=k`;
      this.elements.mapLink.removeAttribute("aria-disabled");
      this.renderTrail(position.heading);
      this.satelliteMap.update(this.trail);
    }

    renderTrail(heading) {
      if (this.trail.length === 0) {
        return;
      }

      const reference = this.trail[0];
      const cosLatitude = Math.max(0.1, Math.cos((reference.lat * Math.PI) / 180));
      const projected = this.trail.map((point) => ({
        x: (point.lon - reference.lon) * 111320 * cosLatitude,
        y: (point.lat - reference.lat) * 110540,
      }));
      const xs = projected.map((point) => point.x);
      const ys = projected.map((point) => point.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const span = Math.max(maxX - minX, maxY - minY, 20);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const mapPoint = (point) => ({
        x: 50 + ((point.x - centerX) / span) * 78,
        y: 50 - ((point.y - centerY) / span) * 78,
      });
      const displayPoints = projected.map(mapPoint);
      const last = displayPoints.at(-1);

      this.elements.positionTrail.setAttribute(
        "points",
        displayPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
      );
      this.elements.vehicleMarker.setAttribute(
        "transform",
        `translate(${last.x.toFixed(2)} ${last.y.toFixed(2)}) rotate(${Number.isFinite(heading) ? heading : 0})`,
      );
    }

    renderAirspeed(field) {
      const formatted = formatSpeed(field?.value, this.settings.speedUnit);
      this.elements.airspeedValue.textContent = formatted.value;
      this.elements.airspeedUnit.textContent = formatted.unit;
      this.elements.airspeedSource.textContent = field?.source || "No airspeed message";
      const percentage = Number.isFinite(field?.value)
        ? clamp((field.value / this.settings.airspeedScaleMps) * 100, 0, 100)
        : 0;
      this.elements.airspeedArc.style.strokeDashoffset = String(100 - percentage);
    }

    renderAgl(field) {
      const formatted = formatAltitude(field?.value, this.settings.altitudeUnit);
      this.elements.aglValue.textContent = formatted.value;
      this.elements.aglUnit.textContent = formatted.unit;
      this.elements.aglSource.textContent = field?.source || "No AGL source";
      const percentage = Number.isFinite(field?.value)
        ? clamp((field.value / this.settings.altitudeScaleM) * 100, 0, 100)
        : 0;
      this.elements.aglFill.style.height = `${percentage}%`;
    }

    renderBattery(state) {
      const voltage = state?.batteryVoltage?.value;
      const current = state?.batteryCurrent?.value;
      const remaining = state?.batteryRemaining?.value;
      this.elements.batteryVoltage.textContent = Number.isFinite(voltage) ? `${voltage.toFixed(1)} V` : "—";
      this.elements.batteryCurrent.textContent = Number.isFinite(current) ? `${Math.abs(current).toFixed(1)} A` : "—";
      this.elements.batteryPower.textContent =
        Number.isFinite(voltage) && Number.isFinite(current) ? `${Math.round(voltage * Math.abs(current))} W` : "—";
      this.elements.batteryRemaining.textContent = Number.isFinite(remaining) ? `${remaining.toFixed(0)}%` : "—";
      const percentage = Number.isFinite(remaining) ? clamp(remaining, 0, 100) : 0;
      this.elements.batteryBar.style.width = `${percentage}%`;
      this.elements.batteryBar.parentElement.setAttribute("aria-valuenow", String(percentage));
      this.elements.batterySource.textContent =
        state?.batteryVoltage?.source || state?.batteryCurrent?.source || "No battery message";
    }

    customWidgetTitle(widget) {
      return widget.label || `${widget.messageName} · ${widget.fieldLabel}`;
    }

    createCustomWidget(widget) {
      const article = document.createElement("article");
      article.className = `telemetry-widget custom-telemetry-widget custom-${widget.type}-widget`;
      article.dataset.customWidget = widget.id;
      article.innerHTML = `
        <header class="widget-heading custom-widget-heading">
          <div>
            <span class="widget-kicker" data-role="message"></span>
            <h3 data-role="title"></h3>
          </div>
          <span class="widget-symbol" data-role="kind"></span>
        </header>
        <div class="custom-widget-content" data-role="content"></div>
        <p class="widget-source" data-role="source">Waiting for field</p>`;
      article.querySelector('[data-role="message"]').textContent = widget.messageName;
      article.querySelector('[data-role="title"]').textContent = this.customWidgetTitle(widget);
      article.querySelector('[data-role="kind"]').textContent =
        widget.type === "chart" ? "TIME" : widget.type === "gauge" ? "GAUGE" : "VALUE";

      const content = article.querySelector('[data-role="content"]');
      if (widget.type === "value") {
        content.innerHTML = `
          <div class="custom-value-readout">
            <strong data-role="value">—</strong>
            <span data-role="unit"></span>
          </div>`;
      } else if (widget.type === "gauge") {
        content.innerHTML = `
          <div class="custom-gauge">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="gauge-track" cx="60" cy="60" r="48" pathLength="100"></circle>
              <circle class="gauge-value" data-role="gauge-arc" cx="60" cy="60" r="48" pathLength="100"></circle>
            </svg>
            <div class="gauge-readout"><strong data-role="value">—</strong><span data-role="unit"></span></div>
          </div>
          <div class="custom-range"><span data-role="minimum"></span><span data-role="maximum"></span></div>`;
      } else {
        content.innerHTML = `
          <div class="chart-current"><strong data-role="value">—</strong><span data-role="unit"></span></div>
          <svg class="time-chart" viewBox="0 0 300 110" preserveAspectRatio="none" aria-label="Time based graph">
            <path class="chart-grid" d="M12 12H288 M12 52H288 M12 92H288 M12 12V92 M104 12V92 M196 12V92 M288 12V92"></path>
            <polyline class="chart-line" data-role="chart-line" points=""></polyline>
          </svg>
          <div class="custom-range"><span data-role="chart-min">—</span><span data-role="window"></span><span data-role="chart-max">—</span></div>`;
      }
      return article;
    }

    ensureCustomWidgets() {
      this.root.querySelectorAll(".custom-telemetry-widget").forEach((element) => element.remove());
      const activeIds = new Set(this.settings.customWidgets.map((widget) => widget.id));
      for (const historyId of this.customHistory.keys()) {
        if (!activeIds.has(historyId)) {
          this.customHistory.delete(historyId);
        }
      }
      for (const widget of this.settings.customWidgets) {
        this.root.appendChild(this.createCustomWidget(widget));
        this.renderCustomWidget(widget);
      }
    }

    formatCustomValue(value, widget) {
      if (!Number.isFinite(value)) {
        return "—";
      }
      const normalized = widget.absolute ? Math.abs(value) : value;
      return normalized.toLocaleString(undefined, {
        minimumFractionDigits: widget.decimals,
        maximumFractionDigits: widget.decimals,
      });
    }

    renderCustomWidget(widget) {
      const article = this.root.querySelector(`[data-custom-widget="${CSS.escape(widget.id)}"]`);
      if (!article) {
        return;
      }
      const metadata = this.fieldRegistry.get(widget.fieldKey);
      const value = metadata?.value;
      const displayValue = widget.absolute && Number.isFinite(value) ? Math.abs(value) : value;
      article.querySelector('[data-role="value"]').textContent = this.formatCustomValue(value, widget);
      article.querySelector('[data-role="unit"]').textContent = widget.unit;
      article.querySelector('[data-role="source"]').textContent = metadata
        ? `${widget.messageName}.${widget.fieldLabel}`
        : `Waiting for ${widget.messageName}.${widget.fieldLabel}`;

      if (widget.type === "gauge") {
        const range = widget.max - widget.min;
        const percentage = Number.isFinite(displayValue)
          ? clamp(((displayValue - widget.min) / range) * 100, 0, 100)
          : 0;
        article.querySelector('[data-role="gauge-arc"]').style.strokeDashoffset = String(100 - percentage);
        article.querySelector('[data-role="minimum"]').textContent = `${widget.min}${widget.unit ? ` ${widget.unit}` : ""}`;
        article.querySelector('[data-role="maximum"]').textContent = `${widget.max}${widget.unit ? ` ${widget.unit}` : ""}`;
      }

      if (widget.type === "chart") {
        const history = this.customHistory.get(widget.id) || [];
        const line = article.querySelector('[data-role="chart-line"]');
        const windowLabel = article.querySelector('[data-role="window"]');
        windowLabel.textContent = `${widget.windowSeconds}s window`;
        if (history.length === 0) {
          line.setAttribute("points", "");
          return;
        }

        const values = history.map((point) => point.value);
        let minimum = Math.min(...values);
        let maximum = Math.max(...values);
        if (maximum === minimum) {
          const padding = Math.max(Math.abs(maximum) * 0.05, 1);
          minimum -= padding;
          maximum += padding;
        }
        const firstTime = history[0].time;
        const timeSpan = Math.max(history.at(-1).time - firstTime, 1);
        const valueSpan = maximum - minimum;
        const points = history.map((point) => {
          const x = 12 + ((point.time - firstTime) / timeSpan) * 276;
          const y = 92 - ((point.value - minimum) / valueSpan) * 80;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        line.setAttribute("points", points.join(" "));
        article.querySelector('[data-role="chart-min"]').textContent = minimum.toFixed(widget.decimals);
        article.querySelector('[data-role="chart-max"]').textContent = maximum.toFixed(widget.decimals);
      }
    }

    renderAllCustomWidgets() {
      for (const widget of this.settings.customWidgets) {
        this.renderCustomWidget(widget);
      }
    }

    bindSettings() {
      document.querySelector("#customize-dashboard-button").addEventListener("click", () => {
        this.renderWidgetSettings();
        this.renderCustomWidgetSettings();
        this.syncFieldOptions();
        this.settingsDialog.showModal();
      });
      document.querySelector("#close-settings-button").addEventListener("click", () => this.settingsDialog.close());
      document.querySelector("#done-settings-button").addEventListener("click", () => this.settingsDialog.close());
      document.querySelector("#reset-dashboard-button").addEventListener("click", () => {
        this.settings = cloneDefaults();
        this.syncSettingInputs();
        this.renderWidgetSettings();
        this.renderCustomWidgetSettings();
        this.commitSettings();
      });
      this.settingsDialog.addEventListener("click", (event) => {
        if (event.target === this.settingsDialog) {
          this.settingsDialog.close();
        }
      });

      const bindings = [
        ["#speed-unit", "speedUnit", (value) => value],
        ["#altitude-unit", "altitudeUnit", (value) => value],
        ["#dashboard-layout", "layout", (value) => value],
        ["#dashboard-accent", "accent", (value) => value],
        ["#trail-points", "trailPoints", (value) => clamp(Number(value), 10, 250)],
        ["#airspeed-scale", "airspeedScaleMps", (value) => clamp(Number(value), 5, 200)],
        ["#altitude-scale", "altitudeScaleM", (value) => clamp(Number(value), 10, 5000)],
      ];

      for (const [selector, key, parse] of bindings) {
        document.querySelector(selector).addEventListener("change", (event) => {
          this.settings[key] = parse(event.target.value);
          this.commitSettings();
        });
      }

      document.querySelector("#custom-widget-type").addEventListener("change", () => {
        this.syncCustomFormVisibility();
      });
      document.querySelector("#add-custom-widget-button").addEventListener("click", () => {
        this.addCustomWidget();
      });
      document.querySelector("#export-dashboard-button").addEventListener("click", () => {
        this.exportDashboard();
      });
      document.querySelector("#import-dashboard-button").addEventListener("click", () => {
        document.querySelector("#import-dashboard-file").click();
      });
      document.querySelector("#import-dashboard-file").addEventListener("change", async (event) => {
        const [file] = event.target.files;
        if (!file) {
          return;
        }
        try {
          await this.importDashboard(file);
        } catch (error) {
          document.querySelector("#profile-status").textContent = error.message;
        } finally {
          event.target.value = "";
        }
      });

      this.syncSettingInputs();
      this.syncCustomFormVisibility();
    }

    syncSettingInputs() {
      document.querySelector("#speed-unit").value = this.settings.speedUnit;
      document.querySelector("#altitude-unit").value = this.settings.altitudeUnit;
      document.querySelector("#dashboard-layout").value = this.settings.layout;
      document.querySelector("#dashboard-accent").value = this.settings.accent;
      document.querySelector("#trail-points").value = this.settings.trailPoints;
      document.querySelector("#airspeed-scale").value = this.settings.airspeedScaleMps;
      document.querySelector("#altitude-scale").value = this.settings.altitudeScaleM;
    }

    renderWidgetSettings() {
      const list = document.querySelector("#widget-settings-list");
      list.replaceChildren();

      this.settings.order.forEach((id, index) => {
        const metadata = WIDGETS.find((widget) => widget.id === id);
        const row = document.createElement("div");
        row.className = "widget-setting-row";
        row.innerHTML = `
          <label>
            <input type="checkbox" ${this.settings.visible[id] ? "checked" : ""}>
            <span>${metadata.label}</span>
          </label>
          <div class="reorder-actions">
            <button type="button" class="icon-button" data-direction="up" aria-label="Move ${metadata.label} up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="icon-button" data-direction="down" aria-label="Move ${metadata.label} down" ${index === this.settings.order.length - 1 ? "disabled" : ""}>↓</button>
          </div>`;

        row.querySelector("input").addEventListener("change", (event) => {
          this.settings.visible[id] = event.target.checked;
          this.commitSettings();
        });
        row.querySelectorAll("button").forEach((button) => {
          button.addEventListener("click", () => {
            const destination = button.dataset.direction === "up" ? index - 1 : index + 1;
            const reordered = [...this.settings.order];
            [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
            this.settings.order = reordered;
            this.renderWidgetSettings();
            this.commitSettings();
          });
        });
        list.appendChild(row);
      });
    }

    syncFieldOptions() {
      const select = document.querySelector("#custom-field-select");
      const previousValue = select.value;
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent =
        this.observedMessages.size === 0 ? "Connect and receive MAVLink first" : "Select a MAVLink field";
      select.appendChild(placeholder);

      const messages = Array.from(this.observedMessages.values()).sort((first, second) =>
        first.name.localeCompare(second.name),
      );
      for (const message of messages) {
        const group = document.createElement("optgroup");
        group.label = `${message.name} (#${message.id})`;
        const fields = Array.from(message.fields.values()).sort((first, second) =>
          first.fieldLabel.localeCompare(second.fieldLabel),
        );
        for (const field of fields) {
          const option = document.createElement("option");
          option.value = field.key;
          option.textContent = field.fieldLabel;
          group.appendChild(option);
        }
        select.appendChild(group);
      }
      if (this.fieldRegistry.has(previousValue)) {
        select.value = previousValue;
      }
    }

    syncCustomFormVisibility() {
      const type = document.querySelector("#custom-widget-type").value;
      document.querySelectorAll("[data-custom-option]").forEach((element) => {
        const kinds = element.dataset.customOption.split(" ");
        element.hidden = !kinds.includes(type);
      });
    }

    addCustomWidget() {
      const fieldKey = document.querySelector("#custom-field-select").value;
      const metadata = this.fieldRegistry.get(fieldKey);
      const status = document.querySelector("#custom-widget-status");
      if (!metadata) {
        status.textContent = "Select a field received from the MAVLink stream.";
        return;
      }
      if (this.settings.customWidgets.length >= MAX_CUSTOM_WIDGETS) {
        status.textContent = `The dashboard is limited to ${MAX_CUSTOM_WIDGETS} custom widgets.`;
        return;
      }

      const widget = sanitizeCustomWidget({
        id: createWidgetId(),
        type: document.querySelector("#custom-widget-type").value,
        fieldKey,
        messageName: metadata.messageName,
        fieldLabel: metadata.fieldLabel,
        label: document.querySelector("#custom-widget-label").value,
        unit: document.querySelector("#custom-widget-unit").value,
        decimals: document.querySelector("#custom-widget-decimals").value,
        absolute: document.querySelector("#custom-widget-absolute").checked,
        min: document.querySelector("#custom-widget-min").value,
        max: document.querySelector("#custom-widget-max").value,
        windowSeconds: document.querySelector("#custom-widget-window").value,
      });
      if (!widget) {
        status.textContent = "This widget configuration is invalid.";
        return;
      }

      this.settings.customWidgets.push(widget);
      this.commitSettings();
      this.renderCustomWidgetSettings();
      status.textContent = `${this.customWidgetTitle(widget)} added.`;
      document.querySelector("#custom-widget-label").value = "";
    }

    renderCustomWidgetSettings() {
      const list = document.querySelector("#custom-widget-settings-list");
      list.replaceChildren();
      if (this.settings.customWidgets.length === 0) {
        const empty = document.createElement("p");
        empty.className = "settings-empty";
        empty.textContent = "No custom MAVLink widgets yet.";
        list.appendChild(empty);
        return;
      }

      this.settings.customWidgets.forEach((widget, index) => {
        const row = document.createElement("div");
        row.className = "widget-setting-row custom-widget-setting-row";
        const label = document.createElement("div");
        label.className = "custom-setting-label";
        const strong = document.createElement("strong");
        strong.textContent = this.customWidgetTitle(widget);
        const small = document.createElement("small");
        small.textContent = `${widget.type} · ${widget.messageName}.${widget.fieldLabel}`;
        label.append(strong, small);

        const actions = document.createElement("div");
        actions.className = "reorder-actions";
        const buttons = [
          ["up", "↑", index === 0],
          ["down", "↓", index === this.settings.customWidgets.length - 1],
          ["delete", "×", false],
        ];
        buttons.forEach(([action, text, disabled]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "icon-button";
          button.dataset.action = action;
          button.textContent = text;
          button.disabled = disabled;
          button.setAttribute("aria-label", `${action} ${this.customWidgetTitle(widget)}`);
          button.addEventListener("click", () => {
            if (action === "delete") {
              this.settings.customWidgets.splice(index, 1);
              this.customHistory.delete(widget.id);
            } else {
              const destination = action === "up" ? index - 1 : index + 1;
              [this.settings.customWidgets[index], this.settings.customWidgets[destination]] = [
                this.settings.customWidgets[destination],
                this.settings.customWidgets[index],
              ];
            }
            this.commitSettings();
            this.renderCustomWidgetSettings();
          });
          actions.appendChild(button);
        });
        row.append(label, actions);
        list.appendChild(row);
      });
    }

    exportDashboard() {
      const profile = {
        format: PROFILE_FORMAT,
        version: PROFILE_VERSION,
        exportedAt: new Date().toISOString(),
        settings: this.settings,
      };
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mavmole-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      global.setTimeout(() => URL.revokeObjectURL(url), 0);
      document.querySelector("#profile-status").textContent = "Dashboard profile exported.";
    }

    async importDashboard(file) {
      if (file.size > 512 * 1024) {
        throw new Error("Dashboard profile is too large.");
      }
      const profile = JSON.parse(await file.text());
      if (profile?.format !== PROFILE_FORMAT || !profile.settings) {
        throw new Error("This is not a MavMole dashboard profile.");
      }
      this.settings = normalizeSettings(profile.settings);
      this.customHistory.clear();
      this.syncSettingInputs();
      this.renderWidgetSettings();
      this.renderCustomWidgetSettings();
      this.commitSettings();
      document.querySelector("#profile-status").textContent = `Imported ${this.settings.customWidgets.length} custom widgets.`;
    }

    commitSettings() {
      saveSettings(this.settings);
      this.applySettings();
    }

    applySettings() {
      document.documentElement.style.setProperty("--dashboard-accent", this.settings.accent);
      this.root.dataset.layout = this.settings.layout;

      for (const id of this.settings.order) {
        const widget = this.root.querySelector(`[data-widget="${id}"]`);
        widget.hidden = !this.settings.visible[id];
        this.root.appendChild(widget);
      }
      this.ensureCustomWidgets();

      this.trail = this.trail.slice(-this.settings.trailPoints);
      if (this.state) {
        this.renderPosition(this.state.position);
        this.renderAirspeed(this.state.airspeed);
        this.renderAgl(this.state.agl);
        this.renderBattery(this.state);
      } else {
        this.renderAirspeed(null);
        this.renderAgl(null);
        this.renderBattery(null);
      }
    }
  }

  global.MavMoleDashboard = {
    create() {
      const dashboard = new Dashboard();
      this.current = dashboard;
      return dashboard;
    },
    current: null,
  };
})(window);
