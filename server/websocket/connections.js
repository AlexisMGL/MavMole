/*  */"use strict";

const { CLOSE_CODE, ROLE } = require("./constants");
const { createLogger } = require("../utils/logger");

class ConnectionRegistry {
  constructor(logger = createLogger("Connections")) {
    this.logger = logger;
    this.sockets = new Map([
      [ROLE.MOLE, new Set()],
      [ROLE.DIGGER, new Set()],
    ]);
  }

  register(role, socket) {
    const roleSockets = this.sockets.get(role);

    if (role === ROLE.MOLE) {
      for (const previous of roleSockets) {
        if (previous !== socket) {
          this.logger.info("Replacing the current mole connection.");
          previous.close(CLOSE_CODE.REPLACED, "A new mole connected.");
          roleSockets.delete(previous);
        }
      }
    }

    roleSockets.add(socket);
    this.logger.info(`${role} connected.`, { count: roleSockets.size });
  }

  remove(role, socket) {
    const removed = this.sockets.get(role).delete(socket);
    if (removed) {
      this.logger.info(`${role} disconnected.`, { count: this.count(role) });
    }
    return removed;
  }

  get(role) {
    return this.all(role)[0] || null;
  }

  all(role) {
    return Array.from(this.sockets.get(role) || []);
  }

  count(role) {
    return this.sockets.get(role)?.size || 0;
  }

  snapshot() {
    return {
      mole: this.count(ROLE.MOLE) > 0,
      digger: this.count(ROLE.DIGGER) > 0,
      viewers: this.count(ROLE.DIGGER),
    };
  }

  closeAll() {
    for (const [role, roleSockets] of this.sockets.entries()) {
      for (const socket of roleSockets) {
        socket.close(CLOSE_CODE.SHUTDOWN, "MavMole server is restarting.");
      }
      roleSockets.clear();
    }
  }
}

module.exports = { ConnectionRegistry };
