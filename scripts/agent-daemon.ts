#!/usr/bin/env node
/**
 * Polling-first daemon that watches issue labels and invokes the right
 * fire-and-forget skill via the opencode CLI, resuming after each run.
 *
 * Label -> skill mapping (bare command names, no leading slash):
 *   "ready to plan"      -> gh-plan-with-reason
 *   "ready to implement" -> resolve-issue
 *
 * "question" / "pr ready" are terminal and never re-triggered (not polled).
 * Skills claim via label swap, so the next poll naturally skips claimed issues.
 *
 * Usage:
 *   npx tsx scripts/agent-daemon.ts [--repo OWNER/REPO] [--interval SECONDS] [--once] [--dry-run] [--help]
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { parseArgs } from 'node:util';

const DEFAULT_REPO = 'ssotangkur/cycledesign';
const DEFAULT_INTERVAL_SECONDS = 60;
const ISSUE_LIMIT = 100;

const LABEL_PLAN = 'ready to plan';
const LABEL_IMPLEMENT = 'ready to implement';

const COMMANDS: Record<string, string> = {
  [LABEL_PLAN]: 'gh-plan-with-reason',
  [LABEL_IMPLEMENT]: 'resolve-issue',
};

interface ListedIssue {
  number: number;
  title: string;
  createdAt: string;
}

interface PlannedRun {
  issue: ListedIssue;
  label: string;
  command: string;
}

let activeChild: ChildProcess | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function usage(): string {
  return [
    'Usage: agent-daemon.ts [options]',
    '',
    'Poll GitHub issues by label and run fire-and-forget skills via the opencode CLI.',
    '',
    'Options:',
    `  --repo OWNER/REPO     Repository to poll (default: ${DEFAULT_REPO})`,
    `  --interval SECONDS    Poll interval in seconds, positive integer (default: ${DEFAULT_INTERVAL_SECONDS})`,
    '  --once                Single poll pass, then exit',
    '  --dry-run             Print planned invocations without spawning opencode',
    '  --help                Show this help and exit',
  ].join('\n');
}

function fail(message: string): never {
  console.error(`[agent-daemon] error: ${message}`);
  console.error(usage());
  process.exit(2);
}

function listIssues(repo: string, label: string): ListedIssue[] {
  const result = spawnSync(
    'gh',
    ['issue', 'list', '--repo', repo, '--label', label, '--limit', String(ISSUE_LIMIT), '--json', 'number,title,createdAt'],
    { encoding: 'utf8' },
  );
  if (result.error) {
    throw new Error(`gh issue list (--label "${label}") failed to spawn: ${(result.error as Error).message}`);
  }
  if (result.status !== 0) {
    throw new Error(`gh issue list (--label "${label}") exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return JSON.parse(result.stdout || '[]') as ListedIssue[];
}

/**
 * Merge both label lists client-side: sort oldest-first by issue number,
 * dedupe by number within a pass. An issue carrying both labels is processed
 * once as "ready to implement" (downstream-most state wins).
 */
function planPass(planIssues: ListedIssue[], implementIssues: ListedIssue[]): PlannedRun[] {
  const byNumber = new Map<number, PlannedRun>();
  for (const issue of planIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_PLAN, command: COMMANDS[LABEL_PLAN] });
  }
  for (const issue of implementIssues) {
    byNumber.set(issue.number, { issue, label: LABEL_IMPLEMENT, command: COMMANDS[LABEL_IMPLEMENT] });
  }
  return [...byNumber.values()].sort((a, b) => a.issue.number - b.issue.number);
}

function runSkill(command: string, issueNumber: number, dryRun: boolean): Promise<number> {
  if (dryRun) {
    console.log(`[agent-daemon] dry-run: opencode run --command "${command}" "${issueNumber}"`);
    return Promise.resolve(0);
  }
  // shell: true so Windows resolves the opencode .ps1/.cmd shim (bare spawn risks ENOENT).
  return new Promise((resolve) => {
    const child = spawn('opencode', ['run', '--command', command, String(issueNumber)], {
      stdio: 'inherit',
      shell: true,
    });
    activeChild = child;
    child.on('error', (err) => {
      console.error(`[agent-daemon] failed to spawn opencode for issue #${issueNumber}: ${err.message}`);
      activeChild = null;
      resolve(1);
    });
    child.on('close', (code) => {
      activeChild = null;
      resolve(code ?? 1);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      resolve();
    }, ms);
  });
}

async function pollOnce(repo: string, dryRun: boolean): Promise<void> {
  let planIssues: ListedIssue[];
  let implementIssues: ListedIssue[];
  try {
    planIssues = listIssues(repo, LABEL_PLAN);
    implementIssues = listIssues(repo, LABEL_IMPLEMENT);
  } catch (err) {
    // Transient gh/network/auth failure: log, skip this pass, retry next interval.
    console.error(`[agent-daemon] ${(err as Error).message}; skipping pass`);
    return;
  }

  const runs = planPass(planIssues, implementIssues);
  if (runs.length === 0) {
    console.log('[agent-daemon] no labeled issues found');
    return;
  }

  for (const run of runs) {
    console.log(`[agent-daemon] claiming issue #${run.issue.number} ("${run.issue.title}") via ${run.command} [label: ${run.label}]`);
    const code = await runSkill(run.command, run.issue.number, dryRun);
    console.log(`[agent-daemon] completed issue #${run.issue.number} via ${run.command} exit code ${code}`);
  }
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      options: {
        repo: { type: 'string' },
        interval: { type: 'string' },
        once: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message);
  }

  const values = (parsed as ReturnType<typeof parseArgs>).values;
  if (values.help) {
    console.log(usage());
    process.exit(0);
  }

  const repo = (values.repo as string | undefined) ?? DEFAULT_REPO;
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    fail(`--repo must match OWNER/REPO, got "${repo}"`);
  }

  const rawInterval = (values.interval as string | undefined) ?? String(DEFAULT_INTERVAL_SECONDS);
  const interval = Number(rawInterval);
  if (!Number.isInteger(interval) || interval <= 0) {
    fail(`--interval must be a positive integer (seconds), got "${rawInterval}"`);
  }

  const once = Boolean(values.once);
  const dryRun = Boolean(values['dry-run']);

  process.on('SIGINT', () => {
    if (activeChild) {
      // Forward to the running skill; the loop resumes/completes via its close handler.
      activeChild.kill('SIGINT');
    } else {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
      console.log('[agent-daemon] interrupted, exiting');
      process.exit(0);
    }
  });

  console.log(
    `[agent-daemon] polling ${repo} every ${interval}s ("${LABEL_PLAN}" -> ${COMMANDS[LABEL_PLAN]}, "${LABEL_IMPLEMENT}" -> ${COMMANDS[LABEL_IMPLEMENT]})${dryRun ? ' [dry-run]' : ''}`,
  );

  for (;;) {
    await pollOnce(repo, dryRun);
    if (once) {
      break;
    }
    await sleep(interval * 1000);
  }
}

void main();
