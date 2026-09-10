"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/js/viewer-map.js"), "utf8");

function setup({ supported = true, secure = true } = {}) {
  const elements = new Map();
  const watches = [];
  const cleared = [];
  const events = new Map();
  const catalogs = { fr: {}, de: {} };
  let locale = "en";
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        disabled: false, hidden: false, textContent: "", dataset: {},
        addEventListener(name, callback) { this[name] = callback; },
      });
      return elements.get(selector);
    },
  };
  const window = {
    document, isSecureContext: secure, WebSocket: { OPEN: 1 },
    navigator: { geolocation: supported ? {
      watchPosition(success, failure, options) { watches.push({ success, failure, options }); return watches.length; },
      clearWatch(id) { cleared.push(id); },
    } : undefined },
    addEventListener(name, callback) { events.set(name, callback); },
    MavMoleI18n: {
      register(values) { for (const code of ["fr", "de"]) Object.assign(catalogs[code], values[code]); },
      t(key) { return catalogs[locale]?.[key] || key; },
    },
  };
  vm.runInNewContext(source, { window, document });
  const client = window.MavMoleViewerLocations.createSharing();
  const socket = { readyState: 1, sent: [], send(value) { this.sent.push(JSON.parse(value)); } };
  return {
    client, socket, watches, cleared,
    share: elements.get("#share-location-button"),
    stop: elements.get("#stop-sharing-location-button"),
    status: elements.get("#location-sharing-status"),
    language(code) { locale = code; events.get("mavmole:languagechange")(); },
  };
}

const position = { coords: { latitude: 48.85, longitude: 2.35, accuracy: 10 } };

test("location sharing never requests permission or transmits until the viewer explicitly starts it", () => {
  const env = setup();
  assert.equal(env.share.disabled, true);
  env.client.connect(env.socket);
  assert.equal(env.share.disabled, false);
  assert.equal(env.watches.length, 0);
  assert.deepEqual(env.socket.sent, []);
  env.share.click();
  assert.equal(env.watches.length, 1);
  assert.equal(env.watches[0].options.maximumAge, 0);
  assert.equal(env.stop.hidden, false);
  assert.match(env.status.textContent, /permission/);
  env.watches[0].success(position);
  assert.deepEqual(env.socket.sent, [{ type: "viewer.location.share", location: position.coords }]);
  env.client.handleControl({ type: "viewer.location.status", sharing: true });
  assert.match(env.status.textContent, /Sharing your location/);
  env.language("fr");
  assert.match(env.status.textContent, /position est partagée/);
  env.language("de");
  assert.match(env.status.textContent, /Standort/);
});

test("stop and reconnect invalidate pending callbacks and require a fresh explicit opt-in", () => {
  const env = setup();
  env.client.connect(env.socket);
  env.share.click();
  env.watches[0].success(position);
  env.stop.click();
  assert.deepEqual(env.cleared, [1]);
  assert.equal(env.socket.sent.at(-1).type, "viewer.location.stop");
  const stoppedCount = env.socket.sent.length;
  env.watches[0].success(position);
  env.client.handleControl({ type: "viewer.location.status", sharing: true });
  assert.equal(env.socket.sent.length, stoppedCount);
  assert.match(env.status.textContent, /stopped/);

  env.share.click();
  env.client.disconnect();
  const nextSocket = { ...env.socket, sent: [] };
  env.client.connect(nextSocket);
  env.watches[1].success(position);
  env.watches[1].failure({ code: 1 });
  assert.deepEqual(nextSocket.sent, []);
  assert.match(env.status.textContent, /not shared/);
  assert.equal(env.stop.hidden, true);
  assert.equal(env.watches.length, 2);
});

test("denied, timed out, unsupported and insecure geolocation have actionable states", () => {
  for (const [code, message] of [[1, /denied/], [2, /unavailable/], [3, /timed out/]]) {
    const env = setup();
    env.client.connect(env.socket);
    env.share.click();
    env.watches[0].failure({ code });
    assert.match(env.status.textContent, message);
    assert.equal(env.stop.hidden, true);
    assert.deepEqual(env.cleared, [1]);
    assert.equal(env.socket.sent.some((message) => message.type === "viewer.location.share"), false);
  }
  for (const options of [{ supported: false }, { secure: false }]) {
    const env = setup(options);
    env.client.connect(env.socket);
    assert.equal(env.share.disabled, true);
    env.share.click();
    assert.equal(env.watches.length, 0);
    assert.match(env.status.textContent, options.secure === false ? /HTTPS/ : /not support/);
  }
});

test("losing geolocation access after sharing withdraws the existing location", () => {
  const env = setup();
  env.client.connect(env.socket);
  env.share.click();
  env.watches[0].success(position);
  env.watches[0].failure({ code: 1 });
  assert.deepEqual(env.socket.sent.map((message) => message.type), ["viewer.location.share", "viewer.location.stop"]);
  assert.equal(env.stop.hidden, true);
});
