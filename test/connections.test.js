"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionRegistry } = require("../server/websocket/connections");
const { JOIN_MODE, ROLE } = require("../server/websocket/constants");

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function fakeSocket() {
  return {
    closes: [],
    close(code, reason) {
      this.closes.push({ code, reason });
    },
  };
}

test("multiple Moles can publish inside the same tunnel", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const firstMole = fakeSocket();
  const secondMole = fakeSocket();

  const first = await registry.join(ROLE.MOLE, firstMole, {
    name: "demo-fleet",
    mode: JOIN_MODE.CREATE,
  });
  const second = await registry.join(ROLE.MOLE, secondMole, {
    name: "demo-fleet",
    mode: JOIN_MODE.JOIN,
  });

  assert.notEqual(first.sourceId, second.sourceId);
  assert.deepEqual(registry.allInTunnel(firstMole, ROLE.MOLE), [firstMole, secondMole]);
  assert.deepEqual(firstMole.closes, []);
  assert.deepEqual(secondMole.closes, []);
  assert.deepEqual(registry.snapshot(), { streams: 1, moles: 2, viewers: 0 });
});

test("private tunnels require the same password and stay out of public listings", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const creator = fakeSocket();
  await registry.join(ROLE.MOLE, creator, {
    name: "private-flight",
    password: "correct horse",
    isPrivate: true,
    mode: JOIN_MODE.CREATE,
  });

  await assert.rejects(
    registry.join(ROLE.DIGGER, fakeSocket(), {
      name: "private-flight",
      password: "wrong password",
    }),
    /credentials are incorrect/,
  );
  const viewer = fakeSocket();
  await registry.join(ROLE.DIGGER, viewer, {
    name: "private-flight",
    password: "correct horse",
  });

  assert.deepEqual(registry.publicStreams(), []);
  assert.equal(registry.presence(viewer).viewers, 1);
});

test("tunnels isolate viewers and are removed when their last socket leaves", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const alphaMole = fakeSocket();
  const alphaViewer = fakeSocket();
  const betaMole = fakeSocket();

  await registry.join(ROLE.MOLE, alphaMole, { name: "alpha" });
  await registry.join(ROLE.DIGGER, alphaViewer, { name: "alpha" });
  await registry.join(ROLE.MOLE, betaMole, { name: "beta" });

  assert.deepEqual(registry.allInTunnel(alphaMole, ROLE.DIGGER), [alphaViewer]);
  assert.deepEqual(registry.allInTunnel(betaMole, ROLE.DIGGER), []);
  registry.remove(alphaViewer);
  registry.remove(alphaMole);
  assert.deepEqual(registry.snapshot(), { streams: 1, moles: 1, viewers: 0 });
});

test("only Moles proven to carry MAVLink count as active", async () => {
  const registry = new ConnectionRegistry(silentLogger);
  const mole = fakeSocket();
  const viewer = fakeSocket();
  await registry.join(ROLE.MOLE, mole, { name: "activity" });
  await registry.join(ROLE.DIGGER, viewer, { name: "activity" });

  assert.equal(registry.presence(viewer).moles, 0);
  const active = registry.markMoleActive(mole);
  assert.equal(active.sourceId, registry.metadata(mole).sourceId);
  assert.equal(registry.presence(viewer).moles, 1);
  assert.equal(registry.markMoleActive(mole), null);
});
