import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAEMON_ENV_FILE = '.agent-daemon.env';
export const DAEMON_ENV_EXAMPLE = '.agent-daemon.env.example';

export const DEFAULT_FREE_MODEL = 'opencode/muse-spark-1.3-contributor-free';
export const DEFAULT_GO_MODEL = 'opencode-go/muse-spark-1.3-contributor';
export const DEFAULT_STUCK_TIMEOUT_S = 900;
export const DEFAULT_PROBE_INTERVAL_S = 900;
export const DEFAULT_PROBE_TIMEOUT_S = 90;

export interface DaemonConfig {
  freeModel: string;
  goModel: string;
  stuckTimeoutS: number;
  probeIntervalS: number;
  probeTimeoutS: number;
}

export function missingConfigMessage(cwd: string): string {
  return (
    `[agent-daemon] missing config: ${join(cwd, DAEMON_ENV_FILE)} not found.\n` +
    `Copy \`${DAEMON_ENV_EXAMPLE}\` to \`${DAEMON_ENV_FILE}\` and adjust values, then restart.`
  );
}

/** Parse KEY=value lines with `#` comments. Unknown keys are ignored. */
export function parseDaemonEnv(raw: string): Partial<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    // Strip inline comments for unquoted values ("KEY=val # comment").
    if (!trimmed.includes('"') && !trimmed.includes("'")) {
      const hash = value.indexOf('#');
      if (hash >= 0) {
        value = value.slice(0, hash).trim();
      }
    }
    if (key !== '') {
      out[key] = value;
    }
  }
  return out;
}

function parsePositiveInt(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[agent-daemon] invalid ${key}=${JSON.stringify(raw)} (expected positive integer)`);
  }
  return n;
}

export function resolveDaemonConfig(values: Partial<Record<string, string>>): DaemonConfig {
  return {
    freeModel: values['FREE_MODEL'] || DEFAULT_FREE_MODEL,
    goModel: values['GO_MODEL'] || DEFAULT_GO_MODEL,
    stuckTimeoutS: parsePositiveInt(values['STUCK_TIMEOUT_S'], DEFAULT_STUCK_TIMEOUT_S, 'STUCK_TIMEOUT_S'),
    probeIntervalS: parsePositiveInt(values['PROBE_INTERVAL_S'], DEFAULT_PROBE_INTERVAL_S, 'PROBE_INTERVAL_S'),
    probeTimeoutS: parsePositiveInt(values['PROBE_TIMEOUT_S'], DEFAULT_PROBE_TIMEOUT_S, 'PROBE_TIMEOUT_S'),
  };
}

/**
 * Load daemon config from `<cwd>/.agent-daemon.env` (or `AGENT_DAEMON_ENV`
 * override). Throws with setup instructions when the file is missing so
 * `main()` can exit 2 (usage error → supervisor does not restart).
 */
export function loadDaemonConfig(cwd: string = process.cwd()): DaemonConfig {
  const file = process.env['AGENT_DAEMON_ENV'] || join(cwd, DAEMON_ENV_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(missingConfigMessage(cwd));
    }
    throw err;
  }
  return resolveDaemonConfig(parseDaemonEnv(raw));
}
