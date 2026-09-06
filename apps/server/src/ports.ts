import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getPorts } = require('../../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => {
    web: number;
    server: number;
    preview: number;
    offset: number;
    e2e: boolean;
  };
};

export interface ResolvedPorts {
  web: number;
  server: number;
  preview: number;
  offset: number;
  e2e: boolean;
}

/** Effective ports for this process (e2e mode via CYCLEDESIGN_E2E env). */
export function resolvePorts(): ResolvedPorts {
  return getPorts();
}

function parsePortEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export function resolveServerPort(): number {
  const ports = resolvePorts();
  return parsePortEnv(process.env.SERVER_PORT ?? process.env.PORT, ports.server);
}

export function resolvePreviewPort(): number {
  const ports = resolvePorts();
  return parsePortEnv(process.env.PREVIEW_PORT ?? process.env.PORT, ports.preview);
}

/** CORS origins for browser clients of the current mode (web dev server). */
export function resolveWebOrigins(): string[] {
  const { web } = resolvePorts();
  const origins = new Set([
    `http://localhost:${web}`,
    `http://127.0.0.1:${web}`,
  ]);
  if (process.env.FRONTEND_URL) {
    origins.add(process.env.FRONTEND_URL);
  }
  return [...origins];
}

/** Best-effort "who owns this port" hint for EADDRINUSE errors. */
export function describePortOwner(port: number): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p TCP | findstr ":${port} "`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids = [
        ...new Set(
          out
            .split('\n')
            .map((line) => (line.trim().split(/\s+/)[4] || '').trim())
            .filter((pid) => pid !== '' && pid !== '0'),
        ),
      ];
      if (pids.length === 0) {
        return 'owner unknown';
      }
      const owners = pids.map((pid) => {
        try {
          const task = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
          return `PID ${pid} (${task.split(',')[0].replace(/"/g, '')})`;
        } catch {
          return `PID ${pid}`;
        }
      });
      return `owner: ${owners.join(', ')}`;
    }
    const out = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`, {
      encoding: 'utf8',
    }).trim();
    return out ? `owner PID ${out.split('\n')[0].trim()}` : 'owner unknown';
  } catch {
    return 'owner unknown';
  }
}
