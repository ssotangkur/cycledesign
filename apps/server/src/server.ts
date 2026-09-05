import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { previewRouter } from './routes/preview.js';
import { sseRouter } from './routes/sse.js';
import { previewManager } from './preview/preview-manager.js';

import https from 'https';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { appRouter } from './trpc/trpc.js';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { ProtocolServer } from '@cycledesign/common-protocol';
import { statusBroadcaster } from './features/status/StatusBroadcaster.js';
import { MessageHandler } from './features/chat/MessageHandler.js';

dotenv.config();

// Global fetch override to disable SSL verification for Qwen and Mistral APIs
const originalFetch = global.fetch;
global.fetch = ((url: string | URL, options: RequestInit) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname.includes('qwen.ai') || parsedUrl.hostname.includes('aliyuncs.com') || parsedUrl.hostname.includes('mistral.ai')) {
    const agent = new https.Agent({ rejectUnauthorized: false });
    (options as RequestInit & { agent?: https.Agent }).agent = agent;
  }
  return originalFetch(url, options);
}) as typeof global.fetch;

const app = express();
const PORT = process.env.PORT || 3001;

// Bootstrap workspace and auto-start preview server
const WORKSPACE_DIR = join(process.cwd(), '../../workspace');
const DESIGNS_DIR = join(WORKSPACE_DIR, 'designs');

// Create workspace directories
if (!existsSync(WORKSPACE_DIR)) {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  console.log('[BOOTSTRAP] Created workspace directory:', WORKSPACE_DIR);
}

if (!existsSync(DESIGNS_DIR)) {
  mkdirSync(DESIGNS_DIR, { recursive: true });
  console.log('[BOOTSTRAP] Created designs directory:', DESIGNS_DIR);
}

// Create a placeholder app.tsx if it doesn't exist
const appTsXPath = join(DESIGNS_DIR, 'app.tsx');
const templatePath = join(process.cwd(), 'resources/templates/app.tsx');
if (!existsSync(appTsXPath) && existsSync(templatePath)) {
  copyFileSync(templatePath, appTsXPath);
  console.log('[BOOTSTRAP] Created placeholder app.tsx from template');
}

// Auto-start preview server
(async () => {
  try {
    console.log('[BOOTSTRAP] Starting preview server...');
    await previewManager.start();
    const status = previewManager.getStatus();
    console.log('[BOOTSTRAP] Preview server started successfully on port', status.port);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[BOOTSTRAP] Failed to start preview server:', errorMessage);
  }
})();

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Create ProtocolServer for channel-based transport
const protocolServer = new ProtocolServer({ server });

// Register status channel handler
protocolServer.onChannelSubscribe('status', (channel) => {
  // Subscribe to status events and forward to this channel
  const unsubscribe = statusBroadcaster.subscribe((status) => {
    channel.send(status.event, status.data);
  });

  return {
    handlers: {},  // No client events for status channel
    unsubscribe
  };
});

// Create MessageHandler for LLM streaming
const messageHandler = new MessageHandler();

// Register chat channel handler
protocolServer.onChannelSubscribe('chat', (channel) => {
  console.log('[ProtocolServer] Chat channel subscribed:', channel.id);
  
  // Send history on subscribe
  const history = messageHandler.getHistory();
  console.log('[ProtocolServer] Sending history with', history.length, 'messages');
  channel.send('history', { messages: history });

  // Subscribe to new messages and broadcast to this channel
  const unsubscribe = messageHandler.onMessage((msg) => {
    console.log('[ProtocolServer] MessageHandler notified, userId:', msg.userId, 'channel.id:', channel.id);
    // Don't echo back to sender
    if (msg.userId !== channel.id) {
      console.log('[ProtocolServer] Broadcasting message to channel:', channel.id, 'content:', msg.content.substring(0, 50));
      channel.send('message', msg);
    } else {
      console.log('[ProtocolServer] Skipping broadcast - message is from this channel');
    }
  });

  // Use MessageHandler for processing user messages
  const handlers = messageHandler.createChatChannelHandler(channel);

  return {
    handlers,
    unsubscribe
  };
});

// Export protocolServer for use in other modules
export { protocolServer };

// Graceful shutdown handlers
function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  // Close the protocol layer (unsubscribes channels, closes WS server) and
  // stop the spawned preview child first, so server.close() isn't held open
  // by lingering connections and the vite child isn't orphaned on port 3002.
  // Sequenced: process.exit only runs after the closes settle (or timeout).
  const forceExit = setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);

  void (async () => {
    try {
      await protocolServer.close();
      console.log('Protocol server closed');
    } catch (error) {
      console.error('Error closing protocol server:', (error as Error).message);
    }
    try {
      await previewManager.stop();
      console.log('Preview server stopped');
    } catch (error) {
      console.error('Error stopping preview server:', (error as Error).message);
    }
    server.close(() => {
      console.log('HTTP server closed');
      clearTimeout(forceExit);
      process.exit(0);
    });
  })();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3003', 'http://127.0.0.1:3000', 'http://127.0.0.1:3003'],
  credentials: true,
}));

app.use(express.json());

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const rateLimiter = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const ip = _req.ip || _req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 100;

  let record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + windowMs };
    rateLimitStore.set(ip, record);
  }

  record.count++;

  if (record.count > maxRequests) {
    res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  res.setHeader('X-RateLimit-Limit', maxRequests.toString());
  res.setHeader('X-RateLimit-Remaining', (maxRequests - record.count).toString());
  res.setHeader('X-RateLimit-Reset', record.resetTime.toString());

  next();
};

app.use('/api', rateLimiter);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/preview', previewRouter);
app.use('/api/preview/logs', sseRouter);

// tRPC middleware
app.use('/trpc', createExpressMiddleware({ router: appRouter }));

export default app;
// change 3

