"use strict";

const WebSocket = require("ws");
const { ROLE } = require("./constants");
const { encodeRelayFrame } = require("./protocol");
const { createLogger } = require("../utils/logger");

class BinaryRelay {
  constructor(connections, logger = createLogger("Relay")) {
    this.connections = connections;
    this.logger = logger;
    this.framesForwarded = 0;
    this.bytesForwarded = 0;
    this.framesDropped = 0;
  }

  forward(socket, data, isBinary) {
    const source = this.connections.metadata(socket);
    if (!source || source.role !== ROLE.MOLE) {
      this.logger.warn("Ignoring a frame from an unauthenticated or non-Mole connection.");
      return false;
    }
    if (!isBinary) {
      this.framesDropped += 1;
      return false;
    }

    const diggers = this.connections
      .allInTunnel(socket, ROLE.DIGGER)
      .filter((digger) => digger.readyState === WebSocket.OPEN);
    if (diggers.length === 0) {
      this.framesDropped += 1;
      return false;
    }

    const envelope = encodeRelayFrame(source.sourceId, data);
    for (const digger of diggers) {
      digger.send(envelope, { binary: true }, (error) => {
        if (error) {
          this.logger.error("Failed to forward a binary frame.", error);
        }
      });
    }
    this.framesForwarded += 1;
    this.bytesForwarded += data.length * diggers.length;
    return true;
  }

  snapshot() {
    return {
      framesForwarded: this.framesForwarded,
      bytesForwarded: this.bytesForwarded,
      framesDropped: this.framesDropped,
    };
  }
}

module.exports = { BinaryRelay };
