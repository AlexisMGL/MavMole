"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { BinaryRelay } = require("../server/websocket/relay");
const { RELAY_HEADER_BYTES, RELAY_MAGIC } = require("../server/websocket/protocol");
const { ROLE } = require("../server/websocket/constants");

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createRelay(...diggers) {
  const sourceSocket = {};
  const connections = {
    metadata(socket) {
      return socket === sourceSocket ? { role: ROLE.MOLE, sourceId: 42 } : null;
    },
    allInTunnel(socket, role) {
      return socket === sourceSocket && role === ROLE.DIGGER ? diggers.filter(Boolean) : [];
    },
  };
  return { relay: new BinaryRelay(connections, silentLogger), sourceSocket };
}

test("wraps a Mole frame with its source ID without changing the MAVLink payload", () => {
  const sends = [];
  const digger = {
    readyState: WebSocket.OPEN,
    send(data, options, callback) {
      sends.push({ data, options });
      callback();
    },
  };
  const { relay, sourceSocket } = createRelay(digger);
  const payload = Buffer.from([0xfd, 0x03, 0x00, 0x00, 0x01]);

  assert.equal(relay.forward(sourceSocket, payload, true), true);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].data.subarray(0, 4), RELAY_MAGIC);
  assert.equal(sends[0].data.readUInt32BE(4), 42);
  assert.deepEqual(sends[0].data.subarray(RELAY_HEADER_BYTES), payload);
  assert.deepEqual(sends[0].options, { binary: true });
  assert.deepEqual(relay.snapshot(), {
    framesForwarded: 1,
    bytesForwarded: payload.length,
    framesDropped: 0,
  });
});

test("ignores unauthenticated sources and text frames", () => {
  const { relay, sourceSocket } = createRelay();

  assert.equal(relay.forward({}, Buffer.from([1]), true), false);
  assert.equal(relay.forward(sourceSocket, Buffer.from("text"), false), false);
  assert.deepEqual(relay.snapshot(), {
    framesForwarded: 0,
    bytesForwarded: 0,
    framesDropped: 1,
  });
});

test("forwards only to viewers in the source tunnel", () => {
  const sends = [0, 0];
  const diggers = sends.map((_value, index) => ({
    readyState: WebSocket.OPEN,
    send(_data, _options, callback) {
      sends[index] += 1;
      callback();
    },
  }));
  const { relay, sourceSocket } = createRelay(...diggers);
  const frame = Buffer.from([0xfd, 1, 2]);

  assert.equal(relay.forward(sourceSocket, frame, true), true);
  assert.deepEqual(sends, [1, 1]);
  assert.equal(relay.snapshot().bytesForwarded, frame.length * 2);
});

test("drops a Mole frame when its tunnel has no viewer", () => {
  const { relay, sourceSocket } = createRelay();

  assert.equal(relay.forward(sourceSocket, Buffer.from([1, 2, 3]), true), false);
  assert.equal(relay.snapshot().framesDropped, 1);
});
