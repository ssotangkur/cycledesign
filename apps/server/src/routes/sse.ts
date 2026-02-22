import { Router, Request, Response } from 'express';
import { previewManager } from '../preview/preview-manager';
import { LogEntry } from '../preview/types';

export const sseRouter = Router();

sseRouter.get('/logs/stream', async (_req: Request, res: Response): Promise<void> => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.flushHeaders();

  const logs = previewManager.getLogs();
  for (const log of logs) {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  }

  const logHandler = (log: LogEntry) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  previewManager.on('log', logHandler);

  res.on('close', () => {
    previewManager.removeListener('log', logHandler);
  });

  res.on('error', () => {
    previewManager.removeListener('log', logHandler);
  });
});
