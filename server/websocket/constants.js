"use strict";

const ROLE = Object.freeze({
  MOLE: "mole",
  DIGGER: "digger",
});

const VALID_ROLES = new Set(Object.values(ROLE));

const CLOSE_CODE = Object.freeze({
  SHUTDOWN: 1001,
  REPLACED: 4001,
});

module.exports = { ROLE, VALID_ROLES, CLOSE_CODE };
