import { spawnSync } from 'node:child_process';

export type GitRunner = (args: string[], timeoutMs?: number) => {
  ok: boolean;
  stdout: string;
  stderr?: string;
  status?: number | null;
  error?: string;
};

function defaultGitRunner(args: string[], timeoutMs?: number): { ok: boolean; stdout: string; stderr: string; status: number | null; error?: string } {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: timeoutMs });
  if (result.error) {
    return { ok: false, stdout: '', stderr: (result.stderr as string | undefined) ?? '', status: result.status ?? null, error: (result.error as Error).message };
  }
  return { ok: result.status === 0, stdout: (result.stdout || '').trim(), stderr: (result.stderr as string | undefined) ?? '', status: result.status };
}

/**
 * #120: pure decision for best-effort return-to-main. Strict clean gate per
 * issue text (`git status --porcelain` empty, matching supervisor `isTreeClean`).
 */
export type DecideReturnAction = 'already-on-main' | 'returnable' | 'skipped-dirty' | 'skip-detached';

export function decideReturnToMain(branch: string, statusPorcelain: string): DecideReturnAction {
  const clean = branch.trim();
  if (clean === 'main') {
    return 'already-on-main';
  }
  if (clean === '' || clean === 'HEAD') {
    return 'skip-detached';
  }
  if (statusPorcelain.trim().length !== 0) {
    return 'skipped-dirty';
  }
  return 'returnable';
}

export type ReturnMainAction =
  | 'already-on-main'
  | 'returned-to-main'
  | 'skipped-dirty'
  | 'skip-detached'
  | 'no-local-main'
  | 'checkout-failed'
  | 'dry-run';

export interface ReturnToMainResult {
  action: ReturnMainAction;
  reason?: string;
}

/**
 * #120: best-effort return to `main` after each run. Plain
 * `git checkout main` only (no -f, no reset --hard, no stash, no pull).
 * Never throws, never exits — failures log and stay so the next
 * `resolve-issue` still works via ref-based branch creation.
 */
export function tryReturnToMain(dryRun: boolean, runner: GitRunner = defaultGitRunner): ReturnToMainResult {
  try {
    const branchRes = runner(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branchRes.ok) {
      const tail = (branchRes.stderr ?? branchRes.error ?? '').trim().split('\n').pop()?.trim().slice(-500) ?? '';
      console.log(`[agent-daemon] return-to-main: checkout-failed${tail ? ` (${tail})` : ''}`);
      return { action: 'checkout-failed', reason: tail || 'git-error' };
    }
    const branch = (branchRes.stdout || '').trim();
    if (branch === 'main') {
      console.log('[agent-daemon] return-to-main: already-on-main');
      return { action: 'already-on-main' };
    }
    if (branch === '' || branch === 'HEAD') {
      console.log('[agent-daemon] return-to-main: skip-detached');
      return { action: 'skip-detached' };
    }
    const verify = runner(['rev-parse', '--verify', 'refs/heads/main']);
    if (!verify.ok) {
      console.log('[agent-daemon] return-to-main: no-local-main');
      return { action: 'no-local-main' };
    }
    const status = runner(['status', '--porcelain']);
    if (!status.ok) {
      const tail = (status.stderr ?? status.error ?? '').trim().split('\n').pop()?.trim().slice(-500) ?? '';
      console.log(`[agent-daemon] return-to-main: checkout-failed${tail ? ` (${tail})` : ''}`);
      return { action: 'checkout-failed', reason: tail || 'status-failed' };
    }
    const decision = decideReturnToMain(branch, status.stdout || '');
    if (decision === 'skipped-dirty') {
      console.log('[agent-daemon] return-to-main: skipped-dirty');
      return { action: 'skipped-dirty' };
    }
    if (decision === 'skip-detached') {
      console.log('[agent-daemon] return-to-main: skip-detached');
      return { action: 'skip-detached' };
    }
    if (dryRun) {
      console.log(`[agent-daemon] dry-run: would return to main (from ${branch})`);
      return { action: 'dry-run', reason: branch };
    }
    const checkout = runner(['checkout', 'main']);
    if (checkout.ok) {
      console.log('[agent-daemon] return-to-main: returned-to-main');
      return { action: 'returned-to-main' };
    }
    const tail =
      (checkout.stderr ?? checkout.error ?? checkout.stdout ?? '').trim().split('\n').pop()?.trim().slice(-500) ?? '';
    console.log(`[agent-daemon] return-to-main: checkout-failed${tail ? ` (${tail})` : ''}`);
    return { action: 'checkout-failed', reason: tail };
  } catch (err) {
    const reason = (err as Error).message ?? String(err);
    console.log(`[agent-daemon] return-to-main: checkout-failed (${reason.slice(-500)})`);
    return { action: 'checkout-failed', reason };
  }
}
