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
  if (child === null || child === undefined || child.pid === undefined) {
    return;
  }
  const pid = child.pid;
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
}
