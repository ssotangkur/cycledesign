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

function runGh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
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

const SET_STATUS_MUTATION =
  'mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!)' +
  '{updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,' +
  'value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}';

/**
 * Set an issue's Status option by name. Never throws.
 * 'skipped' = issue not on the project board (or label has no Status twin).
 */
export function setProjectStatus(repo: string, issueNumber: number, status: string): SyncResult {
  try {
    const view = runGh(['project', 'view', projectNumber(), '--owner', projectOwner(), '--format', 'json']);
    if (!view.ok) {
      return 'failed';
    }
    const projectId = (JSON.parse(view.stdout) as { id?: string }).id;
    if (!projectId) {
      return 'failed';
    }
    const fields = runGh(['project', 'field-list', projectNumber(), '--owner', projectOwner(), '--format', 'json']);
    if (!fields.ok) {
      return 'failed';
    }
    const field = (JSON.parse(fields.stdout) as { fields?: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }> }).fields?.find(
      (f) => f.name === STATUS_FIELD,
    );
    const optionId = field?.options?.find((o) => o.name === status)?.id;
    if (!field || !optionId) {
      return 'failed';
    }
    const items = runGh(['project', 'item-list', projectNumber(), '--owner', projectOwner(), '--format', 'json']);
    if (!items.ok) {
      return 'failed';
    }
    const item = (JSON.parse(items.stdout) as { items?: Array<{ id: string; content?: { number?: number; repository?: string } }> }).items?.find(
      (i) => i.content?.number === issueNumber && i.content?.repository === repo,
    );
    if (!item) {
      return 'skipped';
    }
    const update = runGh([
      'api',
      'graphql',
      '-f',
      `query=${SET_STATUS_MUTATION}`,
      '-f',
      `projectId=${projectId}`,
      '-f',
      `itemId=${item.id}`,
      '-f',
      `fieldId=${field.id}`,
      '-f',
      `optionId=${optionId}`,
    ]);
    return update.ok ? 'synced' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Mirror a label that just landed onto Status. Never throws. */
export function syncStatusForLabel(repo: string, issueNumber: number, label: string): SyncResult {
  try {
    const status = labelToStatus(label);
    if (!status) {
      return 'skipped';
    }
    return setProjectStatus(repo, issueNumber, status);
  } catch {
    return 'failed';
  }
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
  const result = setProjectStatus(repo, issueNumber, status);
  console.log(result);
  return result;
}

const invokedAsMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/agent-project.ts') ?? false;
if (invokedAsMain) {
  main(process.argv.slice(2));
}
