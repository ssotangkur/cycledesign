/**
 * Docker Sandbox (microVM) spawn target for daemon workers (#121).
 *
 * One disposable sandbox per run: `create` (mounts the daemon cwd) ->
 * per-sandbox `secret set github` (proxy-authenticates `gh`/git HTTPS, the
 * token never enters the VM env) -> `cp` host auth.json in -> per-sandbox
 * network allowlist -> `git clone` of the repo (the workdir mount's `.git`
 * is a linked-worktree pointer to a host path, unusable in-VM) -> attached
 * `exec -w <clone>` of `opencode run` with piped stdio -> `stop` + `rm --force`.
 *
 * Why disposable: an idle VM stops ~30-60s after the last client
 * disconnects (killing detached work), and killing the host `sbx.exe`
 * client alone ORPHANS the in-VM worker. Destroying the sandbox is the
 * only reliable kill, so failover/watchdog paths must destroy, not just
 * tree-kill the client.
 *
 * Provider auth: v1 copies the host auth.json (TUI `/connect` keys,
 * `~/.local/share/opencode/auth.json`), proven end-to-end for both the
 * free Zen model and the Go subscription model.
 * GitHub auth (#129): the runtime injects an EMPTY `GH_TOKEN` which poisons
 * `gh` ("The token in GH_TOKEN is invalid"), so the daemon resolves the
 * host token (`GH_TOKEN` env or `gh auth token`) and stores it per-sandbox
 * via `sbx secret set github --sandbox <name>`; the proxy then authenticates
 * `gh` and git HTTPS without exposing the token in-VM.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** In-VM path where the opencode agent reads provider auth. */
export const SANDBOX_AUTH_PATH = '/home/agent/.local/share/opencode/auth.json';

/** Default universal worker template (built from sbx/sandbox.Dockerfile). */
export const DEFAULT_SBX_TEMPLATE = 'cycledesign-worker';

/** In-VM clone target: a functional repo (the workdir mount's `.git` is a host-path worktree pointer, #129). */
export const SANDBOX_REPO_DIR = '/home/agent/repo';

/** Clone URL for the polled repo (proxy authenticates git HTTPS, #129). */
export function cloneUrl(repoSlug: string): string {
  return `https://github.com/${repoSlug}.git`;
}

/**
 * Resolve the host GitHub token: `GH_TOKEN` env when non-empty, else
 * `gh auth token` (host `gh` uses stored credential, not env). Returns ''
 * when unresolvable; provision fails fast on '' so the worker never sees
 * the runtime's empty-GH_TOKEN poisoning (#129).
 */
export function resolveGithubToken(envToken: string | undefined): string {
  if (envToken !== undefined && envToken.trim() !== '') {
    return envToken.trim();
  }
  try {
    const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      return '';
    }
    return (result.stdout ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Minimal egress allowlist for a worker run. Discovered via
 * `sbx policy log`: Go models hit models.opencode.ai, free-tier Zen hits
 * bare opencode.ai (`*.opencode.ai` does NOT cover the bare domain, #126).
 */
export const SANDBOX_NETWORK_HOSTS = [
  'opencode.ai',
  'models.opencode.ai',
  '*.opencode.ai',
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
];

/**
 * Resolve the sbx binary: explicit override, else the Docker Sandboxes
 * install location on win32, else PATH lookup.
 */
export function resolveSbxBin(
  override: string | undefined,
  platform: NodeJS.Platform = process.platform,
  localAppData: string | undefined = process.env['LOCALAPPDATA'],
): string {
  if (override !== undefined && override.trim() !== '') {
    return override.trim();
  }
  if (platform === 'win32' && localAppData !== undefined && localAppData !== '') {
    return join(localAppData, 'DockerSandboxes', 'bin', 'sbx.exe');
  }
  return 'sbx';
}

/** Disposable per-run sandbox name (destroyed on every finish path). */
export function sandboxNameFor(issueNumber: number): string {
  return `cycledesign-issue-${issueNumber}`;
}

/** Host path of the TUI `/connect` provider keys (XDG on every platform). */
export function hostAuthJsonPath(homeDir: string): string {
  return join(homeDir, '.local', 'share', 'opencode', 'auth.json');
}

export function createArgs(name: string, workdir: string, template: string): string[] {
  return ['create', '-t', template, '--name', name, 'opencode', workdir];
}

export function cpAuthArgs(hostAuthPath: string, name: string): string[] {
  return ['cp', hostAuthPath, `${name}:${SANDBOX_AUTH_PATH}`];
}

export function policyArgs(name: string, hosts: string[]): string[] {
  return ['policy', 'allow', 'network', '--sandbox', name, hosts.join(',')];
}

/** Per-sandbox GitHub secret: the proxy authenticates `gh`/git HTTPS, the token never enters the VM env (#129). */
export function secretArgs(name: string, token: string): string[] {
  // -f: sandbox names are per-issue, and a scoped secret outlives `rm` of
  // the sandbox, so repeat runs for the same issue must overwrite (#129).
  return ['secret', 'set', 'github', '--sandbox', name, '-f', '-t', token];
}

/** Drop the sandbox-scoped github secret (outlives `rm`, so teardown owns it, #129). */
export function secretRmArgs(name: string): string[] {
  // -f: no confirmation prompt (spawnSync has no stdin; prompting aborts and leaks the secret).
  return ['secret', 'rm', 'github', '--sandbox', name, '-f'];
}

/** Fresh clone in-VM (proxy-authenticated HTTPS); skills need a functional repo (#129). */
export function cloneArgs(name: string, repoSlug: string): string[] {
  return ['exec', name, 'git', 'clone', cloneUrl(repoSlug), SANDBOX_REPO_DIR];
}

/** Attached foreground exec (no -t): stdout/stderr separated, exit code propagates. */
export function execArgs(name: string, command: string[], headlessContent: string, workdir?: string, extraEnv?: Record<string, string>): string[] {
  // Flags precede the sandbox name (docker-exec convention); anything after
  // the name is the in-VM command (a misplaced -e fails with
  // "executable file `-e` not found in $PATH", #123).
  // -w points the worker at the in-VM clone; omitted the exec inherits the
  // workdir mount cwd (probe path, where no clone exists).
  // #140: extraEnv forwards PROJECT_OWNER/PROJECT_NUMBER so the in-VM
  // Status mirror uses the host board instead of defaults.
  const flagArgs = workdir === undefined ? [] : ['-w', workdir];
  const extraFlags: string[] = [];
  if (extraEnv !== undefined) {
    for (const [key, value] of Object.entries(extraEnv)) {
      extraFlags.push('-e', `${key}=${value}`);
    }
  }
  return ['exec', '-e', `OPENCODE_CONFIG_CONTENT=${headlessContent}`, ...extraFlags, ...flagArgs, name, ...command];
}

/** #140: explicit board env for the in-VM worker (defaults match agent-project.ts). */
export function vmProjectEnv(owner?: string, number?: string): Record<string, string> {
  return {
    PROJECT_OWNER: owner ?? process.env['PROJECT_OWNER'] ?? 'ssotangkur',
    PROJECT_NUMBER: number ?? process.env['PROJECT_NUMBER'] ?? '1',
  };
}

/** #140: cached per-token project-scope probe (one validation per daemon lifetime). */
let cachedTokenScope: { token: string; ok: boolean; output: string } | null = null;

/** Test hook: reset the cached scope probe. */
export function clearTokenScopeCache(): void {
  cachedTokenScope = null;
}

/**
 * Validate that `token` carries the `project` scope via a read-only
 * `project view` probe. GH_TOKEN travels via env (never argv — argv leaks
 * via `ps`). Returns ok=true unless the probe proves auth/scope failure;
 * transport/ambiguous failures allow the provision to proceed (mirror
 * warns at runtime; KD-2 keeps claims non-blocking).
 */
export function checkGithubTokenScope(token: string, owner?: string, projectNo?: string): { ok: boolean; output: string } {
  if (cachedTokenScope !== null && cachedTokenScope.token === token) {
    return { ok: cachedTokenScope.ok, output: cachedTokenScope.output };
  }
  const projOwner = owner ?? process.env['PROJECT_OWNER'] ?? 'ssotangkur';
  const projNumber = projectNo ?? process.env['PROJECT_NUMBER'] ?? '1';
  try {
    const result = spawnSync('gh', ['project', 'view', projNumber, '--owner', projOwner, '--format', 'json'], {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: token },
    });
    const stderr = result.error ? (result.error as Error).message : (result.stderr || '').trim();
    if (result.error || result.status !== 0) {
      const text = stderr || '';
      const isAuth = /401|403|bad credentials|unknown owner type|forbidden|unauthorized|missing.*scope|requires?.*scope|need.*scope|scope.*required|insufficient.*scope|project.*scope|gh auth refresh|http 401|http 403/i.test(text);
      if (isAuth) {
        const output = `token lacks 'project' scope for ${projOwner}/${projNumber} [step: project view] ${text}`.trim();
        cachedTokenScope = { token, ok: false, output };
        return { ok: false, output };
      }
      // Transport/ambiguous: do not cache (re-probe next provision), allow run.
      return { ok: true, output: '' };
    }
    cachedTokenScope = { token, ok: true, output: '' };
    return { ok: true, output: '' };
  } catch {
    return { ok: true, output: '' };
  }
}

export function removeArgs(name: string): string[] {
  return ['rm', '--force', name];
}

interface SbxResult {
  ok: boolean;
  output: string;
}

function runSbx(sbxBin: string, args: string[]): SbxResult {
  const result = spawnSync(sbxBin, args, { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error) {
    return { ok: false, output: `${(result.error as Error).message}\n${output}`.trim() };
  }
  return { ok: result.status === 0, output };
}

export interface ProvisionResult {
  ok: boolean;
  step: string;
  output: string;
}

export interface ProvisionOptions {
  /** OWNER/REPO to clone in-VM; when omitted the secret+clone steps are skipped (probe path). */
  repoSlug?: string;
  /** Host GitHub token for `secret set`; '' fails fast (never poison the VM with it). */
  githubToken?: string;
}

/**
 * Create -> per-sandbox github secret -> auth copy -> network allowlist ->
 * repo clone. Fails fast with the blaming step (secret value redacted).
 */
export function provisionSandbox(sbxBin: string, name: string, workdir: string, hostAuthPath: string, template: string, opts: ProvisionOptions = {}): ProvisionResult {
  if (opts.githubToken !== undefined && opts.githubToken === '') {
    return { ok: false, step: 'github-token', output: 'unresolvable: set GH_TOKEN or log host gh in (`gh auth login`)' };
  }
  // #140: fail fast when the resolved token provably lacks the project scope.
  if (opts.githubToken !== undefined && opts.githubToken !== '') {
    const scope = checkGithubTokenScope(opts.githubToken);
    if (!scope.ok) {
      const redacted = scope.output.split(opts.githubToken).join('***');
      return {
        ok: false,
        step: 'github-scope',
        output: `${redacted} — grant 'project' scope (gh auth refresh -s project) or set GH_TOKEN with it (see .agent-daemon.env.example)`,
      };
    }
  }
  const steps: Array<[string, string[]]> = [['create', createArgs(name, workdir, template)]];
  if (opts.githubToken !== undefined) {
    steps.push(['github-secret', secretArgs(name, opts.githubToken)]);
  }
  steps.push(['cp-auth', cpAuthArgs(hostAuthPath, name)]);
  steps.push(['allow-network', policyArgs(name, SANDBOX_NETWORK_HOSTS)]);
  if (opts.repoSlug !== undefined) {
    steps.push(['clone-repo', cloneArgs(name, opts.repoSlug)]);
  }
  for (const [step, args] of steps) {
    const result = runSbx(sbxBin, args);
    if (!result.ok) {
      const output = step === 'github-secret' && opts.githubToken !== undefined && opts.githubToken !== ''
        ? result.output.split(opts.githubToken).join('***')
        : result.output;
      return { ok: false, step, output };
    }
  }
  return { ok: true, step: 'done', output: '' };
}

/**
 * Best-effort teardown: stop (may already be stopped) then forced remove,
 * then drop the sandbox-scoped github secret (it outlives `rm`, #129).
 * Never throws; kill paths call this after tree-killing the host client.
 *
 * #149 KD-5: returns the teardown status with logged output so callers can
 * fail closed (a failed destroy suppresses the lease release and parks at
 * `question` instead of re-queueing a duplicate run behind the orphan).
 */
export function destroySandbox(sbxBin: string, name: string): { ok: boolean; output: string } {
  const outputs: string[] = [];
  let ok = true;
  const stop = runSbx(sbxBin, ['stop', name]);
  // `stop` on an already-stopped/missing sandbox is not a destroy failure.
  if (!stop.ok && !/not found|no such|not running|already stopped/i.test(stop.output)) {
    ok = false;
  }
  outputs.push(`stop: ${stop.output || '(empty)'}`.slice(0, 500));
  const rm = runSbx(sbxBin, removeArgs(name));
  if (!rm.ok) {
    ok = false;
  }
  outputs.push(`rm: ${rm.output || '(empty)'}`.slice(0, 500));
  const secret = runSbx(sbxBin, secretRmArgs(name));
  // Secret cleanup is best-effort only (a leaked scoped secret does not
  // orphan a worker); it never flips the destroy status.
  outputs.push(`secret-rm: ${secret.output || '(empty)'}`.slice(0, 200));
  return { ok, output: outputs.join('\n') };
}

/** Best-effort one-liner for the watchdog bundle (never throws). */
export function sandboxStatus(sbxBin: string, name: string): string {
  try {
    const result = runSbx(sbxBin, ['ls']);
    if (!result.ok) {
      return '(sbx ls unavailable)';
    }
    const line = result.output.split('\n').find((l) => l.includes(name));
    return (line ?? '(sandbox not listed)').trim().slice(0, 500);
  } catch {
    return '(sbx status unavailable)';
  }
}

/**
 * #149 KD-4: VM-side liveness collectors (Spike 0 report: tmp/spike-149-report.md).
 *
 * The worker lives in-VM, so every liveness leg must be VM-side. Each
 * collector is its own `sbx exec` (a second exec runs concurrently with the
 * attached worker — proven 494ms; `&`-backgrounding inside one exec does NOT
 * detach). Steady-state cost ~0.5s each; 10s timeout each (Q9a), async batch.
 */

// In-VM opencode log: carries `run=<hex>` + `created id=<ses> parentID=` +
// `session.id=<ses>` — join key is the stdout `sessionID` (Spike 0: 4/4 lines matched).
export const VM_OPENCODE_LOG = '/home/agent/.local/share/opencode/log/opencode.log';

/** Max bytes per log-tail collection (tail-size cap, Q9a). */
export const VM_LOG_TAIL_BYTES = 64 * 1024;

/** Per-collector `sbx exec` timeout (Q9a: ~10s; well under 30s WATCHDOG_POLL_MS). */
export const VM_COLLECTOR_TIMEOUT_MS = 10_000;

/** VM log tail (run-ID/session-ID join + mtime recency). */
export function vmLogTailArgs(name: string, bytes: number = VM_LOG_TAIL_BYTES): string[] {
  return ['exec', name, 'tail', '-c', String(bytes), VM_OPENCODE_LOG];
}

/** VM log mtime (epoch seconds) — recency before the first stdout sessionID. */
export function vmLogMtimeArgs(name: string): string[] {
  return ['exec', name, 'stat', '-c', '%Y', VM_OPENCODE_LOG];
}

/** VM VCS legs: tip commit time (epoch) + worktree dirtiness. */
export function vmVcsLogArgs(name: string): string[] {
  return ['exec', name, 'git', '-C', SANDBOX_REPO_DIR, 'log', '-1', '--format=%ct'];
}

export function vmVcsStatusArgs(name: string): string[] {
  return ['exec', name, 'git', '-C', SANDBOX_REPO_DIR, 'status', '--porcelain'];
}

/** Sandbox session-log leg: in-VM session list (local DB read, no LLM/quota). */
export function vmSessionListArgs(name: string): string[] {
  return ['exec', name, 'opencode', 'session', 'list', '--format', 'json'];
}
