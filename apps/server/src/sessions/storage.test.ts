import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredMessage } from '../llm/types.js';

let tmpDir: string;
let cwdSpy: { mockRestore: () => void };
let storage: typeof import('./storage.js');

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'cycledesign-storage-test-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  vi.resetModules();
  storage = await import('./storage.js');
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function userMessage(text: string): StoredMessage {
  return { id: `msg-${text}`, timestamp: Date.now(), modelMessage: { role: 'user', content: text } };
}

describe('storage with modelMessage-only StoredMessage', () => {
  it('should round-trip messages and resolve first user message', async () => {
    const session = await storage.createSession('test');
    await storage.addMessage(session.id, {
      id: 'msg-sys',
      timestamp: Date.now(),
      modelMessage: { role: 'system', content: 'system prompt' },
    });
    await storage.addMessage(session.id, userMessage('hello world'));

    const messages = await storage.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].modelMessage.role).toBe('system');
    expect(messages[1].modelMessage.role).toBe('user');

    const meta = await storage.getSession(session.id);
    expect(meta?.firstMessage).toBe('hello world');
  });

  it('should skip system messages when resolving first user message', async () => {
    const session = await storage.createSession('test');
    await storage.addMessage(session.id, {
      id: 'msg-sys',
      timestamp: Date.now(),
      modelMessage: { role: 'system', content: 'system prompt' },
    });

    const meta = await storage.getSession(session.id);
    expect(meta?.firstMessage).toBeNull();
  });

  it('should return null first message for empty sessions', async () => {
    const session = await storage.createSession('test');
    expect(await storage.getMessages(session.id)).toEqual([]);
    expect((await storage.getSession(session.id))?.firstMessage).toBeNull();
  });

  it('should read legacy JSONL entries without modelMessage', async () => {
    const session = await storage.createSession('test');
    const messagesPath = join(tmpDir, '.cycledesign', 'sessions', session.id, 'messages.jsonl');
    await fs.appendFile(
      messagesPath,
      JSON.stringify({ id: 'msg-legacy', role: 'user', content: 'legacy hello', timestamp: Date.now() }) + '\n',
      'utf-8'
    );

    const meta = await storage.getSession(session.id);
    expect(meta?.firstMessage).toBe('legacy hello');
  });

  it('should skip corrupt JSONL lines instead of losing the session', async () => {
    const session = await storage.createSession('test');
    const messagesPath = join(tmpDir, '.cycledesign', 'sessions', session.id, 'messages.jsonl');
    await fs.appendFile(messagesPath, 'this is not json\n', 'utf-8');
    await storage.addMessage(session.id, userMessage('survivor'));

    const messages = await storage.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect((await storage.getSession(session.id))?.firstMessage).toBe('survivor');
  });

  it('should tolerate valid-JSON wrong-shape lines without throwing', async () => {
    const session = await storage.createSession('test');
    const messagesPath = join(tmpDir, '.cycledesign', 'sessions', session.id, 'messages.jsonl');
    await fs.appendFile(messagesPath, 'null\n123\n"hi"\n', 'utf-8');
    await storage.addMessage(session.id, userMessage('survivor'));

    const messages = await storage.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages.every((m) => m && typeof m === 'object')).toBe(true);
    expect((await storage.getSession(session.id))?.firstMessage).toBe('survivor');
  });

  it('should degrade (not vanish) when messages.jsonl is unreadable', async () => {
    const session = await storage.createSession('test');
    const messagesPath = join(tmpDir, '.cycledesign', 'sessions', session.id, 'messages.jsonl');
    await fs.rm(messagesPath);
    await fs.mkdir(messagesPath); // readFile on a directory fails non-ENOENT on all platforms

    await expect(storage.getMessages(session.id)).rejects.toThrow();
    const meta = await storage.getSession(session.id);
    expect(meta).not.toBeNull();
    expect(meta?.firstMessage).toBeNull();
  });

  it('should return empty results for missing sessions (ENOENT)', async () => {
    expect(await storage.getMessages('nope')).toEqual([]);
    expect(await storage.getSession('nope')).toBeNull();
  });
});
