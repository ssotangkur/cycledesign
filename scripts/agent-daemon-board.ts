/**
 * Board-first claimable lookup (#146).
 *
 * Project `Status` is the source of truth for claimable work; issue labels
 * are the fallback. This module reads claimable Status via
 * `gh project item-list` and merges it with the label poll results, so an
 * issue whose Status is `Ready to plan` / `Ready to implement` is claimed
 * even when its trigger label drifted off (and vice versa).
 *
 * Design (see issue #146 Key Decisions):
 * - KD-1: only `Ready to plan` -> `gh-plan-with-reason` and
 *   `Ready to implement` -> `resolve-issue` trigger runs. Every other
 *   Status (Planning/Implementing/Blocked/PR ready/Done/...) is never
 *   claimed from the board.
 * - KD-2: board-first merge, labels as fallback (never Status-exclusive).
 *   Issues off the board are still claimed via labels; on conflict the
 *   downstream-most command wins (implement beats plan, KD-7 table).
 * - KD-3: add-only reconcile, Status wins, fence-gated. The daemon ADDS a
 *   missing trigger label before claiming; it never removes labels here.
 * - KD-4: closed/Done exclusion. Board-only hits are hydrated via
 *   `gh issue view` and dropped unless `state: OPEN`.
 * - KD-5: failure stays fail-soft at poll time (failed result, never throw).
 * - KD-6: pinned board-read contract + explicit `--limit` (first-page-only
 *   limitation inherited from `agent-project.ts`, documented not silent).
 *
 * All `gh` calls degrade to `{ ok: false, ... }` (never throw), so a board
 * outage can only ever fall back to the label-only pass.
 */
import { spawnSync } from 'node:child_process';
import { classifyMirrorFailure, projectNumber, projectOwner, type MirrorFailureKind } from './agent-project.js';

export const STATUS_READY_PLAN = 'Ready to plan';
export const STATUS_READY_IMPLEMENT = 'Ready to implement';

export const LABEL_PLAN = 'ready to plan';
export const LABEL_IMPLEMENT = 'ready to implement';

export const COMMAND_PLAN = 'gh-plan-with-reason';
export const COMMAND_IMPLEMENT = 'resolve-issue';

/**
 * KD-6: explicit item-list page size, matching ISSUE_LIMIT in
 * agent-daemon.ts. NOTE: `gh project item-list` returns the first page only;
 * on very large boards claimable items past this page are missed by the
 * board read (they are still claimed via labels). Same inherited limitation
 * as `agent-project.ts` item-resolve.
 */
export const BOARD_LIMIT = 100;

/** Status -> trigger label for claimable work only (KD-1); null otherwise. */
export function statusToLabel(status: string): string | null {
  if (status === STATUS_READY_PLAN) {
    return LABEL_PLAN;
  }
  if (status === STATUS_READY_IMPLEMENT) {
    return LABEL_IMPLEMENT;
  }
  return null;
}

/** Status -> daemon skill command for claimable work only (KD-1); null otherwise. */
export function statusToCommand(status: string): string | null {
  if (status === STATUS_READY_PLAN) {
    return COMMAND_PLAN;
  }
  if (status === STATUS_READY_IMPLEMENT) {
    return COMMAND_IMPLEMENT;
  }
  return null;
}

export interface BoardCandidate {
  number: number;
  title: string;
  status: string;
  labels: string[];
}

export type BoardReadResult =
  | { ok: true; candidates: BoardCandidate[] }
  | { ok: false; step: string; kind: MirrorFailureKind; stderr: string };

interface RawBoardItem {
  id?: string;
  status?: string;
  title?: string;
  labels?: Array<string | { name?: string }>;
  content?: { type?: string; number?: number; repository?: string; title?: string };
}

/** Pinned argv for the board read (KD-6); exported so tests pin the `--limit` contract. */
export function boardListArgs(): string[] {
  return ['project', 'item-list', projectNumber(), '--owner', projectOwner(), '--limit', String(BOARD_LIMIT), '--format', 'json'];
}

/**
 * KD-6: pure parser for the pinned `item-list` JSON contract
 * `{ items: [{ id, status, title, labels, content: { number, repository } }] }`.
 * Keeps claimable-Status issues on `repo` only (KD-1); skips everything else
 * (other Statuses, other repos, non-issue content, unnumbered drafts).
 * Throws on schema mismatch (caller converts to a failed result).
 */
export function parseBoardItems(stdout: string, repo: string): BoardCandidate[] {
  const parsed = JSON.parse(stdout) as { items?: RawBoardItem[] };
  if (!Array.isArray(parsed.items)) {
    throw new Error('item-list JSON schema mismatch: missing items array');
  }
  const candidates: BoardCandidate[] = [];
  for (const item of parsed.items) {
    const status = item.status ?? '';
    if (statusToLabel(status) === null) {
      continue;
    }
    if (item.content?.type !== undefined && item.content.type !== 'Issue') {
      continue;
    }
    const number = item.content?.number;
    if (!Number.isInteger(number) || item.content?.repository !== repo) {
      continue;
    }
    const labels = (item.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter((l) => l !== '');
    candidates.push({ number: number as number, title: item.title ?? item.content?.title ?? '', status, labels });
  }
  return candidates;
}

/**
 * KD-1/KD-5/KD-6: list board issues in a claimable Status. Never throws;
 * transport/auth/config failures return `{ ok: false }` and the caller falls
 * back to the label-only pass.
 */
export function listClaimableByStatus(repo: string): BoardReadResult {
  try {
    const result = spawnSync('gh', boardListArgs(), { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      const stderr = result.error ? (result.error as Error).message : (result.stderr || '').trim();
      return { ok: false, step: 'project item-list', kind: classifyMirrorFailure(stderr), stderr };
    }
    try {
      return { ok: true, candidates: parseBoardItems(result.stdout || '{"items":[]}', repo) };
    } catch (error) {
      return { ok: false, step: 'parse-item-list', kind: 'config', stderr: (error as Error).message };
    }
  } catch (error) {
    return { ok: false, step: 'unexpected', kind: 'config', stderr: (error as Error).message };
  }
}

export interface ListedIssueLike {
  number: number;
  title: string;
  createdAt: string;
}

/** Board-only hit after KD-4 hydration (OPEN confirmed, createdAt filled in). */
export interface BoardHydratedIssue extends ListedIssueLike {
  status: string;
  /** Fresh labels from hydration (used for the reconcile trigger check). */
  labels: string[];
}

export interface MergedRun {
  issue: ListedIssueLike;
  label: string;
  command: string;
  /** Board Status when this run came from (or agrees with) the board; null for label-only runs. */
  boardStatus: string | null;
  /**
   * Fresh labels for board-only runs (hydration); null for label-list runs,
   * which already carry their trigger and skip reconcile.
   */
  liveLabels: string[] | null;
}

function commandRank(command: string): number {
  if (command === COMMAND_IMPLEMENT) {
    return 2;
  }
  if (command === COMMAND_PLAN) {
    return 1;
  }
  return 0;
}

/**
 * KD-2/KD-7 board-first merge: union of label hits + hydrated board hits,
 * oldest-first, deduped by number. On conflict the downstream-most command
 * wins regardless of source (implement beats plan), which yields the KD-7
 * table: Status plan + label implement -> implement; Status implement +
 * label plan -> implement. Ties record board provenance.
 */
export function mergeClaimableRuns(
  planIssues: ListedIssueLike[],
  implementIssues: ListedIssueLike[],
  boardHydrated: BoardHydratedIssue[],
): MergedRun[] {
  const byNumber = new Map<number, MergedRun>();
  for (const issue of planIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_PLAN, command: COMMAND_PLAN, boardStatus: null, liveLabels: null });
  }
  for (const issue of implementIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_IMPLEMENT, command: COMMAND_IMPLEMENT, boardStatus: null, liveLabels: null });
  }
  for (const hydrated of boardHydrated) {
    const label = statusToLabel(hydrated.status);
    const command = statusToCommand(hydrated.status);
    if (label === null || command === null) {
      continue;
    }
    const existing = byNumber.get(hydrated.number);
    if (existing === undefined) {
      byNumber.set(hydrated.number, {
        issue: { number: hydrated.number, title: hydrated.title, createdAt: hydrated.createdAt },
        label,
        command,
        boardStatus: hydrated.status,
        liveLabels: hydrated.labels,
      });
    } else if (commandRank(command) >= commandRank(existing.command)) {
      // Board wins ties (records provenance); downstream wins conflicts.
      byNumber.set(hydrated.number, { issue: existing.issue, label, command, boardStatus: hydrated.status, liveLabels: null });
    } else {
      // Label side is downstream (implement) while the board says plan:
      // keep the label command per the KD-7 table, record board provenance.
      existing.boardStatus = hydrated.status;
    }
  }
  return [...byNumber.values()].sort((a, b) => a.issue.number - b.issue.number);
}

/** Terminal labels that suppress reconcile (a blocker/success landed; never spawn over it). */
const RECONCILE_TERMINAL_LABELS = ['question', 'pr ready'];

export type ReconcileDecision =
  | { action: 'none' }
  | { action: 'suppressed'; reason: 'terminal-label' }
  | { action: 'would-reconcile'; label: string }
  | { action: 'add'; label: string };

/**
 * KD-3 add-only reconcile decision (pure). Before claiming a board-claimable
 * issue whose trigger label is absent, the daemon adds the missing trigger
 * label (never removes anything here). Terminal labels suppress the add;
 * dry-run reports `would-reconcile` without mutating. Fence transport
 * failure and just-landed terminal comments are checked by the caller via
 * `checkFencing`/`isFenceTransportFailure` before performing the add.
 */
export function decideReconcile(boardStatus: string | null, liveLabels: string[], dryRun: boolean): ReconcileDecision {
  if (boardStatus === null) {
    return { action: 'none' };
  }
  const trigger = statusToLabel(boardStatus);
  if (trigger === null || liveLabels.includes(trigger)) {
    return { action: 'none' };
  }
  if (liveLabels.some((label) => RECONCILE_TERMINAL_LABELS.includes(label))) {
    return { action: 'suppressed', reason: 'terminal-label' };
  }
  if (dryRun) {
    return { action: 'would-reconcile', label: trigger };
  }
  return { action: 'add', label: trigger };
}
