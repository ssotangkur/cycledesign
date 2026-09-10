import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  SERVER_ROOT,
  REPO_ROOT,
  getWorkspaceDir,
  getDesignsDir,
  getPreviewDir,
} from './paths.js';

function normalized(value: string): string {
  return value.replace(/\\/g, '/');
}

describe('paths', () => {
  const prevWorkspaceDir = process.env.WORKSPACE_DIR;

  beforeEach(() => {
    delete process.env.WORKSPACE_DIR;
  });

  afterEach(() => {
    if (prevWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = prevWorkspaceDir;
    }
  });

  it('anchors the server root to the apps/server package', () => {
    expect(existsSync(resolve(SERVER_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(resolve(SERVER_ROOT, 'src', 'server.ts'))).toBe(true);
  });

  it('anchors the repo root to the workspace root (not apps/)', () => {
    const rootPkgPath = resolve(REPO_ROOT, 'package.json');
    expect(existsSync(rootPkgPath)).toBe(true);
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8')) as { name?: string };
    expect(rootPkg.name).toBe('cycledesign');
    expect(existsSync(resolve(REPO_ROOT, 'apps', 'server', 'package.json'))).toBe(true);
    expect(existsSync(resolve(REPO_ROOT, 'apps', 'preview', 'package.json'))).toBe(true);
  });

  it('defaults the workspace to repo-root workspace/', () => {
    expect(getWorkspaceDir()).toBe(resolve(REPO_ROOT, 'workspace'));
    expect(getDesignsDir()).toBe(resolve(REPO_ROOT, 'workspace', 'designs'));
  });

  it('never produces a doubled apps/server segment', () => {
    expect(normalized(getWorkspaceDir())).not.toContain('apps/server/apps');
    expect(normalized(getDesignsDir())).not.toContain('apps/server/apps');
    expect(normalized(getPreviewDir())).not.toContain('apps/server/apps');
  });

  it('resolves the preview dir to apps/preview', () => {
    expect(getPreviewDir()).toBe(resolve(REPO_ROOT, 'apps', 'preview'));
  });

  it('does not match the legacy cwd-derived path under the dev cwd', () => {
    // Regression: the old resolve(cwd, 'apps/server/workspace') fallback
    // doubled to apps/server/apps/server/workspace when cwd was
    // apps/server (dev workspace mode: `npm run dev --workspace`).
    // (No process.chdir: vitest workers forbid it, so the legacy
    // expression is evaluated directly instead.)
    const legacyUnderDevCwd = resolve(SERVER_ROOT, 'apps', 'server', 'workspace');
    expect(normalized(legacyUnderDevCwd)).toContain('apps/server/apps/server');
    expect(getWorkspaceDir()).not.toBe(legacyUnderDevCwd);
    expect(getDesignsDir()).not.toBe(resolve(legacyUnderDevCwd, 'designs'));
  });

  it('honors WORKSPACE_DIR env override', () => {
    process.env.WORKSPACE_DIR = resolve(REPO_ROOT, 'tmp', 'custom-workspace');
    expect(getWorkspaceDir()).toBe(resolve(REPO_ROOT, 'tmp', 'custom-workspace'));
    expect(getDesignsDir()).toBe(resolve(REPO_ROOT, 'tmp', 'custom-workspace', 'designs'));
  });
});
