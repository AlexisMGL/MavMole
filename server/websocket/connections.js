"use strict";

const { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { JOIN_MODE, ROLE, CLOSE_CODE } = require("./constants");
const { createLogger } = require("../utils/logger");

const derivePassword = promisify(scrypt);
const DEFAULT_STREAM = "public";
const STREAM_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u;

class TunnelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TunnelError";
    this.code = code;
  }
}

function normalizeStreamName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!STREAM_NAME_PATTERN.test(name)) {
    throw new TunnelError("INVALID_NAME", "Use 1 to 48 letters, numbers, spaces, dots, dashes or underscores.");
  }
  return { name, key: name.toLocaleLowerCase("en-US") };
}

async function createPasswordRecord(password) {
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return { salt, digest };
}

async function passwordMatches(password, record) {
  const candidate = await derivePassword(password, record.salt, record.digest.length, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return timingSafeEqual(candidate, record.digest);
}

class ConnectionRegistry {
  constructor(logger = createLogger("Connections")) {
    this.logger = logger;
    this.tunnels = new Map();
    this.socketMetadata = new WeakMap();
  }

  createTunnel({ name, key, isPrivate, password }) {
    if (isPrivate && (password.length < 4 || password.length > 128)) {
      throw new TunnelError("INVALID_PASSWORD", "Private tunnel passwords must contain 4 to 128 characters.");
    }

    const tunnel = {
      id: randomUUID(),
      key,
      name,
      isPrivate,
      passwordRecord: null,
      passwordReady: null,
      createdAt: Date.now(),
      moles: new Map(),
      diggers: new Set(),
    };
    if (isPrivate) {
      tunnel.passwordReady = createPasswordRecord(password).then((record) => {
        tunnel.passwordRecord = record;
        return record;
      });
    } else {
      tunnel.passwordReady = Promise.resolve(null);
    }
    this.tunnels.set(key, tunnel);
    return tunnel;
  }

  allocateSourceId(tunnel) {
    let sourceId;
    do {
      sourceId = randomInt(1, 0x100000000);
    } while (tunnel.moles.has(sourceId));
    return sourceId;
  }

  async join(role, socket, options = {}) {
    if (!Object.values(ROLE).includes(role)) {
      throw new TunnelError("INVALID_ROLE", "Invalid tunnel role.");
    }
    if (this.socketMetadata.has(socket)) {
      throw new TunnelError("ALREADY_JOINED", "This connection already joined a tunnel.");
    }

    const { name, key } = normalizeStreamName(options.name || DEFAULT_STREAM);
    const password = String(options.password || "");
    if (password.length > 128) {
      throw new TunnelError("AUTH_FAILED", "Tunnel not found or credentials are incorrect.");
    }
    const mode = options.mode === JOIN_MODE.JOIN ? JOIN_MODE.JOIN : JOIN_MODE.CREATE;
    const isPrivate = options.isPrivate === true;
    let tunnel = this.tunnels.get(key);

    if (!tunnel) {
      const legacyPublicViewer = role === ROLE.DIGGER && key === DEFAULT_STREAM && password.length === 0;
      if (mode === JOIN_MODE.JOIN && !legacyPublicViewer) {
        throw new TunnelError("NOT_FOUND", "Tunnel not found or credentials are incorrect.");
      }
      if (role === ROLE.DIGGER && !legacyPublicViewer) {
        throw new TunnelError("NOT_FOUND", "Tunnel not found or credentials are incorrect.");
      }
      tunnel = this.createTunnel({ name, key, isPrivate, password });
    }

    try {
      await tunnel.passwordReady;
    } catch (error) {
      if (this.tunnels.get(key) === tunnel) {
        this.tunnels.delete(key);
      }
      throw error;
    }

    if (tunnel.isPrivate) {
      const authenticated = password.length > 0 && await passwordMatches(password, tunnel.passwordRecord);
      if (!authenticated) {
        throw new TunnelError("AUTH_FAILED", "Tunnel not found or credentials are incorrect.");
      }
    }
    if (role === ROLE.MOLE && mode === JOIN_MODE.CREATE && isPrivate !== tunnel.isPrivate) {
      throw new TunnelError(
        "CONFIG_MISMATCH",
        "A tunnel with this name already exists with different privacy settings.",
      );
    }

    const metadata = {
      role,
      tunnel,
      sourceId: null,
      label: null,
      active: false,
      joinedAt: Date.now(),
    };
    if (role === ROLE.MOLE) {
      metadata.sourceId = this.allocateSourceId(tunnel);
      metadata.label = "Mole " + metadata.sourceId.toString(36).toUpperCase().slice(-5);
      tunnel.moles.set(metadata.sourceId, socket);
    } else {
      tunnel.diggers.add(socket);
    }
    this.socketMetadata.set(socket, metadata);
    this.logger.info(role + " joined a tunnel.", {
      tunnelId: tunnel.id,
      private: tunnel.isPrivate,
      moles: tunnel.moles.size,
      viewers: tunnel.diggers.size,
    });
    return this.describeSocket(socket);
  }

  metadata(socket) {
    return this.socketMetadata.get(socket) || null;
  }

  describeSocket(socket) {
    const metadata = this.metadata(socket);
    if (!metadata) {
      return null;
    }
    return {
      tunnelId: metadata.tunnel.id,
      stream: metadata.tunnel.name,
      private: metadata.tunnel.isPrivate,
      role: metadata.role,
      sourceId: metadata.sourceId,
      label: metadata.label,
      sources: Array.from(metadata.tunnel.moles.entries())
        .map(([sourceId, moleSocket]) => ({ sourceId, metadata: this.metadata(moleSocket) }))
        .filter((source) => source.metadata?.active)
        .map((source) => ({ sourceId: source.sourceId, label: source.metadata.label })),
    };
  }

  markMoleActive(socket) {
    const metadata = this.metadata(socket);
    if (!metadata || metadata.role !== ROLE.MOLE || metadata.active) {
      return null;
    }
    metadata.active = true;
    return {
      sourceId: metadata.sourceId,
      label: metadata.label,
      stream: metadata.tunnel.name,
    };
  }

  allInTunnel(socket, role) {
    const metadata = this.metadata(socket);
    if (!metadata) {
      return [];
    }
    if (role === ROLE.MOLE) {
      return Array.from(metadata.tunnel.moles.values());
    }
    return Array.from(metadata.tunnel.diggers);
  }

  presence(socket) {
    const metadata = this.metadata(socket);
    if (!metadata) {
      return null;
    }
    const tunnel = metadata.tunnel;
    const activeMoles = Array.from(tunnel.moles.values())
      .filter((moleSocket) => this.metadata(moleSocket)?.active).length;
    return {
      type: "stream.presence",
      stream: tunnel.name,
      tunnelId: tunnel.id,
      private: tunnel.isPrivate,
      viewers: tunnel.diggers.size,
      moles: activeMoles,
      connectedMoles: tunnel.moles.size,
      sourceConnected: activeMoles > 0,
      streams: this.tunnels.size,
      totalViewers: this.total(ROLE.DIGGER),
    };
  }

  total(role) {
    let count = 0;
    for (const tunnel of this.tunnels.values()) {
      count += role === ROLE.MOLE ? tunnel.moles.size : tunnel.diggers.size;
    }
    return count;
  }

  remove(socket) {
    const metadata = this.metadata(socket);
    if (!metadata) {
      return null;
    }
    const tunnel = metadata.tunnel;
    if (metadata.role === ROLE.MOLE) {
      tunnel.moles.delete(metadata.sourceId);
    } else {
      tunnel.diggers.delete(socket);
    }
    this.socketMetadata.delete(socket);
    const removedTunnel = tunnel.moles.size === 0 && tunnel.diggers.size === 0;
    if (removedTunnel) {
      this.tunnels.delete(tunnel.key);
    }
    this.logger.info(metadata.role + " left a tunnel.", {
      tunnelId: tunnel.id,
      removedTunnel,
    });
    return {
      role: metadata.role,
      sourceId: metadata.sourceId,
      label: metadata.label,
      wasActive: metadata.active,
      tunnel,
      removedTunnel,
    };
  }

  snapshot() {
    return {
      streams: this.tunnels.size,
      moles: this.total(ROLE.MOLE),
      viewers: this.total(ROLE.DIGGER),
    };
  }

  publicStreams() {
    return Array.from(this.tunnels.values())
      .filter((tunnel) => !tunnel.isPrivate)
      .map((tunnel) => ({
        id: tunnel.id,
        name: tunnel.name,
        moles: Array.from(tunnel.moles.values())
          .filter((socket) => this.metadata(socket)?.active).length,
        viewers: tunnel.diggers.size,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  closeAll() {
    for (const tunnel of this.tunnels.values()) {
      for (const socket of [...tunnel.moles.values(), ...tunnel.diggers]) {
        socket.close(CLOSE_CODE.SHUTDOWN, "MavMole server is restarting.");
      }
    }
    this.tunnels.clear();
  }
}

module.exports = {
  ConnectionRegistry,
  DEFAULT_STREAM,
  TunnelError,
  normalizeStreamName,
};
