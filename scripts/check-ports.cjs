#!/usr/bin/env node
/**
 * Fail-fast port diagnostics: report which ports are busy and (best-effort)
 * name the owning process for each.
 *
 * Usage: node scripts/check-ports.cjs [--e2e] [--port <n>]
 * Exit code is 1 when any checked port is busy, 0 when all are free.
 */
'use strict';

const { execSync } = require('child_process');
const net = require('net');
const { getPorts } = require('./ports.cjs');

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function findOwner(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p TCP | findstr ":${port} "`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = [...new Set(out.split('\n').map((l) => (l.trim().split(/\s+/)[4] || '').trim()).filter((pid) => pid && pid !== '0'))];
      const owners = pids.map((pid) => {
        try {
          const task = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          return `PID ${pid} (${task.split(',')[0].replace(/"/g, '')})`;
        } catch {
          return `PID ${pid}`;
        }
      });
      return owners.join(', ') || 'unknown process';
    }
    const out = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (!out) {
      return 'unknown process';
    }
    const pid = out.split('\n')[0].trim();
    try {
      const name = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim();
      return `PID ${pid} (${name})`;
    } catch {
      return `PID ${pid}`;
    }
  } catch {
    return 'unknown process';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const e2e = args.includes('--e2e');
  const portIdx = args.indexOf('--port');
  const singlePort = portIdx !== -1 ? Number(args[portIdx + 1]) : null;

  const ports = getPorts({ e2e });
  const targets =
    singlePort !== null
      ? [['custom', singlePort]]
      : [
          ['web', ports.web],
          ['server', ports.server],
          ['preview', ports.preview],
        ];

  let busy = 0;
  for (const [name, port] of targets) {
    if (await isPortOpen(port)) {
      busy += 1;
      console.error(`[ports] ${name} port ${port} is BUSY (owner: ${findOwner(port)})`);
    } else {
      console.log(`[ports] ${name} port ${port} is free`);
    }
  }
  if (busy > 0) {
    console.error(`[ports] ${busy} port(s) busy. If the owner is another checkout or stale E2E run, switch offsets or run node scripts/kill-ports.cjs${e2e ? ' --e2e' : ''}.`);
    process.exit(1);
  }
}

main();
