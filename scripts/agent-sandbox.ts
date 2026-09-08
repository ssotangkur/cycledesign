/**
 * Docker Sandbox (microVM) spawn target for daemon workers (#121).
 *
 * One disposable sandbox per run: `create` (mounts the daemon cwd) ->
 * `cp` host auth.json in -> per-sandbox network allowlist -> attached
 * `exec` of `opencode run` with piped stdio -> `stop` + `rm --force`.
 *
 * Why disposable: an idle VM stops ~30-60s after the last client
 * disconnects (killing detached work), and killing the host `sbx.exe`
 * client alone ORPHANS the in-VM worker. Destroying the sandbox is the
 * only reliable kill, so failover/watchdog paths must destroy, not just
 * tree-kill the client.
 *
 * Auth: `sbx secret` proxy is the long-term path (`set-custom` keyed on
 * `models.opencode.ai` + `OPENCODE_API_KEY` is the untested hypothesis);
 * v1 copies the host auth.json (TUI `/connect` keys,
 * `~/.local/share/opencode/auth.json`), proven end-to-end for both the
 * free Zen model and the Go subscription model.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** In-VM path where the opencode agent reads provider auth. */
export const SANDBOX_AUTH_PATH = '/home/agent/.local/share/opencode/auth.json';

/** Default universal worker template (built from sbx/sandbox.Dockerfile). */
export const DEFAULT_SBX_TEMPLATE = 'cycledesign-worker';

/**
 * Minimal egress allowlist for a worker run. Discovered via
 * `sbx policy log` (Zen model traffic = models.opencode.ai).
 */
export const SANDBOX_NETWORK_HOSTS = [
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

/** Attached foreground exec (no -t): stdout/stderr separated, exit code propagates. */
export function execArgs(name: string, command: string[], headlessContent: string): string[] {
  return ['exec', name, '-e', `OPENCODE_CONFIG_CONTENT=${headlessContent}`, ...command];
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

/** Create -> auth copy -> network allowlist. Fails fast with the blaming step. */
export function provisionSandbox(sbxBin: string, name: string, workdir: string, hostAuthPath: string, template: string): ProvisionResult {
  const steps: Array<[string, string[]]> = [
    ['create', createArgs(name, workdir, template)],
    ['cp-auth', cpAuthArgs(hostAuthPath, name)],
    ['allow-network', policyArgs(name, SANDBOX_NETWORK_HOSTS)],
  ];
  for (const [step, args] of steps) {
    const result = runSbx(sbxBin, args);
    if (!result.ok) {
      return { ok: false, step, output: result.output };
    }
  }
  return { ok: true, step: 'done', output: '' };
}

/**
 * Best-effort teardown: stop (may already be stopped) then forced remove.
 * Never throws; kill paths call this after tree-killing the host client.
 */
export function destroySandbox(sbxBin: string, name: string): void {
  runSbx(sbxBin, ['stop', name]);
  runSbx(sbxBin, removeArgs(name));
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
