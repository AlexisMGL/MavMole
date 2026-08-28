"use strict";

const http = require("node:http");
const path = require("node:path");
const { existsSync } = require("node:fs");
const express = require("express");
const { WebSocket, WebSocketServer } = require("ws");
const { ConnectionRegistry } = require("./websocket/connections");
const { BinaryRelay } = require("./websocket/relay");
const { CLOSE_CODE, ROLE, VALID_ROLES } = require("./websocket/constants");
const { containsMavlinkFrame } = require("./websocket/protocol");
const { createLogger } = require("./utils/logger");

const serverLogger = createLogger("Server");
const websocketLogger = createLogger("WebSocket");
const AUTH_TIMEOUT_MS = 10_000;
const MAX_AUTH_ATTEMPTS = 10;
const AUTH_WINDOW_MS = 60_000;

function rejectUpgrade(socket, statusCode, message) {
  const body = message + "\n";
  socket.write(
    "HTTP/1.1 " + statusCode + " " + message + "\r\n" +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Length: " + Buffer.byteLength(body) + "\r\n" +
      "\r\n" +
      body,
  );
  socket.destroy();
}

function requestOriginAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configuredOrigins.includes(origin)) {
    return true;
  }
  try {
    return new URL(origin).host === request.headers.host;
  } catch (_error) {
    return false;
  }
}

function createAuthLimiter() {
  const attempts = new Map();
  return {
    allow(address) {
      const now = Date.now();
      const current = attempts.get(address);
      if (!current || current.resetAt <= now) {
        attempts.delete(address);
        return true;
      }
      return current.count < MAX_AUTH_ATTEMPTS;
    },
    fail(address) {
      const now = Date.now();
      const current = attempts.get(address);
      if (!current || current.resetAt <= now) {
        attempts.set(address, { count: 1, resetAt: now + AUTH_WINDOW_MS });
      } else {
        current.count += 1;
      }
    },
  };
}

function socketAddress(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function sendControl(socket, message, callback) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message), callback);
}

function createMavMoleServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const connections = new ConnectionRegistry();
  const relay = new BinaryRelay(connections);
  const authLimiter = createAuthLimiter();
  const sourcePublicDirectory = path.join(__dirname, "..", "public");
  const builtPublicDirectory = path.join(__dirname, "..", "dist");
  const publicDirectory =
    process.env.NODE_ENV === "production" && existsSync(builtPublicDirectory)
      ? builtPublicDirectory
      : sourcePublicDirectory;
  const iconDirectory = path.join(__dirname, "..", "assets", "icons");

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": [
        "default-src 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "object-src 'none'",
        "script-src 'self' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com",
        "img-src 'self' data: blob: https://server.arcgisonline.com",
        "connect-src 'self' ws: wss: https://server.arcgisonline.com",
      ].join("; "),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (process.env.NODE_ENV === "production") {
      response.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      connections: connections.snapshot(),
      relay: relay.snapshot(),
    });
  });

  app.get("/api/stats", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json(connections.snapshot());
  });

  app.get("/api/streams", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ streams: connections.publicStreams() });
  });

  app.get("/mole", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "mole.html"));
  });

  app.get("/dig", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "dig.html"));
  });

  app.use("/assets/icons", express.static(iconDirectory, {
    dotfiles: "deny",
    fallthrough: false,
    immutable: process.env.NODE_ENV === "production",
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
  }));
  app.use(express.static(publicDirectory, {
    dotfiles: "deny",
    index: "index.html",
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }));

  httpServer.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, "http://" + (request.headers.host || "localhost"));
    } catch (error) {
      websocketLogger.warn("Rejected an invalid WebSocket URL.", error);
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (url.pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!requestOriginAllowed(request)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const role = url.searchParams.get("role");
    if (!VALID_ROLES.has(role)) {
      rejectUpgrade(socket, 400, "Invalid role");
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, role);
    });
  });

  function broadcastPresence() {
    for (const client of websocketServer.clients) {
      const presence = connections.presence(client);
      if (presence) {
        sendControl(client, presence);
      }
    }
  }

  function broadcastInTunnel(sourceSocket, message, exclude = null) {
    const recipients = [
      ...connections.allInTunnel(sourceSocket, ROLE.MOLE),
      ...connections.allInTunnel(sourceSocket, ROLE.DIGGER),
    ];
    for (const client of recipients) {
      if (client !== exclude) {
        sendControl(client, message);
      }
    }
  }

  websocketServer.on("connection", (socket, request, role) => {
    socket.isAlive = true;
    socket.requestedRole = role;
    socket.authenticating = false;
    const address = socketAddress(request);
    const secureTransport =
      Boolean(request.socket.encrypted) ||
      String(request.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    const authTimer = setTimeout(() => {
      if (!connections.metadata(socket)) {
        socket.close(CLOSE_CODE.AUTHENTICATION_REQUIRED, "Tunnel authentication timed out.");
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", async (data, isBinary) => {
      const metadata = connections.metadata(socket);
      if (!metadata) {
        if (isBinary || socket.authenticating) {
          return;
        }
        if (data.length > 1024) {
          socket.close(CLOSE_CODE.AUTHENTICATION_REQUIRED, "Invalid tunnel authentication.");
          return;
        }
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch (_error) {
          socket.close(CLOSE_CODE.AUTHENTICATION_REQUIRED, "Tunnel authentication required.");
          return;
        }
        if (message?.type !== "tunnel.join") {
          socket.close(CLOSE_CODE.AUTHENTICATION_REQUIRED, "Tunnel authentication required.");
          return;
        }
        if (!authLimiter.allow(address)) {
          sendControl(socket, {
            type: "tunnel.error",
            code: "RATE_LIMITED",
            message: "Too many connection attempts. Try again in one minute.",
          }, () => socket.close(CLOSE_CODE.RATE_LIMITED, "Too many attempts."));
          return;
        }

        socket.authenticating = true;
        try {
          const joined = await connections.join(role, socket, {
            name: message.stream,
            password: message.password,
            isPrivate: message.private,
            mode: message.mode,
          });
          if (socket.readyState !== WebSocket.OPEN) {
            connections.remove(socket);
            return;
          }
          clearTimeout(authTimer);
          sendControl(socket, {
            type: "tunnel.joined",
            ...joined,
            secureTransport,
          });
          broadcastPresence();
        } catch (error) {
          authLimiter.fail(address);
          websocketLogger.warn("Tunnel authentication rejected.", {
            role,
            address,
            code: error.code || "INTERNAL",
          });
          sendControl(socket, {
            type: "tunnel.error",
            code: ["AUTH_FAILED", "NOT_FOUND"].includes(error.code) ? "AUTH_FAILED" : error.code || "INTERNAL",
            message: error.code ? error.message : "Unable to join the tunnel.",
          }, () => socket.close(CLOSE_CODE.INVALID_TUNNEL, "Tunnel authentication failed."));
        } finally {
          socket.authenticating = false;
        }
        return;
      }

      if (!isBinary || metadata.role !== ROLE.MOLE) {
        return;
      }
      if (!metadata.active && containsMavlinkFrame(socket, data)) {
        const activeSource = connections.markMoleActive(socket);
        if (activeSource) {
          broadcastInTunnel(socket, {
            type: "stream.mole_active",
            ...activeSource,
          }, socket);
          broadcastPresence();
        }
      }
      relay.forward(socket, data, true);
    });

    socket.on("error", (error) => {
      websocketLogger.error(role + " socket error.", error);
    });

    socket.on("close", (code, reason) => {
      clearTimeout(authTimer);
      const closingMetadata = connections.metadata(socket);
      if (closingMetadata?.role === ROLE.MOLE && closingMetadata.active) {
        broadcastInTunnel(socket, {
          type: "stream.mole_left",
          sourceId: closingMetadata.sourceId,
          label: closingMetadata.label,
        }, socket);
      }
      const removed = connections.remove(socket);
      if (removed) {
        broadcastPresence();
      }
      websocketLogger.info(role + " socket closed.", {
        code,
        reason: reason.toString(),
      });
    });

    sendControl(socket, {
      type: "tunnel.hello",
      authenticationRequired: true,
      secureTransport,
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of websocketServer.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  websocketServer.on("close", () => {
    clearInterval(heartbeat);
  });

  function close(callback) {
    connections.closeAll();
    websocketServer.close(() => {
      httpServer.close(callback);
    });
  }

  return { app, httpServer, websocketServer, connections, relay, close };
}

function start() {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const service = createMavMoleServer();
  service.httpServer.listen(port, "0.0.0.0", () => {
    serverLogger.info("Listening on http://0.0.0.0:" + port);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    serverLogger.info("Received " + signal + "; closing connections.");
    service.close(() => {
      serverLogger.info("Shutdown complete.");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return service;
}

if (require.main === module) {
  start();
}

module.exports = { createMavMoleServer, start };
