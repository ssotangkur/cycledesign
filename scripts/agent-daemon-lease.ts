/**
 * Daemon-owned issue lease (#132).
 *
 * The worker used to claim via its Phase 0 label swap, but a worker that
 * dies after claiming (exit 1, kill, lost sandbox) strands the issue at
 * `planning`/`implementing` forever: the daemon only reset the lease on
 * failover/watchdog paths, never on normal completion. So the daemon owns
 * the lease deterministically:
 *
 * - claim at spawn: swap trigger -> in-progress via host `gh`. Claim
 *   failure (label already gone = another worker holds it) skips the run.
 * - release on every finish path: if the in-progress label is still held
 *   and no terminal state landed since spawn, swap back to the trigger.
 *   Terminal moves by the worker (plan posted, `pr ready`, `question`)
 *   suppress the release.
 *
 * The worker Phase 0 claim stays as idempotent backup (label moves
 * tolerate absence). No side effects on import (unit-tested).
 */
import { spawnSync } from 'node:child_process';
import { syncStatusForLabelDetailed } from './agent-project.js';

export interface IssueLease {
  trigger: string;
  inProgress: string;
}

/** Map a daemon skill command to its lease labels; null for unknown commands. */
export function leaseForCommand(command: string): IssueLease | null {
  if (command === 'gh-plan-with-reason') {
    return { trigger: 'ready to plan', inProgress: 'planning' };
  }
  if (command === 'resolve-issue') {
    return { trigger: 'ready to implement', inProgress: 'implementing' };
  }
  return null;
}

export interface LeaseState {
  labels: string[];
  terminalCommentSince: boolean;
}

/**
 * Worker terminal labels: success/blocked moves that coexist with the
 * in-progress label (the skills add without always removing, #132).
 * A `ready to implement` landing means plan success, but the plan flow
 * always removes `planning` with it, so it needs no entry here.
 */
const TERMINAL_LABELS = ['pr ready', 'question'];

/**
 * Pure release decision: the in-progress label is still held, no terminal
 * comment landed since spawn, and no terminal label is present.
 */
export function shouldReleaseLease(state: LeaseState, inProgress: string): boolean {
  if (!state.labels.includes(inProgress) || state.terminalCommentSince) {
    return false;
  }
  return !state.labels.some((label) => TERMINAL_LABELS.includes(label));
}

/**
 * KD-5: fail-closed fence signature. `checkFencing` returns
 * `{labels:[], terminalCommentSince:true}` when `gh` transport fails or its
 * output is unparseable, so this exact shape means "fence unknown, retry
 * once" — never fail-open. A legitimately unlabeled issue has
 * `terminalCommentSince:false` unless a terminal comment actually landed.
 */
export function isFenceTransportFailure(state: LeaseState): boolean {
  return state.labels.length === 0 && state.terminalCommentSince;
}

function ghEdit(repo: string, issueNumber: number, remove: string, add: string): { ok: boolean; output: string } {
  const result = spawnSync('gh', ['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', remove, '--add-label', add], {
    encoding: 'utf8',
  });
  if (result.error) {
    return { ok: false, output: (result.error as Error).message };
  }
  if (result.status !== 0) {
    return { ok: false, output: (result.stderr || '').trim() };
  }
  return { ok: true, output: '' };
}

/** Swap trigger -> in-progress. False = lease not acquired, caller must skip the run. */
export function claimIssue(repo: string, issueNumber: number, lease: IssueLease): boolean {
  const result = ghEdit(repo, issueNumber, lease.trigger, lease.inProgress);
  if (!result.ok) {
    return false;
  }
  // Best-effort Project Status mirror (KD-2: warn-only, never blocks the lease; KD-3: warn carries step|kind|stderr).
  const mirror = syncStatusForLabelDetailed(repo, issueNumber, lease.inProgress);
  if (mirror.result === 'failed') {
    console.warn(`[agent-daemon] project Status mirror failed for #${issueNumber} (${lease.inProgress}) [step: ${mirror.step}] [kind: ${mirror.kind}] ${mirror.stderr}`);
  }
  return true;
}

/** Swap in-progress -> trigger when the worker left no terminal state. Never throws. */
export function releaseLease(repo: string, issueNumber: number, lease: IssueLease, state: LeaseState): 'released' | 'suppressed' | 'failed' {
  try {
    if (!shouldReleaseLease(state, lease.inProgress)) {
      return 'suppressed';
    }
    if (!ghEdit(repo, issueNumber, lease.inProgress, lease.trigger).ok) {
      return 'failed';
    }
    const mirror = syncStatusForLabelDetailed(repo, issueNumber, lease.trigger);
    if (mirror.result === 'failed') {
      console.warn(`[agent-daemon] project Status mirror failed for #${issueNumber} (${lease.trigger}) [step: ${mirror.step}] [kind: ${mirror.kind}] ${mirror.stderr}`);
    }
    return 'released';
  } catch {
    return 'failed';
  }
}
