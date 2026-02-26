import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sessionsRouter } from './routes/sessions';
import { completionRouter } from './routes/completion';
import { previewRouter } from './routes/preview';
import { sseRouter } from './routes/sse';

import https from 'https';
import { WebSocketHandler } from './ws';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { appRouter } from './trpc';
import { createExpressMiddleware } from '@trpc/server/adapters/express';

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

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

new WebSocketHandler(server);

// Graceful shutdown handlers
function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
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

app.use('/api/sessions', sessionsRouter);
app.use('/api/complete', completionRouter);
app.use('/api/preview', previewRouter);
app.use('/api/preview/logs', sseRouter);

// tRPC middleware
app.use('/trpc', createExpressMiddleware({ router: appRouter }));

export default app;
// change 3
