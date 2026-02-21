export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number = 60000) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ProviderError extends Error {
  status?: number;
  retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
