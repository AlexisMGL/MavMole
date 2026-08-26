"use strict";

const { WebSocketServer } = require("ws");

const port = Number.parseInt(process.env.LOCAL_SOURCE_PORT || "5863", 10);
const server = new WebSocketServer({ host: "127.0.0.1", port });
let sequence = 0;
const startedAt = Date.now();

const CRC_EXTRA = new Map([
  [1, 124],
  [33, 104],
  [74, 20],
  [132, 85],
]);

function crcAccumulate(byte, checksum) {
  let temporary = (byte ^ (checksum & 0xff)) & 0xff;
  temporary = (temporary ^ ((temporary << 4) & 0xff)) & 0xff;
  return (
    ((checksum >> 8) ^
      (temporary << 8) ^
      (temporary << 3) ^
      (temporary >> 4)) &
    0xffff
  );
}

function checksum(bytes, extra) {
  let value = 0xffff;
  for (const byte of bytes) {
    value = crcAccumulate(byte, value);
  }
  return crcAccumulate(extra, value);
}

function mavlinkV2Frame(messageId, payload) {
  const header = Buffer.alloc(10);
  header[0] = 0xfd;
  header[1] = payload.length;
  header[2] = 0;
  header[3] = 0;
  header[4] = sequence & 0xff;
  header[5] = 1;
  header[6] = 1;
  header[7] = messageId & 0xff;
  header[8] = (messageId >> 8) & 0xff;
  header[9] = (messageId >> 16) & 0xff;
  sequence += 1;

  const checksumInput = Buffer.concat([header.subarray(1), payload]);
  const crc = checksum(checksumInput, CRC_EXTRA.get(messageId));
  const crcBytes = Buffer.alloc(2);
  crcBytes.writeUInt16LE(crc);
  return Buffer.concat([header, payload, crcBytes]);
}

function globalPositionFrame(elapsedSeconds) {
  const payload = Buffer.alloc(28);
  const orbit = elapsedSeconds / 18;
  const latitude = 48.8566 + Math.sin(orbit) * 0.0012;
  const longitude = 2.3522 + Math.cos(orbit) * 0.0018;
  const heading = ((orbit * 180) / Math.PI + 90) % 360;
  const agl = 82 + Math.sin(elapsedSeconds / 7) * 24;

  payload.writeUInt32LE(Math.round(elapsedSeconds * 1000), 0);
  payload.writeInt32LE(Math.round(latitude * 1e7), 4);
  payload.writeInt32LE(Math.round(longitude * 1e7), 8);
  payload.writeInt32LE(Math.round((agl + 35) * 1000), 12);
  payload.writeInt32LE(Math.round(agl * 1000), 16);
  payload.writeInt16LE(1250, 20);
  payload.writeInt16LE(180, 22);
  payload.writeInt16LE(0, 24);
  payload.writeUInt16LE(Math.round(heading * 100), 26);
  return mavlinkV2Frame(33, payload);
}

function vfrHudFrame(elapsedSeconds) {
  const payload = Buffer.alloc(20);
  const airspeed = 21.5 + Math.sin(elapsedSeconds / 3) * 3.5;
  payload.writeFloatLE(airspeed, 0);
  payload.writeFloatLE(airspeed + 1.8, 4);
  payload.writeFloatLE(117, 8);
  payload.writeFloatLE(Math.cos(elapsedSeconds / 7) * 1.2, 12);
  payload.writeInt16LE(90, 16);
  payload.writeUInt16LE(54, 18);
  return mavlinkV2Frame(74, payload);
}

function distanceSensorFrame(elapsedSeconds) {
  const payload = Buffer.alloc(14);
  const agl = 82 + Math.sin(elapsedSeconds / 7) * 24;
  payload.writeUInt32LE(Math.round(elapsedSeconds * 1000), 0);
  payload.writeUInt16LE(20, 4);
  payload.writeUInt16LE(50000, 6);
  payload.writeUInt16LE(Math.round(agl * 100), 8);
  payload[10] = 0;
  payload[11] = 0;
  payload[12] = 25;
  payload[13] = 3;
  return mavlinkV2Frame(132, payload);
}

function systemStatusFrame(elapsedSeconds) {
  const payload = Buffer.alloc(31);
  const voltageMillivolts = Math.round(24200 - Math.min(elapsedSeconds * 2, 1600));
  const currentCentiamps = -Math.round(760 + Math.sin(elapsedSeconds / 2) * 180);
  const remaining = Math.max(15, Math.round(92 - elapsedSeconds / 45));

  payload.writeUInt32LE(0, 0);
  payload.writeUInt32LE(0, 4);
  payload.writeUInt32LE(0, 8);
  payload.writeUInt16LE(320, 12);
  payload.writeUInt16LE(voltageMillivolts, 14);
  payload.writeInt16LE(currentCentiamps, 16);
  payload.writeInt8(remaining, 30);
  return mavlinkV2Frame(1, payload);
}

function telemetryFrame() {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return Buffer.concat([
    globalPositionFrame(elapsedSeconds),
    vfrHudFrame(elapsedSeconds),
    distanceSensorFrame(elapsedSeconds),
    systemStatusFrame(elapsedSeconds),
  ]);
}

server.on("listening", () => {
  console.log(`[Fake Mission Planner] Listening on ws://127.0.0.1:${port}`);
  console.log("[Fake Mission Planner] Enter that URL on the Mole page.");
  console.log("[Fake Mission Planner] Streaming synthetic MAVLink position, airspeed, AGL and battery data.");
});

server.on("connection", (socket) => {
  console.log("[Fake Mission Planner] Browser connected.");

  const timer = setInterval(() => {
    socket.send(telemetryFrame(), { binary: true });
  }, 200);

  socket.on("close", () => {
    clearInterval(timer);
    console.log("[Fake Mission Planner] Browser disconnected.");
  });
});

server.on("error", (error) => {
  console.error("[Fake Mission Planner] Server error.", error);
  process.exitCode = 1;
});

function shutdown() {
  console.log("[Fake Mission Planner] Shutting down.");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
