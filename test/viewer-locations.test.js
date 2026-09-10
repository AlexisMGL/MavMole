"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionRegistry, validateViewerLocation } = require("../server/websocket/connections");
const { ROLE } = require("../server/websocket/constants");
const silentLogger = { info() {}, warn() {}, error() {} };
const berlin = { latitude: 52.52, longitude: 13.405, accuracy: 15 };

test("viewer coordinates accept finite geographic bounds and reject malformed input", () => {
  for (const value of [null, [], {}, { ...berlin, latitude: "52.52" },
    { ...berlin, latitude: 90.1 }, { ...berlin, longitude: -180.1 },
    { ...berlin, accuracy: -1 }, { ...berlin, accuracy: Infinity },
    { ...berlin, latitude: NaN }, { ...berlin, accuracy: 20_000_001 }]) {
    assert.throws(() => validateViewerLocation(value), { code: "INVALID_LOCATION" });
  }
  assert.deepEqual(validateViewerLocation({ latitude: -90, longitude: 180, accuracy: 0 }),
    { latitude: -90, longitude: 180, accuracy: 0 });
  assert.deepEqual(validateViewerLocation({ ...berlin, password: "never retained", updatedAt: 0 }), berlin);
});

test("locations belong to authenticated viewers and are visible only to Moles in the same tunnel", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const mole = {}, viewer = {}, otherViewer = {}, otherMole = {}, stranger = {};
  await registry.join(ROLE.MOLE, mole, { name: "alpha-private", isPrivate: true, password: "test-password" });
  await registry.join(ROLE.DIGGER, viewer, { name: "alpha-private", password: "test-password" });
  await registry.join(ROLE.DIGGER, otherViewer, { name: "alpha-private", password: "test-password" });
  await registry.join(ROLE.MOLE, otherMole, { name: "beta" });
  assert.throws(() => registry.updateViewerLocation(stranger, berlin), { code: "FORBIDDEN" });
  assert.throws(() => registry.updateViewerLocation(mole, berlin), { code: "FORBIDDEN" });
  await assert.rejects(registry.join(ROLE.DIGGER, stranger, { name: "alpha-private", password: "wrong" }));
  assert.throws(() => registry.updateViewerLocation(stranger, berlin), { code: "FORBIDDEN" });
  const shared = registry.updateViewerLocation(viewer, { ...berlin, viewerId: "spoofed", stream: "beta" });
  assert.notEqual(shared.viewerId, "spoofed");
  assert.ok(shared.updatedAt > 0);
  assert.deepEqual(registry.viewerLocations(mole), [shared]);
  assert.deepEqual(registry.viewerLocations(otherMole), []);
  assert.deepEqual(registry.viewerLocations(viewer), []);
  assert.deepEqual(registry.viewerLocations(otherViewer), []);
  assert.deepEqual(registry.viewerLocations(stranger), []);
  assert.equal("viewerLocations" in registry.describeSocket(otherViewer), false);
  assert.equal("viewerLocations" in registry.presence(mole), false);
  assert.deepEqual(registry.publicStreams().map((stream) => stream.name), ["beta"]);

  const snapshot = registry.viewerLocations(mole);
  snapshot[0].latitude = 0;
  assert.equal(registry.viewerLocations(mole)[0].latitude, berlin.latitude);
});

test("withdrawal and disconnect delete locations; reconnect gets a new identity with no sharing", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const mole = {}, viewer = {};
  await registry.join(ROLE.MOLE, mole, { name: "live" });
  await registry.join(ROLE.DIGGER, viewer, { name: "live" });
  const first = registry.updateViewerLocation(viewer, berlin);
  assert.deepEqual(registry.updateViewerLocation(viewer, null), { viewerId: first.viewerId });
  assert.deepEqual(registry.viewerLocations(mole), []);
  registry.updateViewerLocation(viewer, berlin);
  const retainedMetadata = registry.metadata(viewer);
  registry.remove(viewer);
  assert.equal(retainedMetadata.location, null);
  assert.deepEqual(registry.viewerLocations(mole), []);
  await registry.join(ROLE.DIGGER, viewer, { name: "live" });
  assert.notEqual(registry.metadata(viewer).viewerId, first.viewerId);
  assert.deepEqual(registry.viewerLocations(mole), []);
});
