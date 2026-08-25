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

    const digger = this.connections.get(ROLE.DIGGER);

    if (!digger || digger.readyState !== WebSocket.OPEN) {
      this.framesDropped += 1;
      this.logger.debug("Dropping a Mole frame because no Digger is connected.", {
        bytes: data.length,
      });
      return false;
    }

    digger.send(data, { binary: true }, (error) => {
      if (error) {
        this.logger.error("Failed to forward a binary frame.", error);
      }
    });

    this.framesForwarded += 1;
    this.bytesForwarded += data.length;
    this.logger.debug("Forwarded a binary frame.", {
      bytes: data.length,
      frame: this.framesForwarded,
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
