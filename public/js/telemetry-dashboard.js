(function createTelemetryDashboard(global) {
  "use strict";

  const STORAGE_KEY = "mavmole.dashboard.v1";
  const ESRI_SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const PROFILE_FORMAT = "mavmole-dashboard";
  const PROFILE_VERSION = 4;
  const SETTINGS_VERSION = 2;
  const CUSTOM_WIDGET_TYPES = new Set(["value", "chart", "gauge"]);
  const MAX_CUSTOM_WIDGETS = 32;
  const MAX_HISTORY_POINTS = 240;
  const WIDGETS = Object.freeze([
    { id: "position", label: "Position", defaultVisible: true },
    { id: "airspeed", label: "Airspeed", defaultVisible: true },
    { id: "agl", label: "AGL altitude", defaultVisible: true },
    { id: "battery", label: "Battery", defaultVisible: true },
    { id: "gnss", label: "GNSS dashboard", defaultVisible: false },
    { id: "misc", label: "Misc dashboard", defaultVisible: false },
    { id: "temperature", label: "ESC temperature", defaultVisible: false },
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: SETTINGS_VERSION,
    order: WIDGETS.map((widget) => widget.id),
    visible: Object.fromEntries(WIDGETS.map((widget) => [widget.id, widget.defaultVisible])),
    speedUnit: "mps",
    altitudeUnit: "m",
    layout: "balanced",
    accent: "#b86238",
    trailPoints: 80,
    airspeedScaleMps: 50,
    altitudeScaleM: 150,
    miscThresholds: {
      imu: 1.2,
      airspeed: 50,
      current: 120,
    },
    customWidgets: [],
  });

  function cloneDefaults() {
    return {
      ...DEFAULT_SETTINGS,
      order: [...DEFAULT_SETTINGS.order],
      visible: { ...DEFAULT_SETTINGS.visible },
      miscThresholds: { ...DEFAULT_SETTINGS.miscThresholds },
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
    const savedSettingsVersion = Number(saved.settingsVersion) || 1;
    const visible = Object.fromEntries(WIDGETS.map((widget) => {
      const hasSavedValue = Object.prototype.hasOwnProperty.call(saved.visible || {}, widget.id);
      if (savedSettingsVersion < SETTINGS_VERSION && !widget.defaultVisible) {
        return [widget.id, false];
      }
      return [widget.id, hasSavedValue ? saved.visible[widget.id] !== false : widget.defaultVisible];
    }));
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
      miscThresholds: {
        imu: clamp(Number(saved.miscThresholds?.imu) || DEFAULT_SETTINGS.miscThresholds.imu, 0.1, 20),
        airspeed: clamp(
          Number(saved.miscThresholds?.airspeed) || DEFAULT_SETTINGS.miscThresholds.airspeed,
          1,
          250,
        ),
        current: clamp(
          Number(saved.miscThresholds?.current) || DEFAULT_SETTINGS.miscThresholds.current,
          1,
          1000,
        ),
      },
      customWidgets,
    };
  }

  function loadSettings(storageKey = STORAGE_KEY) {
    try {
      const saved = JSON.parse(global.localStorage.getItem(storageKey));
      if (!saved || typeof saved !== "object") {
        return cloneDefaults();
      }

      return normalizeSettings(saved);
    } catch (_error) {
      return cloneDefaults();
    }
  }

  function saveSettings(settings, storageKey = STORAGE_KEY) {
    try {
      global.localStorage.setItem(storageKey, JSON.stringify(settings));
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

  class SatelliteMap {
    constructor(container, statusElement, setupElement, setupTitle, setupDetail) {
      this.container = container;
      this.statusElement = statusElement;
      this.setupElement = setupElement;
      this.setupTitle = setupTitle;
      this.setupDetail = setupDetail;
      this.map = null;
      this.marker = null;
      this.polyline = null;
      this.tileLayer = null;
      this.pendingTrail = [];
      this.hasPosition = false;
      this.loadTimer = null;
      this.initialize();
    }

    initialize() {
      try {
        const leaflet = global.L;
        if (!leaflet?.map || !leaflet?.tileLayer) {
          throw new Error("Leaflet could not be loaded from the map provider.");
        }

        this.map = leaflet.map(this.container, {
          center: [0, 0],
          zoom: 2,
          zoomControl: false,
          attributionControl: true,
          keyboard: false,
          worldCopyJump: true,
        });
        this.polyline = leaflet.polyline([], {
          color: "#f07a3c",
          opacity: 0.95,
          weight: 3,
          interactive: false,
        }).addTo(this.map);
        this.tileLayer = leaflet.tileLayer(ESRI_SATELLITE_TILES, {
          attribution: "Tiles &copy; Esri",
          maxZoom: 20,
        });
        let loadedTiles = 0;
        const markReady = () => {
          if (loadedTiles === 0) {
            this.showFailure(new Error("Esri World Imagery did not return map tiles."));
            return;
          }
          global.clearTimeout(this.loadTimer);
          this.container.parentElement.dataset.mapState = "satellite";
          this.setupElement.hidden = true;
          this.statusElement.textContent = "Satellite";
          this.statusElement.title = "Esri World Imagery";
        };
        this.tileLayer.on("tileload", () => {
          loadedTiles += 1;
        });
        this.tileLayer.once("load", markReady);
        this.tileLayer.addTo(this.map);
        this.loadTimer = global.setTimeout(() => {
          if (this.container.parentElement.dataset.mapState !== "satellite") {
            this.showFailure(new Error("Esri World Imagery did not return map tiles."));
          }
        }, 8000);

        if (global.ResizeObserver) {
          this.resizeObserver = new global.ResizeObserver(() => this.map?.invalidateSize({ pan: false }));
          this.resizeObserver.observe(this.container);
        }
        this.update(this.pendingTrail);
      } catch (error) {
        this.showFailure(error);
      }
    }

    createMarker(position) {
      const icon = global.L.divIcon({
        className: "mavmole-map-marker",
        html: `
          <span class="aircraft-map-symbol" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 1 L19 21 L12 17 L5 21 Z"></path></svg>
          </span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      this.marker = global.L.marker(position, {
        icon,
        interactive: false,
        keyboard: false,
        title: "Aircraft",
        zIndexOffset: 500,
      }).addTo(this.map);
    }

    showFailure(error) {
      global.clearTimeout(this.loadTimer);
      this.container.parentElement.dataset.mapState = "error";
      this.statusElement.textContent = "Satellite unavailable";
      this.statusElement.title = error.message;
      this.setupTitle.textContent = "Satellite imagery could not load";
      this.setupDetail.textContent = `${error.message} Check the internet connection and retry.`;
      this.setupElement.hidden = false;
    }

    reset() {
      this.pendingTrail = [];
      this.hasPosition = false;
      this.polyline?.setLatLngs([]);
      if (this.marker && this.map) {
        this.map.removeLayer(this.marker);
        this.marker = null;
      }
      this.map?.setView([0, 0], 2, { animate: false });
    }

    update(trail) {
      this.pendingTrail = trail;
      if (!this.map || trail.length === 0) {
        return;
      }

      const path = trail.map((point) => [point.lat, point.lon]);
      const last = trail.at(-1);
      const position = path.at(-1);
      this.polyline.setLatLngs(path);
      if (!this.marker) {
        this.createMarker(position);
      } else {
        this.marker.setLatLng(position);
      }
      const symbol = this.marker.getElement()?.querySelector(".aircraft-map-symbol");
      if (symbol) {
        const heading = Number.isFinite(last.heading) ? last.heading : 0;
        symbol.style.transform = `rotate(${heading}deg)`;
      }

      if (!this.hasPosition) {
        this.map.setView(position, 18, { animate: false });
        this.hasPosition = true;
      } else {
        this.map.panTo(position, { animate: false });
      }
    }
  }

  function validCoordinates(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function normalizeCourse(course) {
    return Number.isFinite(course) ? ((course % 360) + 360) % 360 : null;
  }

  function messageMatches(decoded, messageId, messageName) {
    return decoded.messageId === messageId || decoded.messageName === messageName;
  }

  function renderPolyline(element, samples, now, windowMs, minimum, maximum, width = 300, height = 100) {
    if (!element || samples.length === 0 || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      element?.setAttribute("points", "");
      return;
    }
    const span = Math.max(maximum - minimum, 0.0001);
    const start = now - windowMs;
    const points = samples
      .filter((sample) => sample.time >= start)
      .map((sample) => {
        const x = clamp(((sample.time - start) / windowMs) * width, 0, width);
        const y = height - clamp(((sample.value - minimum) / span) * height, 0, height);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
    element.setAttribute("points", points.join(" "));
  }

  function longestAbove(samples, threshold, now) {
    if (samples.length === 0) {
      return 0;
    }
    let longest = 0;
    let startedAt = null;
    let previous = null;
    for (const sample of samples) {
      if (sample.value > threshold && startedAt === null) {
        startedAt = previous && previous.value <= threshold ? sample.time : sample.time;
      } else if (sample.value <= threshold && startedAt !== null) {
        longest = Math.max(longest, sample.time - startedAt);
        startedAt = null;
      }
      previous = sample;
    }
    if (startedAt !== null) {
      longest = Math.max(longest, now - startedAt);
    }
    return longest / 1000;
  }

  function linearTrend(samples, now) {
    const recent = samples.filter((sample) => sample.time >= now - 10000);
    if (recent.length < 2 || recent.at(-1).time - recent[0].time < 2000) {
      return null;
    }
    const origin = recent[0].time;
    const points = recent.map((sample) => ({ x: (sample.time - origin) / 1000, y: sample.value }));
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    if (denominator === 0) {
      return null;
    }
    const slope = points.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    ) / denominator;
    return { slope, value: recent.at(-1).value, time: recent.at(-1).time };
  }

  class GnssMap {
    constructor(container, emptyElement) {
      this.container = container;
      this.emptyElement = emptyElement;
      this.map = null;
      this.markers = new Map();
      this.trails = new Map();
      this.hasPosition = false;
      this.sources = {
        pos: { label: "POS", color: "#3478c7", zIndex: 500 },
        gps1: { label: "GPS1", color: "#e57b25", zIndex: 510 },
        gps2: { label: "GPS2", color: "#2e9b68", zIndex: 520 },
      };
      this.initialize();
    }

    initialize() {
      try {
        if (!global.L?.map || !global.L?.tileLayer) {
          throw new Error("Leaflet is unavailable");
        }
        this.map = global.L.map(this.container, {
          center: [0, 0],
          zoom: 2,
          zoomControl: true,
          attributionControl: true,
          keyboard: false,
          worldCopyJump: true,
        });
        global.L.tileLayer(ESRI_SATELLITE_TILES, {
          attribution: "Tiles &copy; Esri",
          maxZoom: 20,
        }).addTo(this.map);
        for (const [key, source] of Object.entries(this.sources)) {
          this.trails.set(
            key,
            global.L.polyline([], {
              color: source.color,
              opacity: 0.9,
              weight: 2.5,
              interactive: false,
            }).addTo(this.map),
          );
        }
        if (global.ResizeObserver) {
          this.resizeObserver = new global.ResizeObserver(() => this.map?.invalidateSize({ pan: false }));
          this.resizeObserver.observe(this.container);
        }
      } catch (error) {
        this.emptyElement.textContent = `GNSS map unavailable: ${error.message}`;
      }
    }

    createMarker(key, source, position) {
      const config = this.sources[key];
      const icon = global.L.divIcon({
        className: "gnss-map-marker",
        html: `<span class="gnss-marker-symbol" style="--gnss-source:${config.color}" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 1 L17 19 L10 15 L3 19 Z"></path></svg></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const marker = global.L.marker(position, {
        icon,
        title: config.label,
        zIndexOffset: config.zIndex,
      }).addTo(this.map);
      marker.bindTooltip(config.label, { direction: "top", offset: [0, -8] });
      this.markers.set(key, marker);
    }

    update(key, source) {
      if (!this.map || !validCoordinates(source.lat, source.lon)) {
        return;
      }
      const position = [source.lat, source.lon];
      const marker = this.markers.get(key);
      if (marker) {
        marker.setLatLng(position);
      } else {
        this.createMarker(key, source, position);
      }
      const symbol = this.markers.get(key)?.getElement()?.querySelector(".gnss-marker-symbol");
      if (symbol) {
        symbol.style.transform = `rotate(${Number.isFinite(source.course) ? source.course : 0}deg)`;
      }
      this.trails.get(key)?.setLatLngs(source.trail.map((point) => [point.lat, point.lon]));
      this.emptyElement.hidden = true;
      if (!this.hasPosition) {
        this.map.setView(position, 18, { animate: false });
        this.hasPosition = true;
      } else if (key === "pos" || !this.markers.has("pos")) {
        this.map.panTo(position, { animate: false });
      }
    }

    invalidate() {
      global.setTimeout(() => this.map?.invalidateSize({ pan: false }), 0);
    }

    reset() {
      for (const marker of this.markers.values()) {
        this.map?.removeLayer(marker);
      }
      this.markers.clear();
      for (const trail of this.trails.values()) {
        trail.setLatLngs([]);
      }
      this.hasPosition = false;
      this.emptyElement.hidden = false;
      this.emptyElement.textContent = "Waiting for GNSS positions";
      this.map?.setView([0, 0], 2, { animate: false });
    }
  }

  class Dashboard {
    constructor(options = {}) {
      this.root = document.querySelector("#telemetry-grid");
      this.settingsDialog = document.querySelector("#dashboard-settings");
      this.storageKey = options.storageKey || STORAGE_KEY;
      this.settings = loadSettings(this.storageKey);
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;
      this.fieldRegistry = new Map();
      this.observedMessages = new Map();
      this.customHistory = new Map();
      this.gnssState = {
        pos: { trail: [], updatedAt: 0 },
        gps1: { trail: [], updatedAt: 0 },
        gps2: { trail: [], updatedAt: 0 },
        satelliteHistory: [],
      };
      this.miscState = {
        imu: { samples: [], updatedAt: 0, value: null },
        airspeed: { samples: [], updatedAt: 0, value: null },
        current: { samples: [], updatedAt: 0, value: null },
      };
      this.temperatureState = {
        histories: Array.from({ length: 4 }, () => []),
        values: Array(4).fill(null),
        updatedAt: 0,
      };

      this.elements = {
        freshness: document.querySelector("#telemetry-freshness"),
        satelliteMap: document.querySelector("#satellite-map"),
        mapProviderStatus: document.querySelector("#map-provider-status"),
        mapSetup: document.querySelector("#map-setup"),
        mapSetupTitle: document.querySelector("#map-setup-title"),
        mapSetupDetail: document.querySelector("#map-setup-detail"),
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
        gnssEmpty: document.querySelector("#gnss-map-empty"),
        gnssPos: document.querySelector("#gnss-pos-readout"),
        gnssGps1: document.querySelector("#gnss-gps1-readout"),
        gnssGps2: document.querySelector("#gnss-gps2-readout"),
        gnssGps1Status: document.querySelector("#gnss-gps1-status"),
        gnssGps2Status: document.querySelector("#gnss-gps2-status"),
        gnssPosCourse: document.querySelector("#gnss-pos-course"),
        gnssGps1Course: document.querySelector("#gnss-gps1-course"),
        gnssGps2Course: document.querySelector("#gnss-gps2-course"),
        gnssPosCourseArrow: document.querySelector("#gnss-pos-course-arrow"),
        gnssGps1CourseArrow: document.querySelector("#gnss-gps1-course-arrow"),
        gnssGps2CourseArrow: document.querySelector("#gnss-gps2-course-arrow"),
        gnssDrift: document.querySelector("#gnss-drift-value"),
        gnssPosOffset: document.querySelector("#gnss-position-offset"),
        gnssSatCurrent: document.querySelector("#gnss-sat-current"),
        gnssSatLine: document.querySelector("#gnss-sat-line"),
        gnssSatThreshold: document.querySelector("#gnss-sat-threshold"),
        misc: Object.fromEntries(
          ["imu", "airspeed", "current"].map((key) => [key, {
            value: document.querySelector(`#misc-${key}-value`),
            status: document.querySelector(`#misc-${key}-status`),
            longest: document.querySelector(`#misc-${key}-longest`),
            line: document.querySelector(`#misc-${key}-line`),
            thresholdLine: document.querySelector(`#misc-${key}-threshold-line`),
            threshold: document.querySelector(`#misc-${key}-threshold`),
          }]),
        ),
        escValues: Array.from({ length: 4 }, (_, index) => document.querySelector(`#esc-${index + 1}-value`)),
        escCards: Array.from({ length: 4 }, (_, index) => document.querySelector(`#esc-${index + 1}-card`)),
        escLines: Array.from({ length: 4 }, (_, index) => document.querySelector(`#esc-${index + 1}-line`)),
        escForecasts: Array.from(
          { length: 4 },
          (_, index) => document.querySelector(`#esc-${index + 1}-forecast`),
        ),
        escWarningLine: document.querySelector("#esc-warning-line"),
        escCriticalLine: document.querySelector("#esc-critical-line"),
        escSpread: document.querySelector("#esc-spread"),
        escShutdown: document.querySelector("#esc-shutdown"),
        escStatus: document.querySelector("#esc-status"),
      };

      this.satelliteMap = new SatelliteMap(
        this.elements.satelliteMap,
        this.elements.mapProviderStatus,
        this.elements.mapSetup,
        this.elements.mapSetupTitle,
        this.elements.mapSetupDetail,
      );
      this.gnssMap = new GnssMap(document.querySelector("#gnss-map"), this.elements.gnssEmpty);

      this.bindSettings();
      this.bindAdvancedWidgets();
      this.applySettings();
      this.freshnessTimer = global.setInterval(() => {
        this.renderFreshness();
        this.renderAdvancedWidgets();
      }, 1000);
    }

    reset() {
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;
      this.fieldRegistry.clear();
      this.observedMessages.clear();
      this.customHistory.clear();
      this.gnssState = {
        pos: { trail: [], updatedAt: 0 },
        gps1: { trail: [], updatedAt: 0 },
        gps2: { trail: [], updatedAt: 0 },
        satelliteHistory: [],
      };
      for (const metric of Object.values(this.miscState)) {
        metric.samples = [];
        metric.updatedAt = 0;
        metric.value = null;
      }
      this.temperatureState.histories = Array.from({ length: 4 }, () => []);
      this.temperatureState.values = Array(4).fill(null);
      this.temperatureState.updatedAt = 0;
      this.satelliteMap.reset();
      this.gnssMap.reset();
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
      this.renderAdvancedWidgets();
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

      this.ingestGnss(decoded, now);
      this.ingestMisc(decoded, now);
      this.ingestEscTemperature(decoded, now);

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

    ingestGnss(decoded, now) {
      let key = null;
      if (messageMatches(decoded, 33, "GLOBAL_POSITION_INT")) {
        key = "pos";
      } else if (messageMatches(decoded, 24, "GPS_RAW_INT")) {
        key = "gps1";
      } else if (messageMatches(decoded, 124, "GPS2_RAW")) {
        key = "gps2";
      }
      if (!key) {
        return;
      }

      const fields = decoded.fields;
      const source = this.gnssState[key];
      const lat = Number(fields.lat) / 1e7;
      const lon = Number(fields.lon) / 1e7;
      source.updatedAt = now;
      source.fix = Number.isFinite(Number(fields.fix_type)) ? Number(fields.fix_type) : null;
      const satellites = Number(fields.satellites_visible);
      source.satellites = Number.isFinite(satellites) && satellites !== 255 ? satellites : null;
      const eph = Number(fields.eph);
      source.hdop = Number.isFinite(eph) && eph !== 65535 ? eph / 100 : null;
      source.altitude = Number.isFinite(Number(fields.alt)) ? Number(fields.alt) / 1000 : null;
      if (key === "pos") {
        const vx = Number(fields.vx);
        const vy = Number(fields.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy) && Math.hypot(vx, vy) > 1) {
          source.course = normalizeCourse(Math.atan2(vy, vx) * 180 / Math.PI);
        } else {
          const heading = Number(fields.hdg);
          source.course = heading === 65535 ? null : normalizeCourse(heading / 100);
        }
      } else {
        const courseOverGround = Number(fields.cog);
        source.course = courseOverGround === 65535 ? null : normalizeCourse(courseOverGround / 100);
      }

      if (validCoordinates(lat, lon) && !(lat === 0 && lon === 0)) {
        source.lat = lat;
        source.lon = lon;
        const previous = source.trail.at(-1);
        if (!previous || distanceMeters(previous, source) >= 0.1) {
          source.trail.push({ lat, lon, time: now });
          source.trail = source.trail.slice(-160);
        }
        this.gnssMap.update(key, source);
      }

      if (key === "gps2" && Number.isFinite(source.satellites)) {
        this.gnssState.satelliteHistory.push({ time: now, value: source.satellites });
        this.gnssState.satelliteHistory = this.gnssState.satelliteHistory
          .filter((sample) => sample.time >= now - 60000)
          .slice(-MAX_HISTORY_POINTS);
      }
      this.renderGnss(now);
    }

    recordMisc(key, value, now) {
      if (!Number.isFinite(value)) {
        return;
      }
      const metric = this.miscState[key];
      metric.value = value;
      metric.updatedAt = now;
      metric.samples.push({ time: now, value });
      metric.samples = metric.samples.filter((sample) => sample.time >= now - 60000).slice(-MAX_HISTORY_POINTS);
      this.renderMiscMetric(key, now);
    }

    ingestMisc(decoded, now) {
      const fields = decoded.fields;
      if (messageMatches(decoded, 27, "RAW_IMU")) {
        const imuId = Number(fields.id);
        if (!Number.isFinite(imuId) || imuId === 0) {
          this.recordMisc("imu", Number(fields.xacc) / 1000, now);
        }
      } else if (messageMatches(decoded, 74, "VFR_HUD")) {
        this.recordMisc("airspeed", Number(fields.airspeed), now);
      } else if (messageMatches(decoded, 147, "BATTERY_STATUS")) {
        const batteryId = Number(fields.id);
        if (!Number.isFinite(batteryId) || batteryId === 0) {
          this.recordMisc("current", Math.abs(Number(fields.current_battery)) / 100, now);
        }
      }
    }

    ingestEscTemperature(decoded, now) {
      if (!messageMatches(decoded, 11030, "ESC_TELEMETRY_1_TO_4")) {
        return;
      }
      const temperatures = Array.from(decoded.fields.temperature || []).slice(0, 4);
      let received = false;
      temperatures.forEach((rawValue, index) => {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0 || value >= 255) {
          return;
        }
        received = true;
        this.temperatureState.values[index] = value;
        this.temperatureState.histories[index].push({ time: now, value });
        this.temperatureState.histories[index] = this.temperatureState.histories[index]
          .filter((sample) => sample.time >= now - 60000)
          .slice(-MAX_HISTORY_POINTS);
      });
      if (received) {
        this.temperatureState.updatedAt = now;
        this.renderEscTemperature(now);
      }
    }

    bindAdvancedWidgets() {
      for (const key of ["imu", "airspeed", "current"]) {
        const input = this.elements.misc[key].threshold;
        input.value = this.settings.miscThresholds[key];
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value <= 0) {
            input.value = this.settings.miscThresholds[key];
            return;
          }
          this.settings.miscThresholds[key] = value;
          this.commitSettings();
          this.renderMiscMetric(key);
        });
      }
    }

    renderAdvancedWidgets(now = Date.now()) {
      this.renderGnss(now);
      for (const key of ["imu", "airspeed", "current"]) {
        this.renderMiscMetric(key, now);
      }
      this.renderEscTemperature(now);
    }

    renderGnss(now = Date.now()) {
      const renderSource = (key, element, statusElement) => {
        const source = this.gnssState[key];
        if (!validCoordinates(source.lat, source.lon)) {
          element.textContent = "Waiting for position";
          if (statusElement) {
            statusElement.textContent = "No data";
            statusElement.dataset.state = "waiting";
          }
          return;
        }
        const details = [`${source.lat.toFixed(7)}, ${source.lon.toFixed(7)}`];
        if (Number.isFinite(source.fix)) {
          details.push(`fix ${source.fix}`);
        }
        if (Number.isFinite(source.satellites)) {
          details.push(`${source.satellites} sats`);
        }
        if (Number.isFinite(source.hdop)) {
          details.push(`HDOP ${source.hdop.toFixed(2)}`);
        }
        element.textContent = details.join(" · ");
        if (statusElement) {
          const stale = now - source.updatedAt >= 5000;
          statusElement.textContent = stale ? `${Math.round((now - source.updatedAt) / 1000)}s old` : "Live";
          statusElement.dataset.state = stale ? "stale" : "live";
        }
      };

      renderSource("pos", this.elements.gnssPos, null);
      renderSource("gps1", this.elements.gnssGps1, this.elements.gnssGps1Status);
      renderSource("gps2", this.elements.gnssGps2, this.elements.gnssGps2Status);

      const renderCourse = (source, valueElement, arrowElement) => {
        if (!Number.isFinite(source.course)) {
          valueElement.textContent = "—";
          arrowElement.dataset.state = "waiting";
          arrowElement.style.transform = "rotate(0deg)";
          return;
        }
        valueElement.textContent = `${source.course.toFixed(1)}°`;
        arrowElement.dataset.state = "live";
        arrowElement.style.transform = `rotate(${source.course}deg)`;
      };
      renderCourse(this.gnssState.pos, this.elements.gnssPosCourse, this.elements.gnssPosCourseArrow);
      renderCourse(this.gnssState.gps1, this.elements.gnssGps1Course, this.elements.gnssGps1CourseArrow);
      renderCourse(this.gnssState.gps2, this.elements.gnssGps2Course, this.elements.gnssGps2CourseArrow);

      const gps1 = this.gnssState.gps1;
      const gps2 = this.gnssState.gps2;
      const pos = this.gnssState.pos;
      this.elements.gnssDrift.textContent = validCoordinates(gps1.lat, gps1.lon) && validCoordinates(gps2.lat, gps2.lon)
        ? `${distanceMeters(gps1, gps2).toFixed(2)} m`
        : "—";
      this.elements.gnssPosOffset.textContent = validCoordinates(pos.lat, pos.lon) && validCoordinates(gps1.lat, gps1.lon)
        ? `${distanceMeters(pos, gps1).toFixed(2)} m`
        : "—";
      this.elements.gnssSatCurrent.textContent = Number.isFinite(gps2.satellites)
        ? `${gps2.satellites} satellites`
        : "Waiting for GPS2";

      const samples = this.gnssState.satelliteHistory;
      const maximum = Math.max(20, ...samples.map((sample) => sample.value));
      renderPolyline(this.elements.gnssSatLine, samples, now, 60000, 0, maximum, 300, 74);
      const thresholdY = 74 - clamp((10 / maximum) * 74, 0, 74);
      this.elements.gnssSatThreshold.setAttribute("y1", thresholdY.toFixed(1));
      this.elements.gnssSatThreshold.setAttribute("y2", thresholdY.toFixed(1));
    }

    renderMiscMetric(key, now = Date.now()) {
      const definitions = {
        imu: { unit: "g", decimals: 2 },
        airspeed: { unit: "m/s", decimals: 1 },
        current: { unit: "A", decimals: 1 },
      };
      const definition = definitions[key];
      const metric = this.miscState[key];
      const elements = this.elements.misc[key];
      const threshold = this.settings.miscThresholds[key];
      elements.threshold.value = threshold;
      elements.value.textContent = Number.isFinite(metric.value)
        ? `${metric.value.toFixed(definition.decimals)} ${definition.unit}`
        : "—";
      const stale = metric.updatedAt === 0 || now - metric.updatedAt >= 5000;
      elements.status.textContent = metric.updatedAt === 0
        ? "Waiting for MAVLink"
        : stale
          ? `${Math.round((now - metric.updatedAt) / 1000)}s old`
          : metric.value > threshold
            ? "Above threshold"
            : "Live";
      elements.status.dataset.state = metric.updatedAt === 0 ? "waiting" : stale ? "stale" : metric.value > threshold ? "alert" : "live";
      elements.longest.textContent = `${longestAbove(metric.samples, threshold, now).toFixed(1)} s longest`;

      const values = [...metric.samples.map((sample) => sample.value), threshold];
      let minimum = values.length > 0 ? Math.min(...values) : 0;
      let maximum = values.length > 0 ? Math.max(...values) : threshold;
      const padding = Math.max((maximum - minimum) * 0.15, Math.abs(threshold) * 0.08, 0.2);
      minimum = Math.min(0, minimum - padding);
      maximum += padding;
      renderPolyline(elements.line, metric.samples, now, 60000, minimum, maximum, 300, 86);
      const thresholdY = 86 - ((threshold - minimum) / Math.max(maximum - minimum, 0.001)) * 86;
      elements.thresholdLine.setAttribute("y1", thresholdY.toFixed(1));
      elements.thresholdLine.setAttribute("y2", thresholdY.toFixed(1));
    }

    renderEscTemperature(now = Date.now()) {
      const warning = 55;
      const critical = 85;
      const stale = this.temperatureState.updatedAt === 0 || now - this.temperatureState.updatedAt >= 5000;
      const currentValues = this.temperatureState.values.filter(Number.isFinite);
      const allValues = this.temperatureState.histories.flat().map((sample) => sample.value);
      const trends = this.temperatureState.histories.map((history) => linearTrend(history, now));
      const forecastValues = trends
        .filter(Boolean)
        .map((trend) => trend.value + trend.slope * Math.max((now + 20000 - trend.time) / 1000, 0));
      const minimum = Math.min(20, ...allValues, ...forecastValues);
      const maximum = Math.max(90, ...allValues, ...forecastValues) + 5;
      const yFor = (value) => 100 - clamp(((value - minimum) / Math.max(maximum - minimum, 1)) * 100, 0, 100);

      this.temperatureState.histories.forEach((history, index) => {
        renderPolyline(this.elements.escLines[index], history, now, 60000, minimum, maximum, 225, 100);
        const trend = trends[index];
        const forecast = this.elements.escForecasts[index];
        if (trend) {
          const atNow = trend.value + trend.slope * Math.max((now - trend.time) / 1000, 0);
          const atFuture = trend.value + trend.slope * Math.max((now + 20000 - trend.time) / 1000, 0);
          forecast.setAttribute("x1", "225");
          forecast.setAttribute("y1", yFor(atNow).toFixed(1));
          forecast.setAttribute("x2", "300");
          forecast.setAttribute("y2", yFor(atFuture).toFixed(1));
          forecast.hidden = false;
        } else {
          forecast.hidden = true;
        }

        const value = this.temperatureState.values[index];
        this.elements.escValues[index].textContent = Number.isFinite(value) ? `${value.toFixed(0)} °C` : "—";
        this.elements.escCards[index].dataset.state = stale || !Number.isFinite(value)
          ? "stale"
          : value >= critical
            ? "critical"
            : value >= warning
              ? "warning"
              : "normal";
      });

      for (const [element, value] of [[this.elements.escWarningLine, warning], [this.elements.escCriticalLine, critical]]) {
        const y = yFor(value).toFixed(1);
        element.setAttribute("y1", y);
        element.setAttribute("y2", y);
      }
      this.elements.escSpread.textContent = currentValues.length > 1
        ? `${(Math.max(...currentValues) - Math.min(...currentValues)).toFixed(1)} °C`
        : "—";
      const shutdownTimes = trends
        .map((trend) => trend && trend.slope > 0.02 ? (critical - trend.value) / trend.slope : null)
        .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
      this.elements.escShutdown.textContent = shutdownTimes.length > 0
        ? `${Math.min(...shutdownTimes).toFixed(0)} s`
        : "No rising trend";
      this.elements.escStatus.textContent = this.temperatureState.updatedAt === 0
        ? "Waiting for ESC_TELEMETRY_1_TO_4"
        : stale
          ? `Last update ${Math.round((now - this.temperatureState.updatedAt) / 1000)}s ago`
          : "60s history · 20s linear forecast";
      this.elements.escStatus.dataset.state = this.temperatureState.updatedAt === 0 ? "waiting" : stale ? "stale" : "live";
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
      const openSettings = () => {
        this.renderWidgetSettings();
        this.renderCustomWidgetSettings();
        this.syncFieldOptions();
        this.settingsDialog.showModal();
      };
      document.querySelector("#customize-dashboard-button").addEventListener("click", () => openSettings());
      document.querySelector("#retry-map-button").addEventListener("click", () => global.location.reload());
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
      for (const key of ["imu", "airspeed", "current"]) {
        if (this.elements.misc?.[key]?.threshold) {
          this.elements.misc[key].threshold.value = this.settings.miscThresholds[key];
        }
      }
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
      saveSettings(this.settings, this.storageKey);
      this.applySettings();
    }

    applySettings() {
      document.documentElement.style.setProperty("--dashboard-accent", this.settings.accent);
      this.root.dataset.layout = this.settings.layout;

      for (const id of this.settings.order) {
        const widget = this.root.querySelector(`[data-widget="${id}"]`);
        if (!widget) {
          continue;
        }
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
      this.renderAdvancedWidgets();
      if (this.settings.visible.gnss) {
        this.gnssMap.invalidate();
      }
    }
  }

  global.MavMoleDashboard = {
    create(options = {}) {
      const dashboard = new Dashboard(options);
      this.current = dashboard;
      return dashboard;
    },
    current: null,
  };
})(window);
