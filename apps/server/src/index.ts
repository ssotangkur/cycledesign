import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sessionsRouter } from './routes/sessions';
import { completionRouter } from './routes/completion';
import https from 'https';
import { WebSocketHandler } from './ws';

dotenv.config();

// Global fetch override to disable SSL verification for Qwen API
const originalFetch = global.fetch;
global.fetch = ((url: string | URL, options: RequestInit) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname.includes('qwen.ai') || parsedUrl.hostname.includes('aliyuncs.com')) {
    const agent = new https.Agent({ rejectUnauthorized: false });
    (options as RequestInit & { agent?: https.Agent }).agent = agent;
  }
  return originalFetch(url, options);
}) as typeof global.fetch;

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

new WebSocketHandler(server);

app.use(cors({
  origin: FRONTEND_URL,
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

export default app;
