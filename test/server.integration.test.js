"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { createMavMoleServer } = require("../server/server");

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextBinaryMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data, isBinary) => resolve({ data, isBinary }));
    socket.once("error", reject);
  });
}

function closeService(service) {
  return new Promise((resolve) => service.close(resolve));
}

test("serves the app and relays a binary frame end to end", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));

  const address = service.httpServer.address();
  const httpUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${httpUrl}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).status, "ok");

  const digger = await openWebSocket(`${wsUrl}/ws?role=digger`);
  const mole = await openWebSocket(`${wsUrl}/ws?role=mole`);
  context.after(() => {
    mole.close();
    digger.close();
  });

  const received = nextBinaryMessage(digger);
  const expectedFrame = Buffer.from([0xfd, 0x04, 0x00, 0x00, 0x01, 0x02]);
  mole.send(expectedFrame, { binary: true });

  const message = await received;
  assert.equal(message.isBinary, true);
  assert.deepEqual(message.data, expectedFrame);
});
