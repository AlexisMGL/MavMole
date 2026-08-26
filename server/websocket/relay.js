"use strict";

const WebSocket = require("ws");
const { ROLE } = require("./constants");
const { createLogger } = require("../utils/logger");

class BinaryRelay {
  constructor(connections, logger = createLogger("Relay")) {
    this.connections = connections;
    this.logger = logger;
    this.framesForwarded = 0;
    this.bytesForwarded = 0;
    this.framesDropped = 0;
  }

  forward(role, data, isBinary) {
    if (role !== ROLE.MOLE) {
      this.logger.warn(`Ignoring a frame sent by ${role}; V1 is Mole to Digger only.`);
      return false;
    }

    if (!isBinary) {
      this.logger.warn("Ignoring a non-binary frame from the Mole.");
      this.framesDropped += 1;
      return false;
    }

    const diggers = this.connections
      .all(ROLE.DIGGER)
      .filter((digger) => digger.readyState === WebSocket.OPEN);

    if (diggers.length === 0) {
      this.framesDropped += 1;
      this.logger.debug("Dropping a Mole frame because no viewer is connected.", {
        bytes: data.length,
      });
      return false;
    }

    for (const digger of diggers) {
      digger.send(data, { binary: true }, (error) => {
        if (error) {
          this.logger.error("Failed to forward a binary frame.", error);
        }
      });
    }

    this.framesForwarded += 1;
    this.bytesForwarded += data.length * diggers.length;
    this.logger.debug("Forwarded a binary frame.", {
      bytes: data.length,
      frame: this.framesForwarded,
      viewers: diggers.length,
    });
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
