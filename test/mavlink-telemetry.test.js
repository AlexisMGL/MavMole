"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CRC_EXTRA,
  MESSAGE,
  MavlinkStreamParser,
  TelemetryDecoder,
  x25Crc,
} = require("../public/js/mavlink-telemetry");

function mavlinkFrame(version, messageId, payload, sequence = 0) {
  const header = Buffer.alloc(version === 2 ? 10 : 6);
  header[0] = version === 2 ? 0xfd : 0xfe;
  header[1] = payload.length;

  if (version === 2) {
    header[2] = 0;
    header[3] = 0;
    header[4] = sequence;
    header[5] = 1;
    header[6] = 1;
    header[7] = messageId & 0xff;
    header[8] = (messageId >> 8) & 0xff;
    header[9] = (messageId >> 16) & 0xff;
  } else {
    header[2] = sequence;
    header[3] = 1;
    header[4] = 1;
    header[5] = messageId;
  }

  const checksumInput = Buffer.concat([header.subarray(1), payload]);
  const checksum = x25Crc(checksumInput, CRC_EXTRA.get(messageId));
  const checksumBytes = Buffer.alloc(2);
  checksumBytes.writeUInt16LE(checksum);
  return Buffer.concat([header, payload, checksumBytes]);
}

function packet(messageId, payload) {
  return { messageId, payload: new Uint8Array(payload) };
}

test("parses fragmented MAVLink 2 frames and concatenated MAVLink 1 frames", () => {
  const parser = new MavlinkStreamParser();
  const positionPayload = Buffer.alloc(28);
  positionPayload.writeInt32LE(Math.round(48.8566 * 1e7), 4);
  positionPayload.writeInt32LE(Math.round(2.3522 * 1e7), 8);
  const positionFrame = mavlinkFrame(2, MESSAGE.GLOBAL_POSITION_INT, positionPayload, 3);

  assert.deepEqual(parser.push(positionFrame.subarray(0, 9)), []);
  const firstMessages = parser.push(positionFrame.subarray(9));
  assert.equal(firstMessages.length, 1);
  assert.equal(firstMessages[0].version, 2);
  assert.equal(firstMessages[0].messageId, MESSAGE.GLOBAL_POSITION_INT);

  const hudPayload = Buffer.alloc(20);
  hudPayload.writeFloatLE(23.4, 0);
  const hudFrame = mavlinkFrame(1, MESSAGE.VFR_HUD, hudPayload, 4);
  const messages = parser.push(Buffer.concat([Buffer.from([0, 1, 2]), hudFrame, hudFrame]));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].version, 1);
  assert.equal(messages[0].messageId, MESSAGE.VFR_HUD);
  assert.equal(parser.stats.discardedBytes, 3);
});

test("rejects a supported MAVLink frame with a bad checksum", () => {
  const parser = new MavlinkStreamParser();
  const payload = Buffer.alloc(20);
  const frame = mavlinkFrame(2, MESSAGE.VFR_HUD, payload);
  frame[frame.length - 1] ^= 0xff;

  assert.deepEqual(parser.push(frame), []);
  assert.equal(parser.stats.checksumErrors, 1);
});

test("decodes position, airspeed and rectifies negative battery current", () => {
  const decoder = new TelemetryDecoder();
  const now = 1000;

  const positionPayload = Buffer.alloc(28);
  positionPayload.writeInt32LE(Math.round(48.8566 * 1e7), 4);
  positionPayload.writeInt32LE(Math.round(2.3522 * 1e7), 8);
  positionPayload.writeInt32LE(87500, 16);
  positionPayload.writeUInt16LE(12345, 26);
  decoder.ingest(packet(MESSAGE.GLOBAL_POSITION_INT, positionPayload), now);

  const hudPayload = Buffer.alloc(20);
  hudPayload.writeFloatLE(21.75, 0);
  decoder.ingest(packet(MESSAGE.VFR_HUD, hudPayload), now);

  const statusPayload = Buffer.alloc(31);
  statusPayload.writeUInt16LE(23800, 14);
  statusPayload.writeInt16LE(-765, 16);
  statusPayload.writeInt8(68, 30);
  decoder.ingest(packet(MESSAGE.SYS_STATUS, statusPayload), now);

  assert.equal(decoder.state.position.lat, 48.8566);
  assert.equal(decoder.state.position.lon, 2.3522);
  assert.equal(decoder.state.position.heading, 123.45);
  assert.equal(decoder.state.airspeed.value, 21.75);
  assert.equal(decoder.state.agl.value, 87.5);
  assert.equal(decoder.state.batteryVoltage.value, 23.8);
  assert.equal(decoder.state.batteryCurrent.value, 7.65);
  assert.equal(decoder.state.batteryRemaining.value, 68);
});

test("prefers a downward rangefinder for AGL and falls back when it becomes stale", () => {
  const decoder = new TelemetryDecoder();
  const positionPayload = Buffer.alloc(28);
  positionPayload.writeInt32LE(100000, 16);
  decoder.ingest(packet(MESSAGE.GLOBAL_POSITION_INT, positionPayload), 1000);

  const distancePayload = Buffer.alloc(14);
  distancePayload.writeUInt16LE(1234, 8);
  distancePayload[12] = 25;
  decoder.ingest(packet(MESSAGE.DISTANCE_SENSOR, distancePayload), 1100);
  assert.equal(decoder.state.agl.value, 12.34);
  assert.equal(decoder.state.agl.source, "Downward rangefinder");

  positionPayload.writeInt32LE(120000, 16);
  decoder.ingest(packet(MESSAGE.GLOBAL_POSITION_INT, positionPayload), 1200);
  assert.equal(decoder.state.agl.value, 12.34);

  decoder.ingest(packet(MESSAGE.GLOBAL_POSITION_INT, positionPayload), 5000);
  assert.equal(decoder.state.agl.value, 120);
  assert.equal(decoder.state.agl.source, "Relative to home");
});

test("decodes the primary BATTERY_STATUS pack voltage and absolute current", () => {
  const decoder = new TelemetryDecoder();
  const payload = Buffer.alloc(36, 0xff);
  payload.writeUInt16LE(12000, 10);
  payload.writeUInt16LE(11800, 12);
  payload.writeInt16LE(-1234, 30);
  payload.writeUInt8(0, 32);
  payload.writeInt8(54, 35);
  decoder.ingest(packet(MESSAGE.BATTERY_STATUS, payload), 1000);

  assert.equal(decoder.state.batteryVoltage.value, 23.8);
  assert.equal(decoder.state.batteryCurrent.value, 12.34);
  assert.equal(decoder.state.batteryRemaining.value, 54);
});
