import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { StoredMessage } from '../llm/types';

const SESSIONS_DIR = join(process.cwd(), '.cycledesign', 'sessions');

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messageCount: number;
  totalTokens: number;
  firstMessage: string | null;
}

export function generateSessionId(): string {
  return `session-${uuidv4()}`;
}

export function generateMessageId(): string {
  return `msg-${uuidv4()}`;
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function createSession(name?: string): Promise<SessionMeta> {
  await ensureSessionsDir();
  
  const id = generateSessionId();
  const sessionDir = join(SESSIONS_DIR, id);
  await fs.mkdir(sessionDir, { recursive: true });
  
  const meta: SessionMeta = {
    id,
    name: name || `Session ${id.slice(-8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: process.env.LLM_PROVIDER || 'qwen',
    model: 'coder-model',
    messageCount: 0,
    totalTokens: 0,
    firstMessage: null,
  };
  
  await fs.writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  await fs.writeFile(join(sessionDir, 'messages.jsonl'), '', 'utf-8');
  
  return meta;
}

async function getFirstUserMessage(sessionId: string): Promise<string | null> {
  try {
    const sessionDir = join(SESSIONS_DIR, sessionId);
    const messagesPath = join(sessionDir, 'messages.jsonl');
    const data = await fs.readFile(messagesPath, 'utf-8');
    
    if (!data.trim()) {
      return null;
    }
    
    const lines = data.trim().split('\n');
    for (const line of lines) {
      const message = JSON.parse(line) as StoredMessage;
      if (message.role === 'user' && message.content) {
        return message.content;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  try {
    const sessionDir = join(SESSIONS_DIR, id);
    const metaPath = join(sessionDir, 'meta.json');
    const data = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(data) as SessionMeta;
    
    meta.firstMessage = await getFirstUserMessage(id);
    
    return meta;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  await ensureSessionsDir();
  
  const sessions: SessionMeta[] = [];
  const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = await getSession(entry.name);
      if (meta) {
        sessions.push(meta);
      }
    }
  }
  
  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    const sessionDir = join(SESSIONS_DIR, id);
    await fs.rm(sessionDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function addMessage(sessionId: string, message: StoredMessage): Promise<void> {
  const sessionDir = join(SESSIONS_DIR, sessionId);
  const messagesPath = join(sessionDir, 'messages.jsonl');
  
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.appendFile(messagesPath, JSON.stringify(message) + '\n', 'utf-8');
  
  const meta = await getSession(sessionId);
  if (meta) {
    meta.messageCount++;
    meta.totalTokens += message.tokenCount || 0;
    meta.updatedAt = new Date().toISOString();
    await fs.writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  try {
    const sessionDir = join(SESSIONS_DIR, sessionId);
    const messagesPath = join(sessionDir, 'messages.jsonl');
    const data = await fs.readFile(messagesPath, 'utf-8');
    
    if (!data.trim()) {
      return [];
    }
    
    return data.trim().split('\n').map(line => JSON.parse(line) as StoredMessage);
  } catch {
    return [];
  }
}

export async function deleteMessage(sessionId: string, messageId: string): Promise<boolean> {
  try {
    const sessionDir = join(SESSIONS_DIR, sessionId);
    const messagesPath = join(sessionDir, 'messages.jsonl');
    const messages = await getMessages(sessionId);
    
    const filtered = messages.filter(m => m.id !== messageId);
    
    if (filtered.length === messages.length) {
      return false;
    }
    
    await fs.writeFile(messagesPath, filtered.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
    
    const meta = await getSession(sessionId);
    if (meta) {
      meta.messageCount = filtered.length;
      meta.updatedAt = new Date().toISOString();
      await fs.writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    }
    
    return true;
  } catch {
    return false;
  }
}
