(function createMavMoleLogger(global) {
  "use strict";

  function write(method, scope, message, details) {
    const timestamp = new Date().toISOString();
    const prefix = `${timestamp} [MavMole][${scope}]`;

    if (details === undefined) {
      console[method](prefix, message);
      return;
    }

    console[method](prefix, message, details);
  }

  global.MavMoleLog = {
    scope(scope) {
      return {
        debug(message, details) {
          write("debug", scope, message, details);
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
    },
  };
})(window);
