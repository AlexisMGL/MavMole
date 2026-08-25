"use strict";

const { WebSocketServer } = require("ws");

const port = Number.parseInt(process.env.LOCAL_SOURCE_PORT || "5863", 10);
const server = new WebSocketServer({ host: "127.0.0.1", port });
let sequence = 0;

server.on("listening", () => {
  console.log(`[Fake Mission Planner] Listening on ws://127.0.0.1:${port}`);
  console.log("[Fake Mission Planner] Enter that URL on the Mole page.");
});

server.on("connection", (socket) => {
  console.log("[Fake Mission Planner] Browser connected.");

  const timer = setInterval(() => {
    // MAVLink-v2-looking bytes for transport testing only. This is not a valid packet.
    const frame = Buffer.from([
      0xfd,
      0x04,
      0x00,
      0x00,
      sequence & 0xff,
      0x01,
      0x01,
      0x00,
      0x00,
      0x00,
      0x4d,
      0x4f,
      0x4c,
      0x45,
      0x00,
      0x00,
    ]);
    sequence += 1;
    socket.send(frame, { binary: true });
  }, 100);

  socket.on("close", () => {
    clearInterval(timer);
    console.log("[Fake Mission Planner] Browser disconnected.");
  });
});

server.on("error", (error) => {
  console.error("[Fake Mission Planner] Server error.", error);
  process.exitCode = 1;
});

function shutdown() {
  console.log("[Fake Mission Planner] Shutting down.");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
