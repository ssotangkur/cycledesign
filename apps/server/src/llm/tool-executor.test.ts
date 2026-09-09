import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MockProvider } from './providers/mock.js';
import { executeToolCalls } from './tool-executor.js';
import { getPendingWork, clearPendingWork } from './work-tracker.js';
import { allTools } from './tools/tools.js';
import { ValidationService } from '../validation/validation-service.js';

function toExecutorCalls(
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>
) {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.args),
    },
  }));
}

describe('tool-executor side effects (issue #138)', () => {
  let workspaceDir: string;
  let prevWorkspaceDir: string | undefined;

  beforeEach(async () => {
    prevWorkspaceDir = process.env.WORKSPACE_DIR;
    workspaceDir = await fs.mkdtemp(join(tmpdir(), 'cycledesign-138-'));
    process.env.WORKSPACE_DIR = workspaceDir;
  });

  afterEach(async () => {
    clearPendingWork('msg-1');
    clearPendingWork('msg-edit');
    clearPendingWork('msg-hyphen');
    clearPendingWork('msg-submit');
    if (prevWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = prevWorkspaceDir;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('drives mock create_file through the real executor with disk + tracker side effects', async () => {
    const provider = new MockProvider();
    const response = await provider.complete(
      [{ role: 'user', content: 'create file hello world' }],
      { tools: allTools }
    );
    expect(response.toolCalls).toHaveLength(1);

    const results = await executeToolCalls(toExecutorCalls(response.toolCalls), 'msg-1');
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    const expectedCode = 'export default function Test() { return <div>Hello</div>; }';
    const onDisk = await fs.readFile(join(workspaceDir, 'designs', 'test.tsx'), 'utf-8');
    expect(onDisk).toBe(expectedCode);

    const pending = getPendingWork('msg-1');
    expect(pending?.files.has('test.tsx')).toBe(true);
    expect(pending?.files.get('test.tsx')?.code).toBe(expectedCode);

    const result = results[0].result as { bytes?: number; path?: string };
    expect(typeof result.bytes).toBe('number');
    expect(result.bytes).toBe(Buffer.byteLength(expectedCode, 'utf-8'));
  });

  it('drives mock edit_file through the real executor with patched bytes', async () => {
    const provider = new MockProvider();
    const createResponse = await provider.complete(
      [{ role: 'user', content: 'create file hello world' }],
      { tools: allTools }
    );
    await executeToolCalls(toExecutorCalls(createResponse.toolCalls), 'msg-edit');

    const editResponse = await provider.complete(
      [{ role: 'user', content: 'please edit this file' }],
      { tools: allTools }
    );
    expect(editResponse.toolCalls).toHaveLength(1);
    expect(editResponse.toolCalls[0].name).toBe('edit_file');
    expect(editResponse.toolCalls[0].args).toHaveProperty('patch');

    const results = await executeToolCalls(toExecutorCalls(editResponse.toolCalls), 'msg-edit');
    expect(results[0].success).toBe(true);

    const onDisk = await fs.readFile(join(workspaceDir, 'designs', 'test.tsx'), 'utf-8');
    expect(onDisk).toContain('Updated');
  });

  it('normalizes hyphenated tool names (create-file -> create_file)', async () => {
    const results = await executeToolCalls(
      [
        {
          id: 'tc-hyphen',
          type: 'function',
          function: {
            name: 'create-file',
            arguments: JSON.stringify({
              filename: 'test.tsx',
              code: 'export default function Test() { return <div>Hello</div>; }',
            }),
          },
        },
      ],
      'msg-hyphen'
    );
    expect(results[0].success).toBe(true);
    const onDisk = await fs.readFile(join(workspaceDir, 'designs', 'test.tsx'), 'utf-8');
    expect(onDisk).toContain('Hello');
  });

  it('runs validation at most once per submit_work flow (issue #138, KD-6)', async () => {
    const spy = vi
      .spyOn(ValidationService.prototype, 'validateAndPreparePreview')
      .mockResolvedValue({ success: true });

    const results = await executeToolCalls(
      [
        {
          id: 'tc-submit',
          type: 'function',
          function: { name: 'submit_work', arguments: JSON.stringify({}) },
        },
      ],
      'msg-submit'
    );
    expect(results[0].success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('msg-submit');
  });
});
