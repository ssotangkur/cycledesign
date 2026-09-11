#!/usr/bin/env node
/**
 * Cross-platform spawn with logging
 * Runs a command, logs output to both console and file
 * 
 * Usage: node spawn-log.js [--truncate] <log-file> <command> [args...]
 * 
 * Example: node spawn-log.js tmp/server.log npm run dev:server
 * Example: node spawn-log.js --truncate tmp/daemon.log npx tsx scripts/agent-supervisor.ts
 *
 * `--truncate` empties the log file on wrapper start (one Starting: line per
 * manual start). Without it the file is appended to (dev-server/dev-web logs).
 * Only a single leading `--truncate` is stripped; everything after <command>
 * is opaque and never option-parsed so `npm run agent-daemon -- <flags>`
 * still reaches the wrapped process verbatim.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rawArgs = process.argv.slice(2);

// Strip at most one leading --truncate; everything after <command> is opaque.
let truncate = false;
let args = rawArgs;
if (args[0] === '--truncate') {
  truncate = true;
  args = args.slice(1);
}

if (args.length < 2) {
  console.error('Usage: spawn-log.js [--truncate] <log-file> <command> [args...]');
  process.exit(1);
}

const logFile = args[0];
const command = args[1];
const commandArgs = args.slice(2);

// Ensure log directory exists
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// --truncate: empty the file on each wrapper start (manual restarts stay
// bounded; within a single run the file can still grow unbounded).
if (truncate) {
  fs.writeFileSync(logFile, '');
}

// Create log write stream (append mode)
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

const timestamp = new Date().toISOString();
const truncateNote = truncate
  ? ' (log truncated on start; within-run growth is unbounded — truncate manually as needed)'
  : '';
const startMessage = `\n[${timestamp}] Starting: ${command} ${commandArgs.join(' ')}${truncateNote}\n`;
logStream.write(startMessage);
console.log(startMessage);

// Run the command
const child = spawn(command, commandArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

function log(data, prefix = '') {
  const text = prefix + data.toString();
  process.stdout.write(text);
  logStream.write(text);
}

child.stdout.on('data', (data) => {
  log(data);
});

child.stderr.on('data', (data) => {
  log(data, '[stderr] ');
});

child.on('error', (err) => {
  const errorMessage = `[ERROR] Failed to start ${command}: ${err.message}\n`;
  log(errorMessage);
  logStream.end();
  process.exit(1);
});

// `forwarded` is read by the `close` handler below and written by the
// signal handlers further down; declared up-front (no TDZ surprises).
let forwarded = null;

// Signal number map for 128+n mapping of unforwarded signal deaths.
const SIGNAL_NUMBERS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

child.on('close', (code, signal) => {
  if (code !== null && code !== undefined) {
    const endMessage = `[${new Date().toISOString()}] Process exited with code ${code}\n`;
    log(endMessage);
    logStream.end();
    process.exit(code);
  }
  // Signal death (code === null): preserve the wrapped process's contract.
  // A death following an intentionally forwarded SIGINT/SIGTERM exits 0
  // (never 130 — that would re-enter crash-restart logic upstream).
  if (forwarded !== null) {
    const endMessage = `[${new Date().toISOString()}] Process terminated by ${signal || 'signal'} after forwarded ${forwarded}, exiting 0\n`;
    log(endMessage);
    logStream.end();
    process.exit(0);
  }
  const signo = SIGNAL_NUMBERS[signal] || 0;
  const mapped = signo > 0 ? 128 + signo : 1;
  const endMessage = `[${new Date().toISOString()}] Process terminated by ${signal || 'signal'}, exiting ${mapped}\n`;
  log(endMessage);
  logStream.end();
  process.exit(mapped);
});

// Signal forwarding: the wrapped process (e.g. the supervisor's 12s grace
// teardown) owns cleanup, so the first signal is forwarded exactly once and
// the wrapper keeps waiting for `close` (no immediate exit, no own timeout).
// A second signal escalates to tree-kill + non-zero exit. `forwarded` makes
// this idempotent for Windows Ctrl+C broadcasts delivered to both wrapper
// and child directly.
function treeKillSync(childProc) {
  if (!childProc || childProc.pid === undefined) {
    return;
  }
  const pid = childProc.pid;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          childProc.kill('SIGKILL');
        } catch {
          // Best-effort: the process may already be gone.
        }
      }
    }
  } catch {
    try {
      childProc.kill('SIGKILL');
    } catch {
      // Best-effort: the process may already be gone.
    }
  }
}

function forwardSignal(signal) {
  if (forwarded === null) {
    forwarded = signal;
    console.log(`\nReceived ${signal}, forwarding to child...`);
    try {
      child.kill(signal);
    } catch {
      // Best-effort: child may already be gone; `close` still fires.
    }
    return;
  }
  console.log(`\nReceived second ${signal}, force-killing...`);
  treeKillSync(child);
  try {
    logStream.end();
  } catch {
    // Best-effort.
  }
  process.exit(1);
}

// Handle Ctrl+C / SIGTERM gracefully (forward, don't truncate teardown)
process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
