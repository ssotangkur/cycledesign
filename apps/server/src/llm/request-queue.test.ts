import { describe, it, expect, beforeEach } from 'vitest';
import { RequestQueue } from './request-queue.js';

describe('RequestQueue', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  it('should execute function and return result', async () => {
    const result = await queue.enqueue(async () => 'test');
    expect(result).toBe('test');
  });

  it('should wait at least 1 second between requests', async () => {
    const start = Date.now();
    
    await queue.enqueue(async () => 'first');
    await queue.enqueue(async () => 'second');
    
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });

  it('should add jitter to request interval', async () => {
    const start = Date.now();
    
    await queue.enqueue(async () => 'first');
    await queue.enqueue(async () => 'second');
    
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3500);
  });

  it('should handle errors from enqueued functions', async () => {
    await expect(queue.enqueue(async () => {
      throw new Error('test error');
    })).rejects.toThrow('test error');
  });
});
