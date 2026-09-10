import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path of the server package root (<repo>/apps/server). */
export const SERVER_ROOT = resolve(__dirname, '..');

/** Absolute path of the monorepo root (server -> apps -> root). */
export const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');

/**
 * Absolute path of the design workspace directory.
 *
 * `WORKSPACE_DIR` env overrides (used by tests); otherwise the repo-root
 * `workspace/` dir — the same location the preview server reads designs
 * from. Anchored to this file, never to `process.cwd()`: the server runs
 * with cwd `apps/server` under `npm run dev --workspace` but with the repo
 * root otherwise, so the old `resolve(cwd, 'apps/server/workspace')`
 * fallback created the doubled `apps/server/apps/server/workspace` path.
 */
export function getWorkspaceDir(): string {
  return process.env.WORKSPACE_DIR || resolve(REPO_ROOT, 'workspace');
}

/** Absolute path of the designs directory (<workspace>/designs). */
export function getDesignsDir(): string {
  return resolve(getWorkspaceDir(), 'designs');
}

/** Absolute path of the preview app (<repo>/apps/preview). */
export function getPreviewDir(): string {
  return resolve(REPO_ROOT, 'apps', 'preview');
}
