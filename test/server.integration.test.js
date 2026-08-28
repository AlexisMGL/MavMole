"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { createMavMoleServer } = require("../server/server");
const { RELAY_HEADER_BYTES, RELAY_MAGIC } = require("../server/websocket/protocol");

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextControl(socket, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a relay control message."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = JSON.parse(data.toString());
      if (!predicate(message)) {
        return;
      }
      cleanup();
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

function nextBinaryMessage(socket, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a binary relay frame."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (data, isBinary) => {
      if (!isBinary) {
        return;
      }
      cleanup();
      resolve(data);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function joinTunnel(socket, config) {
  const joined = nextControl(
    socket,
    (message) => message.type === "tunnel.joined" || message.type === "tunnel.error",
  );
  socket.send(JSON.stringify({
    type: "tunnel.join",
    stream: config.stream,
    password: config.password || "",
    private: config.private === true,
    mode: config.mode || "create",
  }));
  const result = await joined;
  if (result.type === "tunnel.error") {
    throw new Error(result.message);
  }
  return result;
}

async function openAndJoin(url, config) {
  const socket = await openWebSocket(url);
  const joined = await joinTunnel(socket, config);
  return { socket, joined };
}

function unwrapRelayFrame(frame) {
  assert.deepEqual(frame.subarray(0, 4), RELAY_MAGIC);
  return {
    sourceId: frame.readUInt32BE(4),
    payload: frame.subarray(RELAY_HEADER_BYTES),
  };
}

function closeService(service) {
  return new Promise((resolve) => service.close(resolve));
}

function mavlinkHeartbeat(sequence = 0) {
  return Buffer.from([0xfe, 0x00, sequence, 0x01, 0x01, 0x00, 0x00, 0x00]);
}

test("serves secured app assets and relays an authenticated public tunnel", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));

  const address = service.httpServer.address();
  const httpUrl = "http://127.0.0.1:" + address.port;
  const wsUrl = "ws://127.0.0.1:" + address.port;

  const homeResponse = await fetch(httpUrl);
  assert.equal(homeResponse.status, 200);
  assert.equal(homeResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(homeResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const iconResponse = await fetch(httpUrl + "/assets/icons/mole-circle.png");
  assert.equal(iconResponse.status, 200);
  assert.match(iconResponse.headers.get("content-type"), /^image\/png/);

  const sourceAssetResponse = await fetch(httpUrl + "/assets/source/mavmole-brand-board.png");
  assert.equal(sourceAssetResponse.status, 404);

  const digger = await openAndJoin(wsUrl + "/ws?role=digger", { stream: "public" });
  const mole = await openAndJoin(wsUrl + "/ws?role=mole", { stream: "public" });
  context.after(() => {
    mole.socket.close();
    digger.socket.close();
  });

  const expectedPayload = mavlinkHeartbeat(1);
  const received = nextBinaryMessage(digger.socket);
  mole.socket.send(expectedPayload, { binary: true });
  const envelope = unwrapRelayFrame(await received);
  assert.equal(envelope.sourceId, mole.joined.sourceId);
  assert.deepEqual(envelope.payload, expectedPayload);

  const statsResponse = await fetch(httpUrl + "/api/stats");
  assert.deepEqual(await statsResponse.json(), { streams: 1, moles: 1, viewers: 1 });
  const streamsResponse = await fetch(httpUrl + "/api/streams");
  const publicStreams = (await streamsResponse.json()).streams;
  assert.equal(publicStreams.length, 1);
  assert.equal(publicStreams[0].name, "public");
  assert.equal(publicStreams[0].moles, 1);
});

test("isolates named tunnels and supports multiple viewers", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));
  const port = service.httpServer.address().port;
  const wsUrl = "ws://127.0.0.1:" + port;

  const mole = await openAndJoin(wsUrl + "/ws?role=mole", { stream: "fleet-alpha" });
  const first = await openAndJoin(wsUrl + "/ws?role=digger", { stream: "fleet-alpha" });
  const presence = nextControl(
    first.socket,
    (message) => message.type === "stream.presence" && message.viewers === 2,
  );
  const second = await openAndJoin(wsUrl + "/ws?role=digger", { stream: "fleet-alpha" });
  const otherMole = await openAndJoin(wsUrl + "/ws?role=mole", { stream: "fleet-beta" });
  context.after(() => {
    mole.socket.close();
    first.socket.close();
    second.socket.close();
    otherMole.socket.close();
  });

  assert.equal((await presence).viewers, 2);
  const firstFrame = nextBinaryMessage(first.socket);
  const secondFrame = nextBinaryMessage(second.socket);
  const expected = mavlinkHeartbeat(2);
  mole.socket.send(expected, { binary: true });
  assert.deepEqual(unwrapRelayFrame(await firstFrame).payload, expected);
  assert.deepEqual(unwrapRelayFrame(await secondFrame).payload, expected);
  assert.deepEqual(service.connections.snapshot(), { streams: 2, moles: 2, viewers: 2 });
});

test("protects private tunnels and never lists them publicly", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));
  const port = service.httpServer.address().port;
  const httpUrl = "http://127.0.0.1:" + port;
  const wsUrl = "ws://127.0.0.1:" + port;

  const privateMole = await openAndJoin(wsUrl + "/ws?role=mole", {
    stream: "secret-fleet",
    password: "demo-password",
    private: true,
  });
  const wrongViewer = await openWebSocket(wsUrl + "/ws?role=digger");
  const rejected = nextControl(wrongViewer, (message) => message.type === "tunnel.error");
  wrongViewer.send(JSON.stringify({
    type: "tunnel.join",
    stream: "secret-fleet",
    password: "wrong-password",
  }));
  assert.equal((await rejected).code, "AUTH_FAILED");

  const privateViewer = await openAndJoin(wsUrl + "/ws?role=digger", {
    stream: "secret-fleet",
    password: "demo-password",
  });
  context.after(() => {
    privateMole.socket.close();
    privateViewer.socket.close();
    wrongViewer.close();
  });

  const publicResponse = await fetch(httpUrl + "/api/streams");
  assert.deepEqual((await publicResponse.json()).streams, []);
});

test("announces a new Mole only after it carries a MAVLink frame", async (context) => {
  const service = createMavMoleServer();
  await new Promise((resolve) => service.httpServer.listen(0, "127.0.0.1", resolve));
  context.after(() => closeService(service));
  const port = service.httpServer.address().port;
  const wsUrl = "ws://127.0.0.1:" + port;

  const firstMole = await openAndJoin(wsUrl + "/ws?role=mole", { stream: "formation" });
  const viewer = await openAndJoin(wsUrl + "/ws?role=digger", { stream: "formation" });
  const firstActive = nextControl(
    viewer.socket,
    (message) => message.type === "stream.mole_active" && message.sourceId === firstMole.joined.sourceId,
  );
  firstMole.socket.send(mavlinkHeartbeat(3), { binary: true });
  await firstActive;

  const secondMole = await openAndJoin(wsUrl + "/ws?role=mole", {
    stream: "formation",
    mode: "join",
  });
  context.after(() => {
    firstMole.socket.close();
    secondMole.socket.close();
    viewer.socket.close();
  });

  let announced = false;
  const onControl = (data, isBinary) => {
    if (!isBinary) {
      const message = JSON.parse(data.toString());
      if (message.type === "stream.mole_active" && message.sourceId === secondMole.joined.sourceId) {
        announced = true;
      }
    }
  };
  viewer.socket.on("message", onControl);
  secondMole.socket.send(Buffer.from([1, 2, 3, 4]), { binary: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(announced, false);
  viewer.socket.off("message", onControl);

  const secondActive = nextControl(
    viewer.socket,
    (message) => message.type === "stream.mole_active" && message.sourceId === secondMole.joined.sourceId,
  );
  secondMole.socket.send(mavlinkHeartbeat(4), { binary: true });
  const announcement = await secondActive;
  assert.equal(announcement.label, secondMole.joined.label);
});
