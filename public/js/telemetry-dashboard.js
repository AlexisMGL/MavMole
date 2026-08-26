(function createTelemetryDashboard(global) {
  "use strict";

  const STORAGE_KEY = "mavmole.dashboard.v1";
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
  });

  function cloneDefaults() {
    return {
      ...DEFAULT_SETTINGS,
      order: [...DEFAULT_SETTINGS.order],
      visible: { ...DEFAULT_SETTINGS.visible },
    };
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") {
        return cloneDefaults();
      }

      const knownIds = new Set(WIDGETS.map((widget) => widget.id));
      const savedOrder = Array.isArray(saved.order) ? saved.order.filter((id) => knownIds.has(id)) : [];
      const missingIds = DEFAULT_SETTINGS.order.filter((id) => !savedOrder.includes(id));
      return {
        ...cloneDefaults(),
        ...saved,
        order: [...savedOrder, ...missingIds],
        visible: { ...DEFAULT_SETTINGS.visible, ...(saved.visible || {}) },
      };
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

  class Dashboard {
    constructor() {
      this.root = document.querySelector("#telemetry-grid");
      this.settingsDialog = document.querySelector("#dashboard-settings");
      this.settings = loadSettings();
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;

      this.elements = {
        freshness: document.querySelector("#telemetry-freshness"),
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

      this.bindSettings();
      this.applySettings();
      this.freshnessTimer = global.setInterval(() => this.renderFreshness(), 1000);
    }

    reset() {
      this.state = null;
      this.trail = [];
      this.lastTrailTimestamp = 0;
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
      this.elements.mapLink.href = `https://www.openstreetmap.org/?mlat=${position.lat}&mlon=${position.lon}#map=16/${position.lat}/${position.lon}`;
      this.elements.mapLink.removeAttribute("aria-disabled");
      this.renderTrail(position.heading);
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

    bindSettings() {
      document.querySelector("#customize-dashboard-button").addEventListener("click", () => {
        this.renderWidgetSettings();
        this.settingsDialog.showModal();
      });
      document.querySelector("#close-settings-button").addEventListener("click", () => this.settingsDialog.close());
      document.querySelector("#done-settings-button").addEventListener("click", () => this.settingsDialog.close());
      document.querySelector("#reset-dashboard-button").addEventListener("click", () => {
        this.settings = cloneDefaults();
        this.syncSettingInputs();
        this.renderWidgetSettings();
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

      this.syncSettingInputs();
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
