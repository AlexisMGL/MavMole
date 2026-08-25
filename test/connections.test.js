"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionRegistry } = require("../server/websocket/connections");
const { CLOSE_CODE, ROLE } = require("../server/websocket/constants");

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

test("a newer client replaces the previous client for the same role", () => {
  const registry = new ConnectionRegistry(silentLogger);
  const firstMole = fakeSocket();
  const secondMole = fakeSocket();

  registry.register(ROLE.MOLE, firstMole);
  registry.register(ROLE.MOLE, secondMole);

  assert.equal(registry.get(ROLE.MOLE), secondMole);
  assert.deepEqual(firstMole.closes, [
    { code: CLOSE_CODE.REPLACED, reason: "A new mole connected." },
  ]);
});

test("closing a replaced client does not remove its replacement", () => {
  const registry = new ConnectionRegistry(silentLogger);
  const firstMole = fakeSocket();
  const secondMole = fakeSocket();

  registry.register(ROLE.MOLE, firstMole);
  registry.register(ROLE.MOLE, secondMole);

  assert.equal(registry.remove(ROLE.MOLE, firstMole), false);
  assert.equal(registry.get(ROLE.MOLE), secondMole);
  assert.deepEqual(registry.snapshot(), { mole: true, digger: false });
});
