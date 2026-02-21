import { Router } from 'express';
import { QwenProvider } from '../llm/providers/qwen';
import { addMessage, generateMessageId } from '../sessions/storage';
import { CoreMessage } from 'ai';

export const completionRouter = Router();
const qwenProvider = new QwenProvider();

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
      const result = await qwenProvider.complete(messages as CoreMessage[], {
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
          toolCalls: result.toolCalls?.map(tc => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.args),
            },
          })),
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
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        res.status(408).json({ error: 'Request timeout' });
        return;
      }
      
      if (error.name === 'RateLimitError') {
        res.setHeader('Retry-After', (error.retryAfterMs / 1000).toString());
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }
      
      if (error.name === 'AuthError') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      
      throw error;
    }
  } catch (error: any) {
    console.error('Completion error:', error);
    res.status(500).json({ error: error.message || 'Completion failed' });
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
    const usage: any = null;
    
    try {
      const result = await qwenProvider.complete(messages as CoreMessage[], {
        stream: true,
        maxRetries: 3,
      });
      
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
      
      res.write(`data: ${JSON.stringify({ type: 'done', usage })}\n\n`);
      res.end();
      
      if (sessionId && fullContent) {
        const assistantMessage = {
          id: generateMessageId(),
          role: 'assistant' as const,
          content: fullContent,
          timestamp: Date.now(),
          tokenCount: usage?.totalTokens,
        };
        await addMessage(sessionId, assistantMessage).catch(console.error);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Request timeout' })}\n\n`);
        res.end();
        return;
      }
      
      if (error.name === 'RateLimitError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Rate limit exceeded' })}\n\n`);
        res.end();
        return;
      }
      
      if (error.name === 'AuthError') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Authentication required' })}\n\n`);
        res.end();
        return;
      }
      
      console.error('Stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  } catch (error: any) {
    console.error('Stream setup error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Stream setup failed' });
    }
  }
});
