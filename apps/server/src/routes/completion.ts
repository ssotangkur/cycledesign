import { Router } from 'express';
import { addMessage, generateMessageId } from '../sessions/storage.js';
import { ModelMessage } from 'ai';
import { getLLMProvider } from '../llm/providers/provider-factory.js';

export const completionRouter = Router();

completionRouter.post('/', async (req, res): Promise<void> => {
  try {
    const { messages, sessionId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing required field: messages' });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const result = await getLLMProvider().complete(messages as ModelMessage[], {
        stream: false,
        maxRetries: 3,
      });

      clearTimeout(timeoutId);

      if (sessionId) {
        const assistantMessage = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: result.content || null,
          timestamp: Date.now(),
          toolCalls: result.toolCalls ? result.toolCalls.map((tc: { id: string; name: string; args: Record<string, unknown> }) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })) : undefined,
          tokenCount: result.usage?.totalTokens,
        };
        await addMessage(sessionId, assistantMessage);
      }

      res.setHeader('X-RateLimit-Remaining', '1');
      res.json({
        content: result.content,
        toolCalls: result.toolCalls,
        usage: result.usage,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if ((error as { name?: string }).name === 'AbortError') {
        res.status(408).json({ error: 'Request timeout' });
        return;
      }

      if ((error as { name?: string }).name === 'RateLimitError') {
        const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
        res.setHeader('Retry-After', (retryAfter ? retryAfter / 1000 : 60).toString());
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }

      if ((error as { name?: string }).name === 'AuthError') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      throw error;
    }
  } catch (error: unknown) {
    console.error('Completion error:', error);
    res.status(500).json({ error: (error as Error).message || 'Completion failed' });
  }
});

completionRouter.post('/stream', async (req, res): Promise<void> => {
  try {
    const { messages, sessionId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing required field: messages' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    let fullContent = '';

    try {
      const result = await getLLMProvider().complete(messages as ModelMessage[], {
        stream: true,
        maxRetries: 3,
      }) as { stream: AsyncIterable<string> };

      if (!result.stream) {
        throw new Error('Stream not available');
      }

      for await (const chunk of result.stream) {
        if (controller.signal.aborted) {
          break;
        }
        fullContent += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }

      clearTimeout(timeoutId);

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();

      if (sessionId && fullContent) {
        const assistantMessage = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: fullContent,
          timestamp: Date.now(),
        };
        await addMessage(sessionId, assistantMessage).catch(console.error);
      }
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if ((error as { name?: string }).name === 'AbortError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Request timeout' })}\n\n`);
        res.end();
        return;
      }

      if ((error as { name?: string }).name === 'RateLimitError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Rate limit exceeded' })}\n\n`);
        res.end();
        return;
      }

      if ((error as { name?: string }).name === 'AuthError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Authentication required' })}\n\n`);
        res.end();
        return;
      }

      console.error('Stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
      res.end();
    }
  } catch (error: unknown) {
    console.error('Stream setup error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: (error as Error).message || 'Stream setup failed' });
    }
  }
});
