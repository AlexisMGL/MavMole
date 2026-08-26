"use strict";

const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { WebSocket, WebSocketServer } = require("ws");
const { ConnectionRegistry } = require("./websocket/connections");
const { BinaryRelay } = require("./websocket/relay");
const { ROLE, VALID_ROLES } = require("./websocket/constants");
const { createLogger } = require("./utils/logger");

const serverLogger = createLogger("Server");
const websocketLogger = createLogger("WebSocket");

function rejectUpgrade(socket, statusCode, message) {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
  );
  socket.destroy();
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
  const publicDirectory = path.join(__dirname, "..", "public");
  const assetsDirectory = path.join(__dirname, "..", "assets");

  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      connections: connections.snapshot(),
      relay: relay.snapshot(),
    });
  });

  app.get("/api/config", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
    });
  });

  app.get("/mole", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "mole.html"));
  });

  app.get("/dig", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "dig.html"));
  });

  app.use("/assets", express.static(assetsDirectory));
  app.use(express.static(publicDirectory));

  httpServer.on("upgrade", (request, socket, head) => {
    let url;

    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch (error) {
      websocketLogger.warn("Rejected an invalid WebSocket URL.", error);
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (url.pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const role = url.searchParams.get("role");

    if (!VALID_ROLES.has(role)) {
      websocketLogger.warn("Rejected a connection with an invalid role.", { role });
      rejectUpgrade(socket, 400, "Invalid role");
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, role);
    });
  });

  websocketServer.on("connection", (socket, request, role) => {
    socket.isAlive = true;
    connections.register(role, socket);
    websocketLogger.info(`Accepted ${role} from ${request.socket.remoteAddress}.`);

    const broadcastPresence = () => {
      const message = JSON.stringify({
        type: "stream.presence",
        viewers: connections.count(ROLE.DIGGER),
        sourceConnected: connections.count(ROLE.MOLE) > 0,
      });

      for (const client of websocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    };

    broadcastPresence();

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data, isBinary) => {
      relay.forward(role, data, isBinary);
    });

    socket.on("error", (error) => {
      websocketLogger.error(`${role} socket error.`, error);
    });

    socket.on("close", (code, reason) => {
      const removed = connections.remove(role, socket);
      if (removed) {
        broadcastPresence();
      }
      websocketLogger.info(`${role} socket closed.`, {
        code,
        reason: reason.toString(),
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of websocketServer.clients) {
      if (!socket.isAlive) {
        websocketLogger.warn("Terminating an unresponsive WebSocket client.");
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
    serverLogger.info(`Listening on http://0.0.0.0:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    serverLogger.info(`Received ${signal}; closing connections.`);
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
