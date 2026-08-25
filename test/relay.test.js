"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { BinaryRelay } = require("../server/websocket/relay");
const { ROLE } = require("../server/websocket/constants");

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createRelay(digger) {
  const connections = {
    get(role) {
      return role === ROLE.DIGGER ? digger : null;
    },
  };
  return new BinaryRelay(connections, silentLogger);
}

test("forwards a Mole binary frame without changing its buffer", () => {
  const sends = [];
  const digger = {
    readyState: WebSocket.OPEN,
    send(data, options, callback) {
      sends.push({ data, options });
      callback();
    },
  };
  const relay = createRelay(digger);
  const frame = Buffer.from([0xfd, 0x03, 0x00, 0x00, 0x01]);

  assert.equal(relay.forward(ROLE.MOLE, frame, true), true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].data, frame);
  assert.deepEqual(sends[0].options, { binary: true });
  assert.deepEqual(relay.snapshot(), {
    framesForwarded: 1,
    bytesForwarded: frame.length,
    framesDropped: 0,
  });
});

test("ignores text frames and messages sent by a Digger", () => {
  const digger = {
    readyState: WebSocket.OPEN,
    send() {
      assert.fail("send must not be called");
    },
  };
  const relay = createRelay(digger);

  assert.equal(relay.forward(ROLE.MOLE, Buffer.from("text"), false), false);
  assert.equal(relay.forward(ROLE.DIGGER, Buffer.from([1]), true), false);
  assert.deepEqual(relay.snapshot(), {
    framesForwarded: 0,
    bytesForwarded: 0,
    framesDropped: 1,
  });
});

test("drops a Mole frame when no Digger is connected", () => {
  const relay = createRelay(null);

  assert.equal(relay.forward(ROLE.MOLE, Buffer.from([1, 2, 3]), true), false);
  assert.equal(relay.snapshot().framesDropped, 1);
});
