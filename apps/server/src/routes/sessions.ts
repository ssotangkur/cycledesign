import { Router } from 'express';
import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
  getMessages,
  addMessage,
  deleteMessage,
  generateMessageId,
} from '../sessions/storage';

export const sessionsRouter = Router();

sessionsRouter.get('/', async (_req, res): Promise<void> => {
  try {
    const sessions = await listSessions();
    res.json(sessions);
  } catch {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

sessionsRouter.post('/', async (req, res): Promise<void> => {
  try {
    const { name } = req.body;
    const session = await createSession(name);
    res.status(201).json(session);
  } catch {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

sessionsRouter.get('/:id', async (req, res): Promise<void> => {
  try {
    const session = await getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch {
    res.status(500).json({ error: 'Failed to get session' });
  }
});

sessionsRouter.get('/:id/messages', async (req, res): Promise<void> => {
  try {
    const messages = await getMessages(req.params.id);
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

sessionsRouter.post('/:id/messages', async (req, res): Promise<void> => {
  try {
    const { role, content, toolCalls, toolCallId, tokenCount } = req.body;
    
    if (!role || content === undefined) {
      res.status(400).json({ error: 'Missing required fields: role, content' });
      return;
    }
    
    const message = {
      id: generateMessageId(),
      role,
      content: content || null,
      timestamp: Date.now(),
      toolCalls,
      toolCallId,
      tokenCount,
    };
    
    await addMessage(req.params.id, message);
    res.status(201).json({ success: true, message });
  } catch {
    res.status(500).json({ error: 'Failed to add message' });
  }
});

sessionsRouter.delete('/:id', async (req, res): Promise<void> => {
  try {
    const deleted = await deleteSession(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

sessionsRouter.delete('/:id/messages/:msgId', async (req, res): Promise<void> => {
  try {
    const deleted = await deleteMessage(req.params.id, req.params.msgId);
    if (!deleted) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});
