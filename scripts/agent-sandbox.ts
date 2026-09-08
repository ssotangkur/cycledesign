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
  return ['secret', 'rm', 'github', '--sandbox', name];
}

/** Fresh clone in-VM (proxy-authenticated HTTPS); skills need a functional repo (#129). */
export function cloneArgs(name: string, repoSlug: string): string[] {
  return ['exec', name, 'git', 'clone', cloneUrl(repoSlug), SANDBOX_REPO_DIR];
}

/** Attached foreground exec (no -t): stdout/stderr separated, exit code propagates. */
export function execArgs(name: string, command: string[], headlessContent: string, workdir?: string): string[] {
  // Flags precede the sandbox name (docker-exec convention); anything after
  // the name is the in-VM command (a misplaced -e fails with
  // "executable file `-e` not found in $PATH", #123).
  // -w points the worker at the in-VM clone; omitted the exec inherits the
  // workdir mount cwd (probe path, where no clone exists).
  const flagArgs = workdir === undefined ? [] : ['-w', workdir];
  return ['exec', '-e', `OPENCODE_CONFIG_CONTENT=${headlessContent}`, ...flagArgs, name, ...command];
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
 */
export function destroySandbox(sbxBin: string, name: string): void {
  runSbx(sbxBin, ['stop', name]);
  runSbx(sbxBin, removeArgs(name));
  runSbx(sbxBin, secretRmArgs(name));
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
