#!/usr/bin/env node
/**
 * Wrap a dev command with offset-aware port env vars.
 *
 * Computes ports via scripts/ports.cjs and exports:
 *   WEB_PORT, SERVER_PORT, PREVIEW_PORT,
 *   VITE_API_URL, VITE_WS_URL, VITE_TOOL_URL, VITE_PREVIEW_URL,
 *   CYCLEDESIGN_E2E=1 (only with --e2e)
 *
 * Usage:
 *   node scripts/run-with-ports.cjs [--e2e] [--kill-first] <command> [args...]
 *
 * --e2e stacks the E2E offset on top of the local offset so Playwright-owned
 * servers never share ports with manual dev servers (issue #76).
 * --kill-first kills the resolved (mode-scoped) ports before starting.
 * NEVER kills the other mode's ports.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const { getPorts, E2E_ENV_FLAG } = require('./ports.cjs');

const args = process.argv.slice(2);
const e2e = args.includes('--e2e');
const killFirst = args.includes('--kill-first');
const commandArgs = args.filter((a) => a !== '--e2e' && a !== '--kill-first');

if (commandArgs.length === 0) {
  console.error('Usage: run-with-ports.cjs [--e2e] [--kill-first] <command> [args...]');
  process.exit(1);
}

let ports;
try {
  ports = getPorts({ e2e });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (killFirst) {
  const kill = spawnSync(process.execPath, [require('path').join(__dirname, 'kill-ports.cjs'), ...(e2e ? ['--e2e'] : [])], {
    stdio: 'inherit',
  });
  if (kill.status !== 0) {
    process.exit(kill.status || 1);
  }
}

const env = {
  ...process.env,
  WEB_PORT: String(ports.web),
  SERVER_PORT: String(ports.server),
  PREVIEW_PORT: String(ports.preview),
  VITE_API_URL: `http://localhost:${ports.server}`,
  VITE_WS_URL: `ws://localhost:${ports.server}`,
  VITE_TOOL_URL: `http://localhost:${ports.web}`,
  VITE_PREVIEW_URL: `http://localhost:${ports.preview}`,
  ...(e2e ? { [E2E_ENV_FLAG]: '1' } : {}),
};

console.log(`[ports] mode=${e2e ? 'e2e' : 'dev'} web=${ports.web} server=${ports.server} preview=${ports.preview} (offset=${ports.offset})`);

const child = spawn(commandArgs[0], commandArgs.slice(1), { stdio: 'inherit', shell: true, env });
child.on('error', (err) => {
  console.error(`[ports] Failed to start ${commandArgs[0]}: ${err.message}`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code);
  }
});
