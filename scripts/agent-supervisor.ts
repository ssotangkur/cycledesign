#!/usr/bin/env node
/**
 * Tiny supervisor for scripts/agent-daemon.ts: spawn -> wait -> restart.
 *
 * Exit-code contract (from the daemon):
 *   0  = intentional stop (never restart)
 *   42 = update available (pull-if-clean, then restart; --once just exits 42)
 *   2  = usage/arg-parse error (never restart, exit immediately)
 *   any other non-zero = crash/transient (plain restart with backoff, no pull)
 *
 * Raw `process.argv.slice(2)` passthrough keeps future daemon flags (#107)
 * working with zero supervisor changes; only `--once` changes supervisor
 * behavior (single pass, no pull, exit with the child code).
 *
 * Usage:
 *   npx tsx scripts/agent-supervisor.ts [--repo OWNER/REPO] [--interval SECONDS] [--once] ...
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { treeKill } from './agent-tree-kill.js';

const EXIT_UPDATE = 42;
const EXIT_USAGE = 2;
const MAX_CRASH_RESTARTS = 5;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const UPDATE_RETRY_COOLDOWN_MS = 60_000;
// #127: grace wait for the daemon's synchronous teardown (sync lease
// release + `stop` + `rm --force` + `secret rm`). Windows console Ctrl+C is
// broadcast to all attached processes, so an immediate tree-kill here would
// truncate the daemon's own cleanup — wait first, tree-kill only on timeout.
const SIGNAL_GRACE_MS = 12_000;

let daemonChild: ChildProcess | null = null;
let signalReceived = false;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let childCloseResolve: ((code: number) => void) | null = null;

function waitForCloseOrTimeout(): Promise<'closed' | 'timeout'> {
  return new Promise((resolve) => {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      childCloseResolve = null;
      resolve('timeout');
    }, SIGNAL_GRACE_MS);
    childCloseResolve = () => {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      childCloseResolve = null;
      resolve('closed');
    };
  });
}

function clearGraceTimer(): void {
  if (graceTimer !== null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  childCloseResolve = null;
}

async function handleSupervisorSignal(signal: NodeJS.Signals): Promise<void> {
  if (signalReceived) {
    // Second signal: force tree-kill and exit non-zero.
    clearGraceTimer();
    treeKill(daemonChild);
    daemonChild = null;
    process.exit(1);
  }
  signalReceived = true;
  const child = daemonChild;
  if (child === null) {
    // Between runs: nothing to wait for.
    process.exit(0);
  }
  try {
    child.kill(signal);
  } catch {
    // Best-effort: child may already be gone.
  }
  const outcome = await waitForCloseOrTimeout();
  if (outcome === 'timeout') {
    console.error('[agent-supervisor] daemon did not exit within grace period, tree-killing');
    treeKill(daemonChild);
    daemonChild = null;
  }
  // First-signal path always exits 0 (intentional stop, never restart).
  process.exit(0);
}

process.on('SIGINT', () => void handleSupervisorSignal('SIGINT'));
process.on('SIGTERM', () => void handleSupervisorSignal('SIGTERM'));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTreeClean(): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (result.error) {
    return false;
  }
  return ((result.stdout || '').trim().length === 0);
}

function pullFastForwardOnly(): boolean {
  const result = spawnSync('git', ['pull', '--ff-only'], { encoding: 'utf8' });
  if (result.error) {
    console.error(`[agent-supervisor] git pull --ff-only failed to spawn: ${(result.error as Error).message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`[agent-supervisor] git pull --ff-only exited ${result.status}: ${((result.stderr || result.stdout || '') as string).trim()}`);
    return false;
  }
  return true;
}

function runChild(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // shell: true so Windows resolves the npx/tsx shims (same precedent as the daemon).
      // detached (posix only) gives the group-kill fallback a group leader to target.
      child = spawn('npx', ['tsx', 'scripts/agent-daemon.ts', ...args], {
        stdio: 'inherit',
        shell: true,
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      console.error(`[agent-supervisor] failed to spawn daemon: ${(err as Error).message}`);
      resolve(1);
      return;
    }

    daemonChild = child;

    child.on('error', (err) => {
      console.error(`[agent-supervisor] daemon spawn error: ${err.message}`);
      if (daemonChild === child) {
        daemonChild = null;
      }
      if (signalReceived && childCloseResolve !== null) {
        childCloseResolve(1);
      }
      resolve(1);
    });
    child.on('close', (code) => {
      // Null before resolving so a late signal can't kill the next child.
      if (daemonChild === child) {
        daemonChild = null;
      }
      if (signalReceived && childCloseResolve !== null) {
        childCloseResolve(code ?? 1);
      }
      resolve(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2);
  const once = forwarded.includes('--once');

  if (once) {
    const code = await runChild(forwarded);
    process.exit(code);
  }

  const crashTimes: number[] = [];
  let consecutiveCrashes = 0;

  for (;;) {
    const code = await runChild(forwarded);

    if (code === 0) {
      console.log('[agent-supervisor] daemon exited 0 (intentional stop), not restarting');
      process.exit(0);
    }

    if (code === EXIT_USAGE) {
      console.error('[agent-supervisor] daemon exited 2 (usage error), not restarting');
      process.exit(EXIT_USAGE);
    }

    if (code === EXIT_UPDATE) {
      consecutiveCrashes = 0;
      if (!isTreeClean()) {
        console.error('[agent-supervisor] tree is dirty, skipping pull; restarting same code (will retry next update exit)');
        await sleep(UPDATE_RETRY_COOLDOWN_MS);
        continue;
      }
      if (pullFastForwardOnly()) {
        console.log('[agent-supervisor] updated, restarting daemon');
        continue;
      }
      console.error('[agent-supervisor] pull failed, restarting same code with cooldown (diverged tree cannot update-loop)');
      await sleep(UPDATE_RETRY_COOLDOWN_MS);
      continue;
    }

    // Crash / transient: plain restart with backoff + rate guard, no pull.
    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length > 0 && crashTimes[0] !== undefined && now - crashTimes[0] > CRASH_WINDOW_MS) {
      crashTimes.shift();
    }
    if (crashTimes.length > MAX_CRASH_RESTARTS) {
      console.error(
        `[agent-supervisor] crash loop: ${crashTimes.length} crashes in 5 min (max ${MAX_CRASH_RESTARTS}), giving up`,
      );
      process.exit(1);
    }
    consecutiveCrashes += 1;
    const backoffMs = Math.min(1000 * 2 ** (consecutiveCrashes - 1), 30_000);
    console.error(`[agent-supervisor] daemon crashed (exit ${code}), restarting in ${backoffMs}ms`);
    await sleep(backoffMs);
  }
}

void main();
