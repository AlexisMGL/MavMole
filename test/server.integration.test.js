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
    const onMessage = (data, isBinary) => {
      if (!isBinary) {
        return;
      }
      socket.off("message", onMessage);
      resolve({ data, isBinary });
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

function nextPresenceMessage(socket, expectedViewers) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type !== "stream.presence" || message.viewers !== expectedViewers) {
        return;
      }
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
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

  const assetResponse = await fetch(`${httpUrl}/assets/brand/mavmole-banner.png`);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("content-type"), /^image\/png/);

  const dialectResponse = await fetch(`${httpUrl}/js/mavlink-dialect.js`);
  assert.equal(dialectResponse.status, 200);
  assert.match(dialectResponse.headers.get("content-type"), /javascript/);

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

test("relays to multiple viewers and broadcasts the viewer count", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));

  const address = service.httpServer.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  const mole = await openWebSocket(`${wsUrl}/ws?role=mole`);
  const firstViewer = await openWebSocket(`${wsUrl}/ws?role=digger`);
  const presence = nextPresenceMessage(firstViewer, 2);
  const secondViewer = await openWebSocket(`${wsUrl}/ws?role=digger`);
  context.after(() => {
    mole.close();
    firstViewer.close();
    secondViewer.close();
  });

  assert.equal((await presence).viewers, 2);
  const firstFrame = nextBinaryMessage(firstViewer);
  const secondFrame = nextBinaryMessage(secondViewer);
  const expectedFrame = Buffer.from([0xfd, 0x02, 0x03]);
  mole.send(expectedFrame, { binary: true });

  assert.deepEqual((await firstFrame).data, expectedFrame);
  assert.deepEqual((await secondFrame).data, expectedFrame);
});
