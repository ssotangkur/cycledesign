/**
 * Shared tree-kill helper for the agent supervisor + daemon (#127).
 *
 * `shell:true` spawn wrappers may leave grandchildren behind on kill, so
 * signal paths tree-kill: win32 `taskkill /PID /T /F`, posix negative-pid
 * process-group kill with a single-pid fallback. Best-effort, never throws.
 *
 * Kept in its own micro-module (never import from `./agent-daemon.js` in
 * the supervisor — that file has a top-level `void main()` that boots the
 * daemon on import).
 */
import { spawnSync, type ChildProcess } from 'node:child_process';

export function treeKill(child: { pid?: number } | ChildProcess | null | undefined): void {
  treeKillVerified(child);
}

export interface TreeKillOptions {
  /** Override liveness probe (default: `process.kill(pid, 0)`). */
  isAlive?: (pid: number) => boolean;
  /** Kill→verify rounds after the first attempt (default 2). */
  retries?: number;
  /** Sync sleep between rounds in ms (default 500). */
  delayMs?: number;
  /** Override sleep (tests). */
  sleepSync?: (ms: number) => void;
}

function defaultSleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Best-effort: a failed sleep just means the retry fires immediately.
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * #149 KD-5: tree-kill with post-kill verification + retry. Win32 stays
 * atomic `taskkill /PID /T /F` (leaf→wrapper→CLI in one call — see
 * diagnose-stuck-run §8 for the manual child-first order); posix stays
 * group-kill with single-pid fallback. Returns true when the pid is dead
 * afterwards. Best-effort, never throws. Tree output feeds only the
 * watchdog busy-vote, never a kill gate.
 */
export function treeKillVerified(
  child: { pid?: number } | ChildProcess | null | undefined,
  opts: TreeKillOptions = {},
): boolean {
  if (child === null || child === undefined || child.pid === undefined) {
    return true;
  }
  const pid = child.pid;
  const isAlive = opts.isAlive ?? alive;
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 500;
  const sleepSync = opts.sleepSync ?? defaultSleepSync;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      sleepSync(delayMs);
    }
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          (child as ChildProcess).kill('SIGKILL');
        }
      }
    } catch {
      try {
        (child as ChildProcess).kill('SIGKILL');
      } catch {
        // Best-effort: the process may already be gone.
      }
    }
    try {
      if (!isAlive(pid)) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}
