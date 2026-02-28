import { describe, it, expect } from 'vitest';
import { RateLimitError, AuthError, ProviderError } from './errors.js';

describe('Custom Errors', () => {
  describe('RateLimitError', () => {
    it('should create with default retryAfterMs', () => {
      const error = new RateLimitError('Rate limited');
      expect(error.name).toBe('RateLimitError');
      expect(error.message).toBe('Rate limited');
      expect(error.retryAfterMs).toBe(60000);
    });

    it('should create with custom retryAfterMs', () => {
      const error = new RateLimitError('Rate limited', 30000);
      expect(error.retryAfterMs).toBe(30000);
    });
  });

  describe('AuthError', () => {
    it('should create with message', () => {
      const error = new AuthError('Auth failed');
      expect(error.name).toBe('AuthError');
      expect(error.message).toBe('Auth failed');
    });
  });

  describe('ProviderError', () => {
    it('should create with optional status', () => {
      const error = new ProviderError('Provider error', 500);
      expect(error.name).toBe('ProviderError');
      expect(error.message).toBe('Provider error');
      expect(error.status).toBe(500);
    });

    it('should create with retryAfterMs', () => {
      const error = new ProviderError('Rate limited', 429, 5000);
      expect(error.retryAfterMs).toBe(5000);
    });
  });
});
