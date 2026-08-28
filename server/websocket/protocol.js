"use strict";

const RELAY_MAGIC = Buffer.from([0x4d, 0x4d, 0x46, 0x01]);
const RELAY_HEADER_BYTES = 8;

function encodeRelayFrame(sourceId, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const frame = Buffer.allocUnsafe(RELAY_HEADER_BYTES + payload.length);
  RELAY_MAGIC.copy(frame, 0);
  frame.writeUInt32BE(sourceId >>> 0, 4);
  payload.copy(frame, RELAY_HEADER_BYTES);
  return frame;
}

function mavlinkFrameLength(buffer, offset) {
  const magic = buffer[offset];
  const payloadLength = buffer[offset + 1];
  if (magic === 0xfe) {
    return payloadLength + 8;
  }
  if (magic === 0xfd) {
    const signed = (buffer[offset + 2] & 0x01) !== 0;
    return payloadLength + 12 + (signed ? 13 : 0);
  }
  return 0;
}

function containsMavlinkFrame(socket, data) {
  const incoming = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const previous = socket.mavlinkProbe || Buffer.alloc(0);
  const combined = Buffer.concat([previous, incoming]).subarray(-4096);
  socket.mavlinkProbe = combined;

  for (let offset = 0; offset < combined.length - 7; offset += 1) {
    if (combined[offset] !== 0xfe && combined[offset] !== 0xfd) {
      continue;
    }
    const frameLength = mavlinkFrameLength(combined, offset);
    if (frameLength > 0 && offset + frameLength <= combined.length) {
      socket.mavlinkProbe = Buffer.alloc(0);
      return true;
    }
  }
  return false;
}

module.exports = {
  RELAY_HEADER_BYTES,
  RELAY_MAGIC,
  containsMavlinkFrame,
  encodeRelayFrame,
};
