/**
 * Project Status mirror (#1 kanban).
 *
 * Labels drive the daemon; this module mirrors every daemon/skill label move
 * onto the user Project `Status` single-select field. All ops are
 * best-effort: failures return 'failed' (caller logs a warning) and never
 * throw, so board sync can never block planning or implementation.
 *
 * Resolution is dynamic (no hardcoded node IDs): project id via
 * `gh project view`, option id via `gh project field-list`, item id via
 * `gh project item-list` matched on repo + issue number. An issue absent
 * from the project reports 'skipped'.
 *
 * Steady-state (#157): static resolution (project/field/options) is cached
 * per daemon lifetime and item IDs per issue, so warm syncs cost 1 `gh`
 * call (the mutation only) instead of 4. Transport/rate-limit failures arm
 * a shared 5-min cooldown (`MIRROR_COOLDOWN_MS`) that suppresses further
 * `gh` spawns; labels keep driving while the board catches up on recovery.
 * `lastSyncedStatus` skips redundant same-status writes (best-effort;
 * external board edits are invisible to memory — next same-status sync
 * skips the corrective write, next different-status sync self-heals).
 * CLI invocations (`npx tsx scripts/agent-project.ts`) are short-lived so
 * the cache never helps there (cold 4 calls each invocation). Per-poll
 * board reads (`agent-daemon-board.ts` item-list --limit 100 + label
 * lists) stay outside this cache/backoff; board failures do not arm the
 * mirror cooldown and vice versa.
 */
import { spawnSync } from 'node:child_process';

export function projectOwner(): string {
  return process.env['PROJECT_OWNER'] ?? 'ssotangkur';
}

export function projectNumber(): string {
  return process.env['PROJECT_NUMBER'] ?? '1';
}

export const STATUS_FIELD = 'Status';

/** Label -> Status option. Triage/Done are board-managed (no label twin). */
export function labelToStatus(label: string): string | null {
  switch (label) {
    case 'ready to plan':
      return 'Ready to plan';
    case 'planning':
      return 'Planning';
    case 'ready to implement':
      return 'Ready to implement';
    case 'implementing':
      return 'Implementing';
    case 'pr ready':
      return 'PR ready';
    case 'question':
      return 'Blocked';
    default:
      return null;
  }
}

export type SyncResult = 'synced' | 'skipped' | 'failed';

/** KD-3 (#140): failure taxonomy — permanent scope vs transient net vs operator config. */
export type MirrorFailureKind = 'auth' | 'transport' | 'config';

export interface MirrorDetail {
  result: SyncResult;
  /** Failing step: 'project view' | 'project field-list' | 'project item-list' | 'api graphql' | parse/resolve steps. */
  step: string;
  kind: MirrorFailureKind;
  stderr: string;
}

const AUTH_PATTERNS = /401|403|bad credentials|unknown owner type|forbidden|unauthorized|missing.*scope|requires?.*scope|need.*scope|scope.*required|insufficient.*scope|project.*scope|gh auth refresh|http 401|http 403/i;
const RATE_LIMIT_PATTERNS = /429|too many requests|rate limit|retry-after|secondary rate|50[0-4]|bad gateway|service unavailable|gateway timeout/i;
const TRANSPORT_PATTERNS =
  /timeout|timed out|econnreset|econnrefused|econnaborted|eai_again|enotfound|enonet|ehostunreach|socket hang up|network.*unreachable|connection.*reset|temporarily unavailable|getaddrinfo|eof|epipe/i;

/** KD-3: classify captured gh stderr (rate-limit first per KD-8 #157, then auth, else config — never throws). */
export function classifyMirrorFailure(stderr: string): MirrorFailureKind {
  const text = stderr || '';
  // KD-8: `HTTP 403: secondary rate limit exceeded` is transport, not auth.
  if (RATE_LIMIT_PATTERNS.test(text)) {
    return 'transport';
  }
  if (AUTH_PATTERNS.test(text)) {
    return 'auth';
  }
  if (TRANSPORT_PATTERNS.test(text)) {
    return 'transport';
  }
  return 'config';
}

/** KD-3: 429/5xx counts as transport with no immediate retry (warn with Retry-After). */
function isRetryableTransport(stderr: string): boolean {
  const text = stderr || '';
  if (RATE_LIMIT_PATTERNS.test(text)) {
    return false;
  }
  return TRANSPORT_PATTERNS.test(text);
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Best-effort: a failed sleep just means the retry fires immediately.
  }
}

function runGhOnce(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const result = spawnSync('gh', args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      return { ok: false, stdout: '', stderr: result.error ? (result.error as Error).message : (result.stderr || '').trim() };
    }
    return { ok: true, stdout: result.stdout || '', stderr: '' };
  } catch (error) {
    return { ok: false, stdout: '', stderr: (error as Error).message };
  }
}

/** KD-3: one bounded per-step retry (~1500 ms) inside runGh for transport only (never for auth/config). */
export type GhRunner = (args: string[], step: string) => { ok: boolean; stdout: string; stderr: string; kind: MirrorFailureKind };
let ghRunnerForTests: GhRunner | null = null;
/** KD-7: injectable `gh` runner so tests count argv without live `gh`. Bypasses retry/sleep internals. */
export function __setGhRunnerForTests(fn: GhRunner | null): void {
  ghRunnerForTests = fn;
}
function runGh(args: string[], step: string): { ok: boolean; stdout: string; stderr: string; kind: MirrorFailureKind } {
  if (ghRunnerForTests) {
    return ghRunnerForTests(args, step);
  }
  void step;
  const first = runGhOnce(args);
  if (first.ok) {
    return { ok: true, stdout: first.stdout, stderr: '', kind: 'config' };
  }
  const kind = classifyMirrorFailure(first.stderr);
  if (kind === 'transport' && isRetryableTransport(first.stderr)) {
    sleepSync(1500);
    const second = runGhOnce(args);
    if (second.ok) {
      return { ok: true, stdout: second.stdout, stderr: '', kind: 'config' };
    }
    return { ok: false, stdout: '', stderr: second.stderr, kind: classifyMirrorFailure(second.stderr) };
  }
  return { ok: false, stdout: '', stderr: first.stderr, kind };
}

/** KD-3 (#157): shared 5-min backoff on transport/rate-limit only (auth/config never arm it). */
export const MIRROR_COOLDOWN_MS = 5 * 60 * 1000;

interface ResolutionEntry {
  projectId: string;
  fieldId: string;
  optionIds: Map<string, string>;
}

const resolutionCache = new Map<string, ResolutionEntry>();
const itemCache = new Map<string, string>();
const lastSyncedStatus = new Map<string, string>();
let cooldownUntil = 0;

function resolutionKey(owner: string, project: string): string {
  return `${owner}/${project}`;
}

function itemKey(owner: string, project: string, repo: string, issue: number): string {
  return `${owner}/${project}/${repo}#${issue}`;
}

/** KD-7: clear resolution + item + lastSynced + cooldown (runner restored separately via __setGhRunnerForTests(null)). */
export function __resetMirrorCacheForTests(): void {
  resolutionCache.clear();
  itemCache.clear();
  lastSyncedStatus.clear();
  cooldownUntil = 0;
}

function isInCooldown(): boolean {
  return Date.now() < cooldownUntil;
}

function armCooldownIfTransport(kind: MirrorFailureKind): void {
  if (kind === 'transport') {
    cooldownUntil = Date.now() + MIRROR_COOLDOWN_MS;
  }
}

let lastMirrorFailure: MirrorDetail | null = null;

/** KD-4: detailed path — callers needing step|kind|stderr use this (or getLastMirrorFailure). */
export function getLastMirrorFailure(): MirrorDetail | null {
  return lastMirrorFailure;
}

const SET_STATUS_MUTATION =
  'mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!)' +
  '{updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,' +
  'value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}';

/**
 * Set an issue's Status option by name with step|kind|stderr detail. Never throws.
 * 'skipped' = issue not on the project board (or label has no Status twin).
 *
 * NOTE on `project item-list` pagination: `gh` returns the first page only
 * here (no `--limit` passed). On very large boards the issue may be absent
 * from that page and report 'skipped' even though it is on the board — an
 * explicit limitation, not a silent miss (callers log step on failure only).
 */
type FieldListParsed = { id: string; name: string; options?: Array<{ id: string; name: string }> };

function parseFieldListOptions(stdout: string): { field: FieldListParsed | undefined; optionIds: Map<string, string> } {
  const parsed = JSON.parse(stdout) as { fields?: FieldListParsed[] };
  const field = parsed.fields?.find((f) => f.name === STATUS_FIELD);
  const optionIds = new Map<string, string>();
  for (const o of field?.options ?? []) {
    if (o.name && o.id) {
      optionIds.set(o.name, o.id);
    }
  }
  return { field, optionIds };
}

/**
 * Set an issue's Status option by name with step|kind|stderr detail. Never throws.
 * 'skipped' = issue not on the project board (or label has no Status twin).
 *
 * NOTE on `project item-list` pagination: `gh` returns the first page only
 * here (no `--limit` passed). On very large boards the issue may be absent
 * from that page and report 'skipped' even though it is on the board — an
 * explicit limitation, not a silent miss (callers log step on failure only).
 *
 * Steady-state (#157): resolution + item IDs are cached, so warm syncs cost
 * 1 `gh` call (mutation only). Transport failures arm a shared cooldown;
 * `cached-noop` skips redundant same-status writes (external board edits
 * are invisible to memory — next different-status sync self-heals).
 */
export function setProjectStatusDetailed(repo: string, issueNumber: number, status: string): MirrorDetail {
  const owner = projectOwner();
  const proj = projectNumber();
  const resKey = resolutionKey(owner, proj);
  const issueK = itemKey(owner, proj, repo, issueNumber);
  const fail = (step: string, kind: MirrorFailureKind, stderr: string): MirrorDetail => {
    const detail: MirrorDetail = { result: 'failed', step, kind, stderr };
    lastMirrorFailure = detail;
    lastSyncedStatus.delete(issueK);
    armCooldownIfTransport(kind);
    return detail;
  };
  // KD-4: cooldown guard FIRST — outage reads as quiet `skipped`, never `synced/cached-noop`.
  if (isInCooldown()) {
    return { result: 'skipped', step: 'backoff-cooldown', kind: 'transport', stderr: '' };
  }
  // KD-5: no-op skip after cooldown guard, before any `gh` (zero calls on repeat same status).
  if (lastSyncedStatus.get(issueK) === status) {
    const detail: MirrorDetail = { result: 'synced', step: 'cached-noop', kind: 'config', stderr: '' };
    lastMirrorFailure = detail;
    return detail;
  }
  try {
    let entry = resolutionCache.get(resKey);
    let projectId: string | undefined = entry?.projectId;
    let fieldId: string | undefined = entry?.fieldId;
    let optionId: string | undefined = entry?.optionIds.get(status);
    if (entry && projectId && fieldId) {
      if (!optionId) {
        // KD-6a: cached-resolution option-name miss — re-fetch field-list once (handles Status rename).
        const refresh = runGh(['project', 'field-list', proj, '--owner', owner, '--format', 'json'], 'project field-list');
        if (!refresh.ok) {
          return fail('project field-list', refresh.kind, refresh.stderr);
        }
        try {
          const { field, optionIds } = parseFieldListOptions(refresh.stdout);
          if (field) {
            entry = { projectId, fieldId: field.id, optionIds };
            resolutionCache.set(resKey, entry);
            fieldId = field.id;
            optionId = optionIds.get(status);
          }
        } catch (error) {
          return fail('parse-field-list', 'config', `unparseable field-list JSON: ${(error as Error).message}`);
        }
        if (!optionId) {
          return fail('field-resolve', 'config', `Status field/option not found for ${JSON.stringify(status)}`);
        }
      }
    } else {
      const view = runGh(['project', 'view', proj, '--owner', owner, '--format', 'json'], 'project view');
      if (!view.ok) {
        return fail('project view', view.kind, view.stderr);
      }
      try {
        projectId = (JSON.parse(view.stdout) as { id?: string }).id;
      } catch (error) {
        return fail('parse-view', 'config', `unparseable project view JSON: ${(error as Error).message}`);
      }
      if (!projectId) {
        return fail('parse-view', 'config', 'project view JSON missing id');
      }
      const fields = runGh(['project', 'field-list', proj, '--owner', owner, '--format', 'json'], 'project field-list');
      if (!fields.ok) {
        return fail('project field-list', fields.kind, fields.stderr);
      }
      try {
        const { field, optionIds } = parseFieldListOptions(fields.stdout);
        if (!field) {
          return fail('field-resolve', 'config', `Status field/option not found for ${JSON.stringify(status)}`);
        }
        optionId = optionIds.get(status);
        fieldId = field.id;
        entry = { projectId, fieldId: field.id, optionIds };
        if (!optionId) {
          return fail('field-resolve', 'config', `Status field/option not found for ${JSON.stringify(status)}`);
        }
        resolutionCache.set(resKey, entry);
      } catch (error) {
        return fail('parse-field-list', 'config', `unparseable field-list JSON: ${(error as Error).message}`);
      }
    }
    if (!projectId || !fieldId || !optionId) {
      return fail('field-resolve', 'config', `Status field/option not found for ${JSON.stringify(status)}`);
    }
    let itemId = itemCache.get(issueK);
    if (!itemId) {
      const items = runGh(['project', 'item-list', proj, '--owner', owner, '--format', 'json'], 'project item-list');
      if (!items.ok) {
        return fail('project item-list', items.kind, items.stderr);
      }
      let item: { id: string; content?: { number?: number; repository?: string } } | undefined;
      try {
        const parsed = JSON.parse(items.stdout) as { items?: Array<{ id: string; content?: { number?: number; repository?: string } }> };
        if (!Array.isArray(parsed.items)) {
          return fail('parse-item-list', 'config', 'item-list JSON schema mismatch: missing items array');
        }
        item = parsed.items.find((i) => i.content?.number === issueNumber && i.content?.repository === repo);
      } catch (error) {
        return fail('parse-item-list', 'config', `unparseable item-list JSON: ${(error as Error).message}`);
      }
      if (!item) {
        const detail: MirrorDetail = { result: 'skipped', step: 'item-resolve', kind: 'config', stderr: '' };
        lastMirrorFailure = detail;
        return detail;
      }
      itemCache.set(issueK, item.id);
      itemId = item.id;
    }
    const update = runGh(
      [
        'api',
        'graphql',
        '-f',
        `query=${SET_STATUS_MUTATION}`,
        '-f',
        `projectId=${projectId}`,
        '-f',
        `itemId=${itemId}`,
        '-f',
        `fieldId=${fieldId}`,
        '-f',
        `optionId=${optionId}`,
      ],
      'api graphql',
    );
    if (!update.ok) {
      // KD-6b: evict cached itemId ONLY on config/auth (NOT_FOUND / unresolvable node) —
      // NEVER on transport (rate-limit outage is not stale-item evidence).
      if (update.kind !== 'transport') {
        itemCache.delete(issueK);
      }
      return fail('api graphql', update.kind, update.stderr);
    }
    lastSyncedStatus.set(issueK, status);
    const detail: MirrorDetail = { result: 'synced', step: 'api graphql', kind: 'config', stderr: '' };
    lastMirrorFailure = detail;
    return detail;
  } catch (error) {
    return fail('unexpected', 'config', (error as Error).message);
  }
}

/**
 * Set an issue's Status option by name. Never throws.
 * KD-4: keeps the bare SyncResult contract (callers + tests depend on it);
 * detail travels via setProjectStatusDetailed()/getLastMirrorFailure().
 */
export function setProjectStatus(repo: string, issueNumber: number, status: string): SyncResult {
  return setProjectStatusDetailed(repo, issueNumber, status).result;
}

/** Mirror a label that just landed onto Status with detail. Never throws. */
export function syncStatusForLabelDetailed(repo: string, issueNumber: number, label: string): MirrorDetail {
  try {
    const status = labelToStatus(label);
    if (!status) {
      // KD-3: label-resolve no-twin `skipped` bypasses backoff (no `gh` anyway).
      const detail: MirrorDetail = { result: 'skipped', step: 'label-resolve', kind: 'config', stderr: '' };
      lastMirrorFailure = detail;
      return detail;
    }
    // KD-4: cooldown guard (quiet) — setProjectStatusDetailed guards again, but check here for fast path.
    if (isInCooldown()) {
      return { result: 'skipped', step: 'backoff-cooldown', kind: 'transport', stderr: '' };
    }
    return setProjectStatusDetailed(repo, issueNumber, status);
  } catch (error) {
    const detail: MirrorDetail = { result: 'failed', step: 'unexpected', kind: 'config', stderr: (error as Error).message };
    lastMirrorFailure = detail;
    return detail;
  }
}

/** Mirror a label that just landed onto Status. Never throws (bare contract). */
export function syncStatusForLabel(repo: string, issueNumber: number, label: string): SyncResult {
  return syncStatusForLabelDetailed(repo, issueNumber, label).result;
}

/**
 * KD-1 (#140): read-only project preflight — `project view` + `field-list`,
 * no mutation. Used at daemon boot and every 30 min; skipped under --dry-run.
 * KD-6 (#157): shares the same resolution cache + backoff, cooldown-first:
 * in-cooldown fast-fail (even on cache hit) → full-cache-hit ok → live
 * view+field-list populating the FULL cache (projectId+fieldId+optionIds).
 */
export function checkProjectRead(): { ok: boolean; step: string; kind: MirrorFailureKind; stderr: string } {
  const owner = projectOwner();
  const proj = projectNumber();
  const resKey = resolutionKey(owner, proj);
  // KD-6: cooldown FIRST — a warmed cache must not report healthy mid-outage.
  if (isInCooldown()) {
    return { ok: false, step: 'backoff-cooldown', kind: 'transport', stderr: '' };
  }
  const cached = resolutionCache.get(resKey);
  if (cached && cached.projectId && cached.fieldId && cached.optionIds.size > 0) {
    return { ok: true, step: 'project field-list', kind: 'config', stderr: '' };
  }
  const view = runGh(['project', 'view', proj, '--owner', owner, '--format', 'json'], 'project view');
  if (!view.ok) {
    armCooldownIfTransport(view.kind);
    return { ok: false, step: 'project view', kind: view.kind, stderr: view.stderr };
  }
  let projectId: string | undefined;
  try {
    projectId = (JSON.parse(view.stdout) as { id?: string }).id;
    if (!projectId) {
      return { ok: false, step: 'parse-view', kind: 'config', stderr: 'project view JSON missing id' };
    }
  } catch (error) {
    return { ok: false, step: 'parse-view', kind: 'config', stderr: `unparseable project view JSON: ${(error as Error).message}` };
  }
  const fields = runGh(['project', 'field-list', proj, '--owner', owner, '--format', 'json'], 'project field-list');
  if (!fields.ok) {
    armCooldownIfTransport(fields.kind);
    return { ok: false, step: 'project field-list', kind: fields.kind, stderr: fields.stderr };
  }
  try {
    const { field, optionIds } = parseFieldListOptions(fields.stdout);
    if (!field) {
      return { ok: false, step: 'field-resolve', kind: 'config', stderr: `Status field not found on project ${owner}/${proj}` };
    }
    resolutionCache.set(resKey, { projectId, fieldId: field.id, optionIds });
  } catch (error) {
    return { ok: false, step: 'parse-field-list', kind: 'config', stderr: `unparseable field-list JSON: ${(error as Error).message}` };
  }
  return { ok: true, step: 'project field-list', kind: 'config', stderr: '' };
}

function usage(): string {
  return ['Usage: agent-project.ts --issue NUMBER --status NAME [--repo OWNER/REPO]', '', 'Best-effort Status mirror. Exits 0 always; prints synced|skipped|failed.'].join('\n');
}

/** CLI entry for skill workers: `npx tsx scripts/agent-project.ts --issue 48 --status Planning`. */
export function main(argv: string[]): SyncResult {
  const issueFlag = argv.indexOf('--issue');
  const statusFlag = argv.indexOf('--status');
  const repoFlag = argv.indexOf('--repo');
  if (issueFlag === -1 || statusFlag === -1 || argv.includes('--help')) {
    console.log(usage());
    return 'skipped';
  }
  const issueNumber = Number(argv[issueFlag + 1]);
  const status = argv[statusFlag + 1] ?? '';
  const repo = repoFlag === -1 ? 'ssotangkur/cycledesign' : (argv[repoFlag + 1] ?? '');
  if (!Number.isInteger(issueNumber) || !status || !repo) {
    console.log(usage());
    return 'skipped';
  }
  const detail = setProjectStatusDetailed(repo, issueNumber, status);
  // KD-4: CLI stdout contract stays bare (skill workers scrape it); reason goes to stderr only.
  console.log(detail.result);
  if (detail.result === 'failed') {
    console.error(`[agent-project] mirror failed [step: ${detail.step}] [kind: ${detail.kind}] ${detail.stderr}`);
  }
  return detail.result;
}

const invokedAsMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/agent-project.ts') ?? false;
if (invokedAsMain) {
  main(process.argv.slice(2));
}
