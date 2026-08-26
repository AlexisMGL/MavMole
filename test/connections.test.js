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

test("a newer Mole replaces the previous source", () => {
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

test("multiple Diggers can watch the same stream", () => {
  const registry = new ConnectionRegistry(silentLogger);
  const firstDigger = fakeSocket();
  const secondDigger = fakeSocket();

  registry.register(ROLE.DIGGER, firstDigger);
  registry.register(ROLE.DIGGER, secondDigger);

  assert.deepEqual(registry.all(ROLE.DIGGER), [firstDigger, secondDigger]);
  assert.equal(registry.count(ROLE.DIGGER), 2);
  assert.deepEqual(firstDigger.closes, []);
});

test("closing a replaced client does not remove its replacement", () => {
  const registry = new ConnectionRegistry(silentLogger);
  const firstMole = fakeSocket();
  const secondMole = fakeSocket();

  registry.register(ROLE.MOLE, firstMole);
  registry.register(ROLE.MOLE, secondMole);

  assert.equal(registry.remove(ROLE.MOLE, firstMole), false);
  assert.equal(registry.get(ROLE.MOLE), secondMole);
  assert.deepEqual(registry.snapshot(), { mole: true, digger: false, viewers: 0 });
});
