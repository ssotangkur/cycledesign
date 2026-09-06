#!/usr/bin/env node
/**
 * Single source of truth for CycleDesign dev ports.
 *
 * Base ports: web=3000, server=3001, preview=3002.
 * Effective ports = base + localOffset + (e2e ? e2eOffset : 0)
 *
 * - localOffset: per-checkout isolation so two clones (e.g. `cycledesign`
 *   and `cycledesign-2`) can run side by side. Read from `.ports.local.json`
 *   (`{ "offset": 100 }`, git-ignored), overridden by `PORT_OFFSET` env.
 * - e2eOffset: extra isolation for Playwright so E2E servers never compete
 *   with manual dev servers. From `E2E_PORT_OFFSET` env (default 50),
 *   applied only when e2e mode is requested.
 *
 * Usage from Node (CJS or ESM via createRequire):
 *   const { getPorts } = require('./scripts/ports.cjs');
 *   const { web, server, preview } = getPorts({ e2e: false });
 *
 * CLI:
 *   node scripts/ports.cjs [--e2e] [--json|--env]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_PORTS = { web: 3000, server: 3001, preview: 3002 };
const DEFAULT_E2E_OFFSET = 50;
const E2E_ENV_FLAG = 'CYCLEDESIGN_E2E';

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readLocalFileOffset() {
  const file = path.join(repoRoot(), '.ports.local.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const offset = Number(parsed.offset);
    if (Number.isInteger(offset) && offset >= 0 && offset <= 10000) {
      return offset;
    }
    console.warn(`[ports] Ignoring invalid offset in .ports.local.json: ${JSON.stringify(parsed.offset)}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[ports] Could not read .ports.local.json: ${err.message}`);
    }
  }
  return 0;
}

function parseOffsetEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`[ports] Invalid ${name}=${JSON.stringify(raw)} (expected integer 0-10000)`);
  }
  return value;
}

/** Per-checkout offset: PORT_OFFSET env wins, otherwise .ports.local.json, otherwise 0. */
function getLocalOffset() {
  if (process.env.PORT_OFFSET !== undefined && process.env.PORT_OFFSET !== '') {
    return parseOffsetEnv('PORT_OFFSET', 0);
  }
  return readLocalFileOffset();
}

function getE2EOffset() {
  return parseOffsetEnv('E2E_PORT_OFFSET', DEFAULT_E2E_OFFSET);
}

function isE2E(options) {
  if (options && typeof options.e2e === 'boolean') {
    return options.e2e;
  }
  return process.env[E2E_ENV_FLAG] === '1';
}

/**
 * Resolve effective ports.
 * Explicit per-service env vars (WEB_PORT/SERVER_PORT/PREVIEW_PORT, or PORT
 * for the server) always win so wrappers can pin ports without a file.
 */
function getPorts(options) {
  const e2e = isE2E(options);
  const offset = getLocalOffset() + (e2e ? getE2EOffset() : 0);
  const ports = {
    web: BASE_PORTS.web + offset,
    server: BASE_PORTS.server + offset,
    preview: BASE_PORTS.preview + offset,
  };
  for (const port of Object.values(ports)) {
    if (port > 65535) {
      throw new Error(`[ports] Resolved port ${port} exceeds 65535 (offset ${offset} too large)`);
    }
  }
  if (process.env.WEB_PORT) {
    ports.web = Number(process.env.WEB_PORT);
  }
  if (process.env.SERVER_PORT) {
    ports.server = Number(process.env.SERVER_PORT);
  }
  if (process.env.PREVIEW_PORT) {
    ports.preview = Number(process.env.PREVIEW_PORT);
  }
  return { ...ports, offset, e2e };
}

module.exports = { BASE_PORTS, DEFAULT_E2E_OFFSET, E2E_ENV_FLAG, getLocalOffset, getE2EOffset, getPorts };

if (require.main === module) {
  const args = process.argv.slice(2);
  const e2e = args.includes('--e2e');
  const ports = getPorts({ e2e });
  if (args.includes('--env')) {
    console.log(`WEB_PORT=${ports.web}`);
    console.log(`SERVER_PORT=${ports.server}`);
    console.log(`PREVIEW_PORT=${ports.preview}`);
    console.log(`${E2E_ENV_FLAG}=${e2e ? '1' : '0'}`);
  } else {
    console.log(JSON.stringify(ports));
  }
}
