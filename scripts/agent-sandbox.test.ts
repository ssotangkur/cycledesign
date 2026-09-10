import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  SANDBOX_AUTH_PATH,
  SANDBOX_NETWORK_HOSTS,
  SANDBOX_REPO_DIR,
  VM_COLLECTOR_TIMEOUT_MS,
  VM_LOG_TAIL_BYTES,
  VM_OPENCODE_LOG,
  checkGithubTokenScope,
  clearTokenScopeCache,
  cloneArgs,
  cloneUrl,
  cpAuthArgs,
  createArgs,
  destroySandbox,
  execArgs,
  hostAuthJsonPath,
  policyArgs,
  provisionSandbox,
  removeArgs,
  resolveGithubToken,
  resolveSbxBin,
  sandboxNameFor,
  secretArgs,
  secretRmArgs,
  vmLogMtimeArgs,
  vmLogTailArgs,
  vmProjectEnv,
  vmSessionListArgs,
  vmVcsLogArgs,
  vmVcsStatusArgs,
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

describe('in-VM board env (#140 KD-5)', () => {
  it('defaults to the ssotangkur/1 board', () => {
    delete process.env['PROJECT_OWNER'];
    delete process.env['PROJECT_NUMBER'];
    assert.deepEqual(vmProjectEnv(), { PROJECT_OWNER: 'ssotangkur', PROJECT_NUMBER: '1' });
  });

  it('forwards custom board config into the VM', () => {
    assert.deepEqual(vmProjectEnv('custom-owner', '99'), { PROJECT_OWNER: 'custom-owner', PROJECT_NUMBER: '99' });
  });

  it('adds -e PROJECT_* flags after OPENCODE_CONFIG_CONTENT without breaking the base shape', () => {
    const args = execArgs('cycledesign-issue-1', ['opencode', 'run'], 'DENY', SANDBOX_REPO_DIR, {
      PROJECT_OWNER: 'custom-owner',
      PROJECT_NUMBER: '99',
    });
    assert.deepEqual(args, [
      'exec',
      '-e',
      'OPENCODE_CONFIG_CONTENT=DENY',
      '-e',
      'PROJECT_OWNER=custom-owner',
      '-e',
      'PROJECT_NUMBER=99',
      '-w',
      '/home/agent/repo',
      'cycledesign-issue-1',
      'opencode',
      'run',
    ]);
  });

  it('fails fast with github-scope when the token provably lacks project scope', () => {
    process.env['PROJECT_OWNER'] = 'no-such-owner-xyz';
    clearTokenScopeCache();
    try {
      const scope = checkGithubTokenScope('dummy-token-xyz');
      assert.equal(scope.ok, false);
      assert.match(scope.output, /project/);
      clearTokenScopeCache();
      const provisioned = provisionSandbox('sbx-missing-bin', 'cycledesign-issue-1', 'D:\\work', 'C:\\auth.json', 'cycledesign-worker', {
        repoSlug: 'ssotangkur/cycledesign',
        githubToken: 'dummy-token-xyz',
      });
      assert.equal(provisioned.ok, false);
      assert.equal(provisioned.step, 'github-scope');
      assert.match(provisioned.output, /project/);
    } finally {
      delete process.env['PROJECT_OWNER'];
      clearTokenScopeCache();
    }
  });
});

describe('fail-closed destroy (#149 KD-5)', () => {
  it('returns ok:false with output when the binary is missing', () => {
    const destroyed = destroySandbox('sbx-missing-bin', 'cycledesign-issue-1');
    assert.equal(destroyed.ok, false);
    assert.match(destroyed.output, /stop:/);
    assert.match(destroyed.output, /rm:/);
  });

  it('never throws', () => {
    assert.doesNotThrow(() => destroySandbox('sbx-missing-bin', 'cycledesign-issue-1'));
  });
});

describe('VM liveness collectors (#149 KD-4)', () => {
  it('keeps the VM log path stable (Spike 0 join)', () => {
    assert.equal(VM_OPENCODE_LOG, '/home/agent/.local/share/opencode/log/opencode.log');
    assert.equal(VM_COLLECTOR_TIMEOUT_MS, 10_000);
    assert.equal(VM_LOG_TAIL_BYTES, 64 * 1024);
  });

  it('tails the VM log with a byte cap', () => {
    assert.deepEqual(vmLogTailArgs('cycledesign-issue-1'), [
      'exec',
      'cycledesign-issue-1',
      'tail',
      '-c',
      String(VM_LOG_TAIL_BYTES),
      VM_OPENCODE_LOG,
    ]);
  });

  it('reads the VM log mtime for pre-first-line recency', () => {
    assert.deepEqual(vmLogMtimeArgs('cycledesign-issue-1'), ['exec', 'cycledesign-issue-1', 'stat', '-c', '%Y', VM_OPENCODE_LOG]);
  });

  it('reads VM VCS tip time and worktree status from the in-VM clone', () => {
    assert.deepEqual(vmVcsLogArgs('cycledesign-issue-1'), ['exec', 'cycledesign-issue-1', 'git', '-C', SANDBOX_REPO_DIR, 'log', '-1', '--format=%ct']);
    assert.deepEqual(vmVcsStatusArgs('cycledesign-issue-1'), ['exec', 'cycledesign-issue-1', 'git', '-C', SANDBOX_REPO_DIR, 'status', '--porcelain']);
  });

  it('lists in-VM sessions as JSON (local DB read, no quota)', () => {
    assert.deepEqual(vmSessionListArgs('cycledesign-issue-1'), ['exec', 'cycledesign-issue-1', 'opencode', 'session', 'list', '--format', 'json']);
  });
});
