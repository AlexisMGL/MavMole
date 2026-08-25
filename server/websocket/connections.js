"use strict";

const { CLOSE_CODE, ROLE } = require("./constants");
const { createLogger } = require("../utils/logger");

class ConnectionRegistry {
  constructor(logger = createLogger("Connections")) {
    this.logger = logger;
    this.sockets = new Map([
      [ROLE.MOLE, null],
      [ROLE.DIGGER, null],
    ]);
  }

  register(role, socket) {
    const previous = this.sockets.get(role);

    if (previous && previous !== socket) {
      this.logger.info(`Replacing the current ${role} connection.`);
      previous.close(CLOSE_CODE.REPLACED, `A new ${role} connected.`);
    }

    this.sockets.set(role, socket);
    this.logger.info(`${role} connected.`);
  }

  remove(role, socket) {
    if (this.sockets.get(role) !== socket) {
      return false;
    }

    this.sockets.set(role, null);
    this.logger.info(`${role} disconnected.`);
    return true;
  }

  get(role) {
    return this.sockets.get(role) || null;
  }

  snapshot() {
    return {
      mole: Boolean(this.get(ROLE.MOLE)),
      digger: Boolean(this.get(ROLE.DIGGER)),
    };
  }

  closeAll() {
    for (const [role, socket] of this.sockets.entries()) {
      if (socket) {
        socket.close(CLOSE_CODE.SHUTDOWN, "MavMole server is restarting.");
        this.sockets.set(role, null);
      }
    }
  }
}

module.exports = { ConnectionRegistry };
