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

const EXIT_UPDATE = 42;
const EXIT_USAGE = 2;
const MAX_CRASH_RESTARTS = 5;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const UPDATE_RETRY_COOLDOWN_MS = 60_000;

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
      child = spawn('npx', ['tsx', 'scripts/agent-daemon.ts', ...args], {
        stdio: 'inherit',
        shell: true,
      });
    } catch (err) {
      console.error(`[agent-supervisor] failed to spawn daemon: ${(err as Error).message}`);
      resolve(1);
      return;
    }

    const forward = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal);
      } catch {
        // Best-effort: child may already be gone.
      }
    };
    const onSigint = (): void => forward('SIGINT');
    const onSigterm = (): void => forward('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.on('error', (err) => {
      console.error(`[agent-supervisor] daemon spawn error: ${err.message}`);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      resolve(1);
    });
    child.on('close', (code) => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
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
