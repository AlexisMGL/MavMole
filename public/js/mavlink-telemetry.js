(function createMavlinkTelemetry(globalScope) {
  "use strict";

  const MAGIC_V1 = 0xfe;
  const MAGIC_V2 = 0xfd;
  const SIGNED_FLAG = 0x01;
  const MAX_BUFFER_SIZE = 1024 * 1024;

  const MESSAGE = Object.freeze({
    SYS_STATUS: 1,
    GPS_RAW_INT: 24,
    GLOBAL_POSITION_INT: 33,
    VFR_HUD: 74,
    DISTANCE_SENSOR: 132,
    TERRAIN_REPORT: 136,
    ALTITUDE: 141,
    BATTERY_STATUS: 147,
    RANGEFINDER: 173,
    BATTERY2: 181,
    AIRSPEED: 295,
  });

  const CRC_EXTRA = new Map([
    [MESSAGE.SYS_STATUS, 124],
    [MESSAGE.GPS_RAW_INT, 24],
    [MESSAGE.GLOBAL_POSITION_INT, 104],
    [MESSAGE.VFR_HUD, 20],
    [MESSAGE.DISTANCE_SENSOR, 85],
    [MESSAGE.TERRAIN_REPORT, 1],
    [MESSAGE.ALTITUDE, 47],
    [MESSAGE.BATTERY_STATUS, 154],
    [MESSAGE.RANGEFINDER, 83],
    [MESSAGE.BATTERY2, 174],
    [MESSAGE.AIRSPEED, 234],
  ]);

  function asUint8Array(value) {
    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    throw new TypeError("MAVLink data must be an ArrayBuffer or typed array.");
  }

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

  function x25Crc(bytes, extra = null) {
    let checksum = 0xffff;

    for (const byte of bytes) {
      checksum = crcAccumulate(byte, checksum);
    }

    if (extra !== null) {
      checksum = crcAccumulate(extra, checksum);
    }

    return checksum;
  }

  function frameMetadata(bytes, offset) {
    const magic = bytes[offset];
    const version = magic === MAGIC_V2 ? 2 : 1;
    const headerLength = version === 2 ? 10 : 6;

    if (bytes.length - offset < headerLength) {
      return null;
    }

    const payloadLength = bytes[offset + 1];
    const signatureLength = version === 2 && (bytes[offset + 2] & SIGNED_FLAG) !== 0 ? 13 : 0;
    const frameLength = headerLength + payloadLength + 2 + signatureLength;
    const messageId =
      version === 2
        ? bytes[offset + 7] | (bytes[offset + 8] << 8) | (bytes[offset + 9] << 16)
        : bytes[offset + 5];

    return {
      version,
      headerLength,
      payloadLength,
      signatureLength,
      frameLength,
      messageId,
      sequence: bytes[offset + (version === 2 ? 4 : 2)],
      systemId: bytes[offset + (version === 2 ? 5 : 3)],
      componentId: bytes[offset + (version === 2 ? 6 : 4)],
    };
  }

  function hasValidChecksum(frame, metadata) {
    const extra = CRC_EXTRA.get(metadata.messageId);
    if (extra === undefined) {
      return true;
    }

    const checksumOffset = metadata.headerLength + metadata.payloadLength;
    const expected = frame[checksumOffset] | (frame[checksumOffset + 1] << 8);
    const calculated = x25Crc(frame.subarray(1, checksumOffset), extra);
    return expected === calculated;
  }

  class MavlinkStreamParser {
    constructor() {
      this.buffer = new Uint8Array(0);
      this.stats = {
        parsed: 0,
        unsupported: 0,
        checksumErrors: 0,
        discardedBytes: 0,
      };
    }

    reset() {
      this.buffer = new Uint8Array(0);
      this.stats.parsed = 0;
      this.stats.unsupported = 0;
      this.stats.checksumErrors = 0;
      this.stats.discardedBytes = 0;
    }

    push(value) {
      const incoming = asUint8Array(value);
      const combined = new Uint8Array(this.buffer.length + incoming.length);
      combined.set(this.buffer);
      combined.set(incoming, this.buffer.length);

      const messages = [];
      let offset = 0;

      while (offset < combined.length) {
        const magicOffset = this.findMagic(combined, offset);
        if (magicOffset === -1) {
          this.stats.discardedBytes += combined.length - offset;
          offset = combined.length;
          break;
        }

        if (magicOffset > offset) {
          this.stats.discardedBytes += magicOffset - offset;
          offset = magicOffset;
        }

        const metadata = frameMetadata(combined, offset);
        if (metadata === null || combined.length - offset < metadata.frameLength) {
          break;
        }

        const frame = combined.slice(offset, offset + metadata.frameLength);
        if (!hasValidChecksum(frame, metadata)) {
          this.stats.checksumErrors += 1;
          offset += 1;
          continue;
        }

        if (CRC_EXTRA.has(metadata.messageId)) {
          messages.push({
            ...metadata,
            payload: frame.slice(metadata.headerLength, metadata.headerLength + metadata.payloadLength),
            frame,
          });
          this.stats.parsed += 1;
        } else {
          this.stats.unsupported += 1;
        }

        offset += metadata.frameLength;
      }

      this.buffer = combined.slice(offset);
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.stats.discardedBytes += this.buffer.length;
        this.buffer = new Uint8Array(0);
      }

      return messages;
    }

    findMagic(bytes, start) {
      for (let index = start; index < bytes.length; index += 1) {
        if (bytes[index] === MAGIC_V1 || bytes[index] === MAGIC_V2) {
          return index;
        }
      }
      return -1;
    }
  }

  function viewFor(payload) {
    return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  function read(view, method, offset, byteLength) {
    if (offset + byteLength > view.byteLength) {
      return null;
    }
    return view[method](offset, true);
  }

  function validCoordinate(value, minimum, maximum) {
    return Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  function createField() {
    return { value: null, source: null, updatedAt: 0, priority: 0 };
  }

  function setField(field, value, source, priority, now) {
    if (!Number.isFinite(value)) {
      return false;
    }

    const sourceIsStale = now - field.updatedAt > 3000;
    if (field.value !== null && priority < field.priority && !sourceIsStale) {
      return false;
    }

    field.value = value;
    field.source = source;
    field.updatedAt = now;
    field.priority = priority;
    return true;
  }

  class TelemetryDecoder {
    constructor() {
      this.reset();
    }

    reset() {
      this.state = {
        position: { lat: null, lon: null, heading: null, source: null, updatedAt: 0, priority: 0 },
        airspeed: createField(),
        agl: createField(),
        batteryVoltage: createField(),
        batteryCurrent: createField(),
        batteryRemaining: createField(),
        lastTelemetryAt: 0,
        messageCount: 0,
      };
    }

    ingest(packet, now = Date.now()) {
      const view = viewFor(packet.payload);
      const changed = [];

      switch (packet.messageId) {
        case MESSAGE.GLOBAL_POSITION_INT:
          this.decodeGlobalPosition(view, now, changed);
          break;
        case MESSAGE.GPS_RAW_INT:
          this.decodeGpsPosition(view, now, changed);
          break;
        case MESSAGE.VFR_HUD:
          this.decodeVfrHud(view, now, changed);
          break;
        case MESSAGE.AIRSPEED:
          this.decodeAirspeed(view, now, changed);
          break;
        case MESSAGE.ALTITUDE:
          this.decodeAltitude(view, now, changed);
          break;
        case MESSAGE.TERRAIN_REPORT:
          this.decodeTerrain(view, now, changed);
          break;
        case MESSAGE.DISTANCE_SENSOR:
          this.decodeDistanceSensor(view, now, changed);
          break;
        case MESSAGE.RANGEFINDER:
          this.decodeRangefinder(view, now, changed);
          break;
        case MESSAGE.SYS_STATUS:
          this.decodeSystemStatus(view, now, changed);
          break;
        case MESSAGE.BATTERY_STATUS:
          this.decodeBatteryStatus(view, now, changed);
          break;
        case MESSAGE.BATTERY2:
          break;
        default:
          break;
      }

      this.state.messageCount += 1;
      this.state.lastTelemetryAt = now;
      return changed;
    }

    updatePosition(lat, lon, heading, source, priority, now, changed) {
      if (!validCoordinate(lat, -90, 90) || !validCoordinate(lon, -180, 180)) {
        return;
      }

      const position = this.state.position;
      const sourceIsStale = now - position.updatedAt > 3000;
      if (position.lat !== null && priority < position.priority && !sourceIsStale) {
        return;
      }

      position.lat = lat;
      position.lon = lon;
      position.heading = Number.isFinite(heading) ? heading : position.heading;
      position.source = source;
      position.updatedAt = now;
      position.priority = priority;
      changed.push("position");
    }

    decodeGlobalPosition(view, now, changed) {
      const lat = read(view, "getInt32", 4, 4);
      const lon = read(view, "getInt32", 8, 4);
      const relativeAltitude = read(view, "getInt32", 16, 4);
      const rawHeading = read(view, "getUint16", 26, 2);

      if (lat !== null && lon !== null) {
        const heading = rawHeading !== null && rawHeading !== 0xffff ? rawHeading / 100 : null;
        this.updatePosition(lat / 1e7, lon / 1e7, heading, "GLOBAL_POSITION_INT", 2, now, changed);
      }

      if (
        relativeAltitude !== null &&
        setField(this.state.agl, relativeAltitude / 1000, "Relative to home", 1, now)
      ) {
        changed.push("agl");
      }
    }

    decodeGpsPosition(view, now, changed) {
      const lat = read(view, "getInt32", 8, 4);
      const lon = read(view, "getInt32", 12, 4);
      const rawCourse = read(view, "getUint16", 26, 2);
      const fixType = read(view, "getUint8", 28, 1);

      if (lat === null || lon === null || fixType === null || fixType < 2) {
        return;
      }

      const heading = rawCourse !== null && rawCourse !== 0xffff ? rawCourse / 100 : null;
      this.updatePosition(lat / 1e7, lon / 1e7, heading, "GPS_RAW_INT", 1, now, changed);
    }

    decodeVfrHud(view, now, changed) {
      const airspeed = read(view, "getFloat32", 0, 4);
      if (airspeed !== null && airspeed >= 0 && setField(this.state.airspeed, airspeed, "VFR_HUD", 1, now)) {
        changed.push("airspeed");
      }
    }

    decodeAirspeed(view, now, changed) {
      const airspeed = read(view, "getFloat32", 0, 4);
      if (airspeed !== null && airspeed >= 0 && setField(this.state.airspeed, airspeed, "AIRSPEED", 2, now)) {
        changed.push("airspeed");
      }
    }

    decodeAltitude(view, now, changed) {
      const altitudeTerrain = read(view, "getFloat32", 24, 4);
      if (
        altitudeTerrain !== null &&
        altitudeTerrain > -1000 &&
        setField(this.state.agl, altitudeTerrain, "Terrain estimate", 3, now)
      ) {
        changed.push("agl");
      }
    }

    decodeTerrain(view, now, changed) {
      const currentHeight = read(view, "getFloat32", 12, 4);
      if (currentHeight !== null && currentHeight >= 0 && setField(this.state.agl, currentHeight, "Terrain", 3, now)) {
        changed.push("agl");
      }
    }

    decodeDistanceSensor(view, now, changed) {
      const currentDistance = read(view, "getUint16", 8, 2);
      const orientation = read(view, "getUint8", 12, 1);
      if (
        currentDistance !== null &&
        orientation === 25 &&
        setField(this.state.agl, currentDistance / 100, "Downward rangefinder", 4, now)
      ) {
        changed.push("agl");
      }
    }

    decodeRangefinder(view, now, changed) {
      const distance = read(view, "getFloat32", 0, 4);
      if (distance !== null && distance >= 0 && setField(this.state.agl, distance, "Rangefinder", 4, now)) {
        changed.push("agl");
      }
    }

    decodeSystemStatus(view, now, changed) {
      const voltageMillivolts = read(view, "getUint16", 14, 2);
      const currentCentiamps = read(view, "getInt16", 16, 2);
      const remaining = read(view, "getInt8", 30, 1);

      this.updateBattery(voltageMillivolts, currentCentiamps, remaining, "SYS_STATUS", 1, now, changed);
    }

    decodeBatteryStatus(view, now, changed) {
      const batteryId = read(view, "getUint8", 32, 1);
      if (batteryId !== null && batteryId !== 0) {
        return;
      }

      let voltageMillivolts = 0;
      let hasVoltage = false;
      for (let index = 0; index < 10; index += 1) {
        const cellVoltage = read(view, "getUint16", 10 + index * 2, 2);
        if (cellVoltage !== null && cellVoltage !== 0xffff) {
          voltageMillivolts += cellVoltage;
          hasVoltage = true;
        }
      }

      const currentCentiamps = read(view, "getInt16", 30, 2);
      const remaining = read(view, "getInt8", 35, 1);
      this.updateBattery(
        hasVoltage ? voltageMillivolts : null,
        currentCentiamps,
        remaining,
        "BATTERY_STATUS",
        2,
        now,
        changed,
      );
    }

    updateBattery(voltageMillivolts, currentCentiamps, remaining, source, priority, now, changed) {
      if (
        voltageMillivolts !== null &&
        voltageMillivolts !== 0xffff &&
        voltageMillivolts > 0 &&
        setField(this.state.batteryVoltage, voltageMillivolts / 1000, source, priority, now)
      ) {
        changed.push("battery");
      }

      if (
        currentCentiamps !== null &&
        currentCentiamps !== -1 &&
        setField(this.state.batteryCurrent, Math.abs(currentCentiamps) / 100, source, priority, now)
      ) {
        changed.push("battery");
      }

      if (
        remaining !== null &&
        remaining >= 0 &&
        remaining <= 100 &&
        setField(this.state.batteryRemaining, remaining, source, priority, now)
      ) {
        changed.push("battery");
      }
    }
  }

  const api = {
    CRC_EXTRA,
    MESSAGE,
    MavlinkStreamParser,
    TelemetryDecoder,
    x25Crc,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.MavMoleTelemetry = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
