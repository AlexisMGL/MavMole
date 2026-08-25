"use strict";

function write(level, scope, message, details) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [MavMole][${scope}]`;
  const output = details === undefined ? [prefix, message] : [prefix, message, details];

  if (level === "error") {
    console.error(...output);
    return;
  }

  if (level === "warn") {
    console.warn(...output);
    return;
  }

  console.log(...output);
}

function createLogger(scope) {
  return {
    debug(message, details) {
      if (process.env.LOG_LEVEL === "debug") {
        write("debug", scope, message, details);
      }
    },
    info(message, details) {
      write("info", scope, message, details);
    },
    warn(message, details) {
      write("warn", scope, message, details);
    },
    error(message, details) {
      write("error", scope, message, details);
    },
  };
}

module.exports = { createLogger };
