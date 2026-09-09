import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  SANDBOX_AUTH_PATH,
  SANDBOX_NETWORK_HOSTS,
  SANDBOX_REPO_DIR,
  cloneArgs,
  cloneUrl,
  cpAuthArgs,
  createArgs,
  execArgs,
  hostAuthJsonPath,
  policyArgs,
  removeArgs,
  resolveGithubToken,
  resolveSbxBin,
  sandboxNameFor,
  secretArgs,
  secretRmArgs,
} from './agent-sandbox.js';

describe('sbx binary resolution', () => {
  it('prefers an explicit override', () => {
    assert.equal(resolveSbxBin('C:\\tools\\sbx.exe', 'win32', 'C:\\Users\\x\\AppData\\Local'), 'C:\\tools\\sbx.exe');
  });

  it('uses the Docker Sandboxes install path on win32', () => {
    assert.equal(
      resolveSbxBin(undefined, 'win32', 'C:\\Users\\x\\AppData\\Local'),
      join('C:\\Users\\x\\AppData\\Local', 'DockerSandboxes', 'bin', 'sbx.exe'),
    );
  });

  it('falls back to PATH lookup off win32', () => {
    assert.equal(resolveSbxBin(undefined, 'linux', undefined), 'sbx');
  });

  it('falls back to PATH lookup when win32 has no LOCALAPPDATA', () => {
    assert.equal(resolveSbxBin('', 'win32', ''), 'sbx');
  });
});

describe('sandbox naming + paths', () => {
  it('names one disposable sandbox per issue', () => {
    assert.equal(sandboxNameFor(121), 'cycledesign-issue-121');
  });

  it('points at the TUI auth.json via XDG path', () => {
    assert.equal(hostAuthJsonPath('/home/user'), join('/home/user', '.local', 'share', 'opencode', 'auth.json'));
  });

  it('keeps the in-VM auth path stable', () => {
    assert.equal(SANDBOX_AUTH_PATH, '/home/agent/.local/share/opencode/auth.json');
  });

  it('allowlist covers model, git, and npm endpoints', () => {
    for (const host of ['opencode.ai', 'models.opencode.ai', 'github.com', 'api.github.com', 'registry.npmjs.org']) {
      assert.ok(SANDBOX_NETWORK_HOSTS.includes(host), `missing ${host}`);
    }
  });
});

describe('sbx argv builders', () => {
  it('creates an opencode sandbox mounting the workdir', () => {
    assert.deepEqual(createArgs('cycledesign-issue-1', 'D:\\work', 'cycledesign-worker'), [
      'create',
      '-t',
      'cycledesign-worker',
      '--name',
      'cycledesign-issue-1',
      'opencode',
      'D:\\work',
    ]);
  });

  it('copies host auth into the VM', () => {
    assert.deepEqual(cpAuthArgs('C:\\Users\\x\\auth.json', 'cycledesign-issue-1'), [
      'cp',
      'C:\\Users\\x\\auth.json',
      'cycledesign-issue-1:/home/agent/.local/share/opencode/auth.json',
    ]);
  });

  it('scopes the network allowlist to the sandbox', () => {
    assert.deepEqual(policyArgs('cycledesign-issue-1', ['a.example', 'b.example']), [
      'policy',
      'allow',
      'network',
      '--sandbox',
      'cycledesign-issue-1',
      'a.example,b.example',
    ]);
  });

  it('builds attached foreground exec with headless env (no -t)', () => {
    const args = execArgs('cycledesign-issue-1', ['opencode', 'run', '--format', 'json', 'hi'], 'DENY');
    assert.deepEqual(args, ['exec', '-e', 'OPENCODE_CONFIG_CONTENT=DENY', 'cycledesign-issue-1', 'opencode', 'run', '--format', 'json', 'hi']);
    assert.ok(!args.includes('-t') && !args.includes('-d'));
  });

  it('points exec at the in-VM clone with -w before the name', () => {
    assert.deepEqual(execArgs('cycledesign-issue-1', ['opencode', 'run'], 'DENY', SANDBOX_REPO_DIR), [
      'exec',
      '-e',
      'OPENCODE_CONFIG_CONTENT=DENY',
      '-w',
      '/home/agent/repo',
      'cycledesign-issue-1',
      'opencode',
      'run',
    ]);
  });

  it('scopes the github secret to the sandbox (overwrite for repeat runs)', () => {
    assert.deepEqual(secretArgs('cycledesign-issue-1', 'tok'), [
      'secret',
      'set',
      'github',
      '--sandbox',
      'cycledesign-issue-1',
      '-f',
      '-t',
      'tok',
    ]);
  });

  it('clones the polled repo to the stable in-VM path', () => {
    assert.equal(cloneUrl('ssotangkur/cycledesign'), 'https://github.com/ssotangkur/cycledesign.git');
    assert.deepEqual(cloneArgs('cycledesign-issue-1', 'ssotangkur/cycledesign'), [
      'exec',
      'cycledesign-issue-1',
      'git',
      'clone',
      'https://github.com/ssotangkur/cycledesign.git',
      '/home/agent/repo',
    ]);
  });

  it('prefers a non-empty GH_TOKEN env value (trimmed)', () => {
    assert.equal(resolveGithubToken('  abc  '), 'abc');
  });

  it('forces non-interactive removal', () => {
    assert.deepEqual(removeArgs('cycledesign-issue-1'), ['rm', '--force', 'cycledesign-issue-1']);
  });

  it('drops the sandbox-scoped github secret on teardown', () => {
    assert.deepEqual(secretRmArgs('cycledesign-issue-1'), ['secret', 'rm', 'github', '--sandbox', 'cycledesign-issue-1', '-f']);
  });
});
