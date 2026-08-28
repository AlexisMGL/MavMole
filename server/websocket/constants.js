"use strict";

const ROLE = Object.freeze({
  MOLE: "mole",
  DIGGER: "digger",
});

const VALID_ROLES = new Set(Object.values(ROLE));

const JOIN_MODE = Object.freeze({
  CREATE: "create",
  JOIN: "join",
});

const CLOSE_CODE = Object.freeze({
  SHUTDOWN: 1001,
  AUTHENTICATION_REQUIRED: 4003,
  INVALID_TUNNEL: 4004,
  RATE_LIMITED: 4008,
});

module.exports = { ROLE, VALID_ROLES, JOIN_MODE, CLOSE_CODE };
