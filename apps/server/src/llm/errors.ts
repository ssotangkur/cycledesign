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

// Distinct subclass for free-tier daily/quota exhaustion on free providers
// (Zen Free today; precursor to a future multi-gateway fallback chain that
// will catch this subclass distinctly while existing `instanceof
// RateLimitError` checks keep working). Message wording should name the
// provider, note unpublished per-model daily limits, and suggest retry/reset.
export class FreeUsageLimitError extends RateLimitError {
  constructor(message: string, retryAfterMs: number = 60000) {
    super(message, retryAfterMs);
    this.name = 'FreeUsageLimitError';
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
