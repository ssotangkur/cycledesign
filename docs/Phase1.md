# Phase 1: LLM Provider Integration

## Overview

Phase 1 establishes the foundation for LLM integration without design system enforcement. This phase focuses on:
- Qwen provider integration via Vercel AI SDK
- Basic prompt UI (text input)
- Display LLM responses in UI with streaming
- Session persistence (JSONL format with tool call support)
- No design system, no code generation, no validation

**Success Criteria:**
- User can send text prompts to LLM
- LLM responses display in UI with streaming
- Conversations persist after page refresh
- Session can be resumed with full context (including tool calls)

---

## Technical Decisions (Resolved Open Questions)

### 1. Repository Structure

**Decision:** Single repository with simple folder structure (not full monorepo)

```
cycledesign/
├── apps/
│   ├── web/                    # React frontend
│   └── server/                 # Node.js backend
├── packages/                   # Shared packages (added in later phases)
├── workspace/                  # User's design system and designs
├── .cycledesign/               # App data (sessions, database)
└── package.json                # Root workspace config
```

**Rationale:** Turborepo adds complexity not needed for MVP. Simple npm workspaces sufficient for now.

---

### 1b. Qwen Authentication + Rate Limiting (Native Implementation)

**Decision:** Implement native Qwen authentication handler with OAuth Device Flow, token management, and rate limiting (based on OpenCode-Qwen-Proxy)

**Why:**
- ✅ No external proxy dependency (simpler deployment)
- ✅ Full control over auth token lifecycle
- ✅ Auto-refresh expiring tokens before requests
- ✅ Built-in rate limiting with jitter
- ✅ Unified implementation for all providers
- ✅ Lower latency (no proxy hop)
- ✅ Better observability (metrics, logging in our code)

**Qwen OAuth Authentication Flow (RFC 8628 Device Flow):**
```
1. Generate PKCE verifier + challenge (RFC 7636)
2. Request device authorization → device_code, user_code
3. Open browser for user to authorize at qwen.ai
4. Poll token endpoint with device_code
5. User authorizes → receive access_token, refresh_token
6. Store credentials in ~/.qwen/oauth_creds.json
7. Auto-refresh token 5 min before expiry
8. Retry on 401 (reactive refresh)
```

**Implementation (based on OpenCode-Qwen-Proxy):**
```typescript
// apps/server/src/llm/qwen-auth.ts
import { randomBytes, createHash } from 'node:crypto';
import { EventEmitter } from 'events';

interface QwenCredentials {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  expiryDate: number;
  scope?: string;
}

interface QwenOAuthConfig {
  clientId: string;
  deviceCodeEndpoint: string;
  tokenEndpoint: string;
  scope: string;
  grantType: string;
}

const QWEN_OAUTH_CONFIG: QwenOAuthConfig = {
  clientId: 'qwen-code-cli',
  deviceCodeEndpoint: 'https://auth.qwen.ai/oauth/device/code',
  tokenEndpoint: 'https://auth.qwen.ai/oauth/token',
  scope: 'openid qwen_code',
  grantType: 'urn:ietf:params:oauth:grant-type:device_code',
};

export class QwenAuth extends EventEmitter {
  private credentials: QwenCredentials | null = null;
  private refreshPromise: Promise<QwenCredentials> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private cachedToken: string | null = null;
  private cachedTokenExpiry: number = 0;
  
  // Token cache duration (5 min) - reduces extra refresh requests
  private readonly TOKEN_CACHE_DURATION = 5 * 60 * 1000;
  // Refresh token this ms before expiry (5 min)
  private readonly REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

  /**
   * Generate PKCE code verifier and challenge (RFC 7636)
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getToken(): Promise<string | null> {
    const now = Date.now();

    // Use cached token if still valid
    if (this.cachedToken && now < this.cachedTokenExpiry && 
        now - this.cachedTokenExpiry < this.TOKEN_CACHE_DURATION) {
      return this.cachedToken;
    }

    // Load credentials from storage
    const creds = await this.loadCredentials();
    if (!creds) return null;

    // Check if should refresh (5 min before expiry)
    const shouldRefresh = now > creds.expiryDate - this.REFRESH_BEFORE_EXPIRY_MS;
    
    if (shouldRefresh && creds.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(creds.refreshToken);
        await this.saveCredentials(refreshed);
        this.credentials = refreshed;
        this.cachedToken = refreshed.accessToken;
        this.cachedTokenExpiry = refreshed.expiryDate;
        this.emit('tokenRefreshed', refreshed);
        return refreshed.accessToken;
      } catch (error) {
        this.emit('tokenRefreshError', error);
        return null;
      }
    }

    // Token still valid
    this.credentials = creds;
    this.cachedToken = creds.accessToken;
    this.cachedTokenExpiry = creds.expiryDate;
    return creds.accessToken;
  }

  /**
   * Perform OAuth Device Authorization Flow
   * Opens browser, polls for token
   */
  async performDeviceAuthFlow(): Promise<QwenCredentials> {
    const { verifier, challenge } = this.generatePKCE();

    // Request device authorization
    const deviceAuth = await this.requestDeviceAuthorization(challenge);
    
    // Open browser for user authorization
    this.emit('authorizationRequired', {
      verificationUrl: deviceAuth.verification_uri_complete,
      userCode: deviceAuth.user_code,
    });
    this.openBrowser(deviceAuth.verification_uri_complete);

    // Poll for token
    const tokenResponse = await this.pollForToken(
      deviceAuth.device_code,
      verifier,
      deviceAuth.expires_in * 1000
    );

    const credentials = this.tokenResponseToCredentials(tokenResponse);
    await this.saveCredentials(credentials);
    this.credentials = credentials;
    this.cachedToken = credentials.accessToken;
    this.cachedTokenExpiry = credentials.expiryDate;

    return credentials;
  }

  private async requestDeviceAuthorization(codeChallenge: string): Promise<any> {
    const params = new URLSearchParams({
      client_id: QWEN_OAUTH_CONFIG.clientId,
      scope: QWEN_OAUTH_CONFIG.scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const response = await fetch(QWEN_OAUTH_CONFIG.deviceCodeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Device auth failed: ${response.status}`);
    }

    return response.json();
  }

  private async pollForToken(
    deviceCode: string,
    codeVerifier: string,
    timeoutMs: number
  ): Promise<any> {
    const startTime = Date.now();
    let interval = 5000; // Start with 5 second polling

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, interval));

      const params = new URLSearchParams({
        grant_type: QWEN_OAUTH_CONFIG.grantType,
        client_id: QWEN_OAUTH_CONFIG.clientId,
        device_code: deviceCode,
        code_verifier: codeVerifier,
      });

      const response = await fetch(QWEN_OAUTH_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params,
      });

      if (!response.ok) {
        const errorData = await response.text();
        try {
          const error = JSON.parse(errorData);
          
          // authorization_pending: user hasn't authorized yet
          if (error.error === 'authorization_pending') {
            continue;
          }
          
          // slow_down: increase polling interval
          if (error.error === 'slow_down') {
            interval = Math.min(interval + 5000, 15000);
            continue;
          }
        } catch {
          // Non-JSON error
        }
        
        throw new Error(`Token poll failed: ${response.status}`);
      }

      return response.json();
    }

    throw new Error('Device authorization timeout');
  }

  private async refreshAccessToken(refreshToken: string): Promise<QwenCredentials> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: QWEN_OAUTH_CONFIG.clientId,
    });

    const response = await fetch(QWEN_OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    return this.tokenResponseToCredentials(data);
  }

  private tokenResponseToCredentials(tokenResponse: any): QwenCredentials {
    return {
      accessToken: tokenResponse.access_token,
      tokenType: tokenResponse.token_type || 'Bearer',
      refreshToken: tokenResponse.refresh_token,
      expiryDate: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope,
    };
  }

  private async loadCredentials(): Promise<QwenCredentials | null> {
    // Load from ~/.qwen/oauth_creds.json or similar
    // Implementation depends on storage choice
    return this.credentials;
  }

  private async saveCredentials(creds: QwenCredentials): Promise<void> {
    // Save to ~/.qwen/oauth_creds.json or similar
    this.credentials = creds;
  }

  private openBrowser(url: string): void {
    // Platform-specific browser opening
    const { spawn } = await import('node:child_process');
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' 
      : platform === 'win32' ? 'rundll32' 
      : 'xdg-open';
    const args = platform === 'win32' 
      ? ['url.dll,FileProtocolHandler', url] 
      : [url];
    spawn(command, args, { stdio: 'ignore', detached: true });
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }
}
```

**Request Queue with Jitter (from OpenCode-Qwen-Proxy):**
```typescript
// apps/server/src/llm/request-queue.ts
export class RequestQueue {
  private lastRequestTime = 0;
  private readonly MIN_INTERVAL = 1000;      // 1 second base
  private readonly JITTER_MIN = 500;         // 0.5s
  private readonly JITTER_MAX = 1500;        // 1.5s

  private getJitter(): number {
    return Math.random() * (this.JITTER_MAX - this.JITTER_MIN) + this.JITTER_MIN;
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const elapsed = Date.now() - this.lastRequestTime;
    const baseWait = Math.max(0, this.MIN_INTERVAL - elapsed);
    const jitter = this.getJitter();
    const waitTime = baseWait + jitter;

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    return fn();
  }
}

export const requestQueue = new RequestQueue();
```

**Qwen Provider with Auth + Request Queue + 429 Handling:**
```typescript
// apps/server/src/llm/providers/qwen.ts
import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QwenAuth } from '../qwen-auth';
import { requestQueue } from '../request-queue';

const QWEN_CODE_VERSION = '0.10.3';

const qwenAuth = new QwenAuth();

export class QwenProvider {
  private model: any = null;
  private modelPromise: Promise<any> | null = null;

  /**
   * Get or create model instance with valid auth token
   */
  private async getModel(): Promise<any> {
    if (this.model) return this.model;

    if (this.modelPromise) return this.modelPromise;

    this.modelPromise = (async () => {
      const token = await qwenAuth.getToken();
      
      if (!token) {
        // Trigger OAuth flow if no token
        await qwenAuth.performDeviceAuthFlow();
        return this.getModel();
      }
      
      const openai = createOpenAI({
        apiKey: token,
        baseURL: 'https://portal.qwen.ai/v1',
      });
      
      this.model = openai('coder-model');  // or 'vision-model'
      this.modelPromise = null;
      return this.model;
    })();

    return this.modelPromise;
  }

  /**
   * Complete with request queue, auth refresh, and 429 handling
   */
  async complete(messages: CoreMessage[], options?: { stream?: boolean; maxRetries?: number }) {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Use request queue for throttling + jitter
        return await requestQueue.enqueue(async () => {
          const model = await this.getModel();
          const userAgent = `QwenCode/${QWEN_CODE_VERSION} (${process.platform}; ${process.arch})`;

          if (options?.stream) {
            const result = await streamText({
              model,
              messages,
              temperature: 0.7,
              maxTokens: 2048,
              // Custom fetch with Qwen-specific headers
              fetch: async (url, init) => {
                const headers = new Headers(init?.headers);
                headers.set('User-Agent', userAgent);
                headers.set('X-DashScope-CacheControl', 'enable');
                headers.set('X-DashScope-UserAgent', userAgent);
                headers.set('X-DashScope-AuthType', 'qwen-oauth');
                
                const response = await fetch(url as string, { ...init, headers });
                
                // Handle 429 with Retry-After
                if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After') || '60';
                  await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
                  return fetch(url as string, { ...init, headers });
                }
                
                return response;
              },
            });
            return { stream: result.textStream };
          } else {
            const result = await generateText({
              model,
              messages,
              temperature: 0.7,
              maxTokens: 2048,
              // Custom fetch with Qwen-specific headers
              fetch: async (url, init) => {
                const headers = new Headers(init?.headers);
                headers.set('User-Agent', userAgent);
                headers.set('X-DashScope-CacheControl', 'enable');
                headers.set('X-DashScope-UserAgent', userAgent);
                headers.set('X-DashScope-AuthType', 'qwen-oauth');
                
                const response = await fetch(url as string, { ...init, headers });
                
                // Handle 429 with Retry-After
                if (response.status === 429) {
                  const retryAfter = response.headers.get('Retry-After') || '60';
                  await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000));
                  return fetch(url as string, { ...init, headers });
                }
                
                return response;
              },
            });
            return {
              content: result.text,
              toolCalls: result.toolCalls,
              usage: result.usage,
            };
          }
        });
      } catch (error: any) {
        lastError = error;

        // Handle 401 - token expired, force refresh and retry
        if (error.status === 401 || error.message?.includes('401')) {
          await qwenAuth.performDeviceAuthFlow();
          continue;
        }

        // Handle 429 - rate limited (should be handled in fetch, but fallback here)
        if (error.status === 429) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        // Other errors - retry with backoff
        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}
```

**Benefits:**
- ✅ **No external proxy** - Everything runs in our backend
- ✅ **OAuth Device Flow** - RFC 8628 compliant (same as qwen-code CLI)
- ✅ **PKCE support** - RFC 7636 code challenge
- ✅ **Automatic token refresh** - 5 min before expiry (proactive)
- ✅ **Auth error recovery** - On 401, trigger device flow (reactive)
- ✅ **Request throttling** - 1s + 0.5-1.5s jitter (avoids 60/min limit)
- ✅ **429 auto-retry** - Respects Retry-After header
- ✅ **Header alignment** - Matches qwen-code CLI headers exactly
- ✅ **Credential sharing** - Uses `~/.qwen/oauth_creds.json` (same as qwen-code)
- ✅ **Provider agnostic** - Same pattern for Anthropic, OpenAI, etc.
- ✅ **Observable** - Events for token refresh, errors, rate limits

**Available Models (OAuth only supports 2):**
| Model | Context | Max Output | Description |
|-------|---------|------------|-------------|
| `coder-model` | 1M tokens | 64K tokens | Code model (Qwen 3.5 Plus, default) |
| `vision-model` | 128K tokens | 32K tokens | Vision model (image support) |

**Usage Limits (OAuth):**
- Rate: 60 requests/minute
- Daily: 1000 requests/day (resets at 0:00 Beijing Time)
- Free tier (no credit card required)

**Implementation:**
```typescript
// apps/server/src/llm/rate-limiter.ts
import { TokenBucket } from './token-bucket';

interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  retryBaseDelay: number;      // ms, e.g., 1000
  retryMaxDelay: number;       // ms, e.g., 30000
  jitterFactor: number;        // 0-1, e.g., 0.5 for ±50% jitter
}

export class RateLimiter {
  private bucket: TokenBucket;
  private config: RateLimitConfig;
  private recentErrors: Map<string, number> = new Map(); // provider -> error count

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.bucket = new TokenBucket(config.tokensPerMinute);
  }

  async acquire(provider: string, tokens: number): Promise<void> {
    const canProceed = await this.bucket.consume(tokens);
    
    if (!canProceed) {
      const waitTime = this.calculateBackoff(provider);
      throw new RateLimitError(`Rate limit exceeded. Retry in ${waitTime}ms`, waitTime);
    }
  }

  private calculateBackoff(provider: string): number {
    const errorCount = this.recentErrors.get(provider) || 0;
    const baseDelay = this.config.retryBaseDelay * Math.pow(2, errorCount);
    const cappedDelay = Math.min(baseDelay, this.config.retryMaxDelay);
    
    // Add jitter: delay ± (jitterFactor * delay)
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    
    return Math.max(0, cappedDelay + jitter);
  }

  recordSuccess(provider: string): void {
    this.recentErrors.set(provider, Math.max(0, (this.recentErrors.get(provider) || 0) - 1));
  }

  recordError(provider: string): void {
    this.recentErrors.set(provider, (this.recentErrors.get(provider) || 0) + 1);
  }
}

// apps/server/src/llm/token-bucket.ts
export class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;

  constructor(tokensPerMinute: number) {
    this.maxTokens = tokensPerMinute;
    this.tokens = tokensPerMinute;
    this.refillRate = tokensPerMinute / 60000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + (elapsed * this.refillRate));
    this.lastRefill = now;
  }

  async consume(tokens: number): Promise<boolean> {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  getTimeUntilAvailable(tokens: number): number {
    this.refill();
    if (this.tokens >= tokens) return 0;
    
    const needed = tokens - this.tokens;
    return Math.ceil(needed / this.refillRate);
  }
}

// apps/server/src/llm/errors.ts
export class RateLimitError extends Error {
  constructor(message: string, public retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}
```

**Provider Integration with Rate Limiting:**
```typescript
// apps/server/src/llm/providers/qwen.ts
import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { RateLimiter } from '../rate-limiter';
import { RateLimitError } from '../errors';

const rateLimiter = new RateLimiter({
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  retryBaseDelay: 1000,
  retryMaxDelay: 30000,
  jitterFactor: 0.5,
});

export class QwenProvider {
  private model: ReturnType<ReturnType<typeof createOpenAI>>;

  constructor() {
    const openai = createOpenAI({
      apiKey: process.env.QWEN_API_KEY,
      baseURL: process.env.QWEN_PROXY_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.model = openai('qwen-plus');
  }

  async complete(messages: CoreMessage[], options?: { stream?: boolean; maxRetries?: number }) {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Estimate tokens (rough: 4 chars ≈ 1 token)
        const estimatedTokens = messages.reduce(
          (sum, m) => sum + (m.content?.length || 0) / 4,
          0
        );

        // Acquire rate limit tokens
        await rateLimiter.acquire('qwen', Math.ceil(estimatedTokens));

        if (options?.stream) {
          const result = await streamText({
            model: this.model,
            messages,
            temperature: 0.7,
            maxTokens: 2048,
          });
          rateLimiter.recordSuccess('qwen');
          return { stream: result.textStream };
        } else {
          const result = await generateText({
            model: this.model,
            messages,
            temperature: 0.7,
            maxTokens: 2048,
          });
          rateLimiter.recordSuccess('qwen');
          return {
            content: result.text,
            toolCalls: result.toolCalls,
            usage: result.usage,
          };
        }
      } catch (error) {
        lastError = error as Error;

        if (error instanceof RateLimitError) {
          // Wait for retry-after time, then retry
          await new Promise(resolve => setTimeout(resolve, error.retryAfterMs));
          rateLimiter.recordError('qwen');
          continue;
        }

        // For other errors (network, API, etc.), use exponential backoff
        if (attempt < maxRetries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          const jitter = backoff * 0.5 * (Math.random() * 2 - 1);
          await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          rateLimiter.recordError('qwen');
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}
```

**Benefits:**
- ✅ No external proxy needed
- ✅ Token bucket algorithm for smooth rate limiting
- ✅ Exponential backoff with jitter (prevents thundering herd)
- ✅ Per-provider error tracking
- ✅ Configurable limits per provider
- ✅ Works with any OpenAI-compatible endpoint

---

### 2. LLM Provider Architecture

**Decision:** Use Vercel AI SDK (`ai` package) for unified multi-provider support

**Why Vercel AI SDK:**
- ✅ TypeScript-first (built for Node/Bun/Next.js)
- ✅ Unified interface for 20+ providers (OpenAI, Anthropic, Google, etc.)
- ✅ Built-in streaming support
- ✅ Tool calling abstraction (normalizes across providers)
- ✅ Caching middleware (experimental, ready for future optimization)
- ✅ Lightweight and actively maintained

**Provider Setup:**
```typescript
// apps/server/src/llm/providers/qwen.ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';

export class QwenProvider {
  private model: ReturnType<ReturnType<typeof createOpenAI>>;

  constructor() {
    const openai = createOpenAI({
      apiKey: process.env.QWEN_API_KEY,
      baseURL: process.env.QWEN_PROXY_URL || 'http://localhost:8080',
    });
    this.model = openai('qwen-plus');
  }

  async complete(messages: CoreMessage[], options?: { stream?: boolean }) {
    if (options?.stream) {
      const result = await streamText({
        model: this.model,
        messages,
        temperature: 0.7,
        maxTokens: 2048,
      });
      return { stream: result.textStream };
    } else {
      const result = await generateText({
        model: this.model,
        messages,
        temperature: 0.7,
        maxTokens: 2048,
      });
      return {
        content: result.text,
        toolCalls: result.toolCalls,
        usage: result.usage,
      };
    }
  }
}
```

**Message Format (OpenAI Standard):**
```typescript
// apps/server/src/llm/types.ts
import { CoreMessage } from 'ai';

export interface StoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  timestamp: number;
  
  // For assistant messages with tool calls
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;  // JSON string
    };
  }>;
  
  // For tool result messages
  toolCallId?: string;
  
  // Optional metadata
  tokenCount?: number;
}

// CoreMessage from AI SDK is used for API calls
export type { CoreMessage };
```

**Configuration:**
- Provider selected via `LLM_PROVIDER` environment variable
- Defaults to `qwen`
- No UI for switching providers in Phase 1
- Easy to add Anthropic, OpenAI, etc. by installing `@ai-sdk/anthropic`, `@ai-sdk/openai`

---

### 3. Session Storage Format

**Decision:** JSONL (JSON Lines) format in `.cycledesign/sessions/` with full tool call support

**Session Structure:**
```
.cycledesign/
└── sessions/
    ├── session-1/
    │   ├── meta.json           # Session metadata
    │   └── messages.jsonl      # Conversation messages
    └── session-2/
        ├── meta.json
        └── messages.jsonl
```

**meta.json Schema:**
```json
{
  "id": "session-1",
  "name": "Landing Page Design",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T14:22:00Z",
  "provider": "qwen",
  "model": "qwen-plus",
  "messageCount": 12,
  "totalTokens": 5420
}
```

**messages.jsonl Format (with Tool Call Support):**
```jsonl
{"id":"msg_001","role":"system","content":"You are a helpful design assistant.","timestamp":1705312200000}
{"id":"msg_002","role":"user","content":"Create a landing page for a SaaS product","timestamp":1705312210000}
{"id":"msg_003","role":"assistant","content":"Here's a landing page structure...","timestamp":1705312215000,"tokenCount":150}
{"id":"msg_004","role":"user","content":"What's the weather in Paris?","timestamp":1705312220000}
{"id":"msg_005","role":"assistant","content":null,"timestamp":1705312225000,"toolCalls":[{"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":"{\"location\":\"Paris, France\"}"}}]}
{"id":"msg_006","role":"tool","toolCallId":"call_abc123","content":"{\"temp\":22,\"condition\":\"sunny\"}","timestamp":1705312226000}
{"id":"msg_007","role":"assistant","content":"The weather in Paris is 22°C and sunny.","timestamp":1705312230000,"tokenCount":200}
```

**Rationale:**
- JSONL allows streaming append (no need to rewrite entire file)
- Human-readable and debuggable
- Easy to parse line-by-line for large conversations
- Git-diff friendly
- **Tool calls preserved** - LLM needs to see both tool call requests AND results to maintain context
- **Cache-ready format** - Can be sent directly to provider API for prompt caching benefits

**Caching Considerations:**
- Provider-side caching is automatic (OpenAI, Qwen) or explicit (Anthropic)
- Caching lives on provider servers, not local files
- Restoring session = resending full conversation history
- Same prefix within TTL (5min-24h) = cache hit (90% cheaper, 80% faster)
- Store full conversation to enable cache prefix reuse

---

### 4. Session Management API

**Decision:** RESTful endpoints for session CRUD operations

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/messages` | Get session messages |
| `POST` | `/api/sessions/:id/messages` | Add message to session |
| `DELETE` | `/api/sessions/:id` | Delete session |

**Request/Response Examples:**

```typescript
// POST /api/sessions
// Request: { name?: string }  // name optional, auto-generated if not provided
// Response: { id: "session-abc", name: "Session 1", createdAt: "..." }

// GET /api/sessions/:id/messages
// Response: [
//   { role: "user", content: "...", timestamp: 1234567890 },
//   { role: "assistant", content: "...", timestamp: 1234567895 }
// ]

// POST /api/sessions/:id/messages
// Request: { role: "user" | "assistant", content: "..." }
// Response: { success: true }
```

---

### 5. Frontend State Management

**Decision:** Native React hooks with Context for shared state

**State Structure:**
```typescript
// apps/web/src/context/SessionContext.tsx
interface SessionState {
  currentSession: Session | null;
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

interface SessionContextType extends SessionState {
  createSession: (name?: string) => Promise<Session>;
  loadSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}
```

**Custom Hook:**
```typescript
// apps/web/src/hooks/useSession.ts
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
```

**Rationale:** Avoid external state management libraries until complexity demands them.

---

### 6. Chat UI Component Structure

**Decision:** Simple chat interface with MUI components

**Component Tree:**
```
<ChatContainer>
  <SessionSelector />          // Dropdown to switch sessions
  <MessageList />              // Scrollable message history
    <MessageItem />            // Individual message (user/assistant)
    <MessageItem />
    ...
  <PromptInput />              // Text input + send button
</ChatContainer>
```

**Key Components:**
- `ChatContainer`: Main layout with flexbox
- `SessionSelector`: MUI Select component for session switching
- `MessageList`: Virtualized list (if needed for performance)
- `MessageItem`: Styled message bubbles (user right, assistant left)
- `PromptInput`: MUI TextField + IconButton for send

**Styling:** MUI `sx` prop for all styling (no CSS files)

---

### 7. Error Handling Strategy

**Decision:** Graceful degradation with user feedback

**Error Types:**
- Network errors (retry with exponential backoff)
- LLM API errors (show error message, allow retry)
- Session storage errors (fallback to in-memory, warn user)

**UI Feedback:**
- Loading states on all async actions
- Toast notifications for errors
- Inline error messages for form validation
- Retry buttons for failed operations

---

## Implementation Checklist

### Backend Setup

- [ ] **1.1** Initialize Node.js project in `apps/server/`
  - [ ] Create `package.json` with dependencies
  - [ ] Configure TypeScript (`tsconfig.json`)
  - [ ] Set up ESLint config
  - [ ] Add nodemon for development

- [ ] **1.2** Create Express server
  - [ ] Basic Express app setup
  - [ ] JSON body parser middleware
  - [ ] CORS configuration for frontend
  - [ ] Health check endpoint (`GET /health`)
  - [ ] Rate limiter middleware (for API endpoints, not LLM calls)

- [ ] **1.3** Implement Qwen OAuth authentication (RFC 8628 Device Flow)
  - [ ] Create `src/llm/qwen-auth.ts` (OAuth Device Flow + PKCE)
  - [ ] Implement PKCE code verifier/challenge generation (RFC 7636)
  - [ ] Implement device authorization request
  - [ ] Implement token polling with `authorization_pending` handling
  - [ ] Implement `slow_down` error handling (increase polling interval)
  - [ ] Implement proactive token refresh (5 min before expiry)
  - [ ] Implement reactive refresh on 401 errors
  - [ ] Implement credential storage (`~/.qwen/oauth_creds.json`)
  - [ ] Add event emissions (authorizationRequired, tokenRefreshed, tokenRefreshError)
  - [ ] Implement browser auto-open for authorization URL
  - [ ] Write unit tests for OAuth flow

- [ ] **1.4** Implement request queue with jitter
  - [ ] Create `src/llm/request-queue.ts` (RequestQueue class)
  - [ ] Implement 1 second base interval + 0.5-1.5s random jitter
  - [ ] Ensure request interval ≥ 1s (avoids 60/min limit)
  - [ ] Write unit tests for request queue timing

- [ ] **1.5** Implement 429 auto-retry handling
  - [ ] Create `src/llm/errors.ts` (custom error classes)
  - [ ] Implement Retry-After header parsing
  - [ ] Implement automatic wait and retry on 429
  - [ ] Add exponential backoff fallback (if no Retry-After header)
  - [ ] Write unit tests for 429 handling

- [ ] **1.6** Implement LLM provider with Vercel AI SDK
  - [ ] Create `src/llm/types.ts` (message types, stored message schema)
  - [ ] Implement `src/llm/providers/qwen.ts` (Qwen provider using AI SDK)
  - [ ] Integrate QwenAuth for automatic token management
  - [ ] Integrate RequestQueue for throttling + jitter
  - [ ] Configure OpenAI-compatible provider with `https://portal.qwen.ai/v1`
  - [ ] Add Qwen-specific headers (User-Agent, X-DashScope-*)
  - [ ] Add streaming support with `streamText()`
  - [ ] Add tool call support (prepare for future phases)
  - [ ] Add retry logic with max retry configuration
  - [ ] Handle 401 (auth error) and 429 (rate limit) responses
  - [ ] Write integration tests for provider

- [ ] **1.6** Implement session storage
  - [ ] Create `.cycledesign/sessions/` directory structure
  - [ ] Implement session metadata management (`meta.json`)
  - [ ] Implement JSONL message storage (`messages.jsonl`)
  - [ ] Add session ID generation utility
  - [ ] Add session cleanup utility (delete old sessions)

- [ ] **1.7** Create session API endpoints
  - [ ] `GET /api/sessions` - List all sessions
  - [ ] `POST /api/sessions` - Create new session
  - [ ] `GET /api/sessions/:id` - Get session details
  - [ ] `GET /api/sessions/:id/messages` - Get messages
  - [ ] `POST /api/sessions/:id/messages` - Add message
  - [ ] `DELETE /api/sessions/:id` - Delete session
  - [ ] `DELETE /api/sessions/:id/messages/:msgId` - Delete specific message

- [ ] **1.8** Implement LLM completion endpoint
  - [ ] `POST /api/complete` - Send prompt, get LLM response (non-streaming)
  - [ ] `POST /api/complete/stream` - Send prompt, stream LLM response (SSE)
  - [ ] Integrate with session storage (auto-save messages including tool calls)
  - [ ] Handle streaming responses with Server-Sent Events (SSE)
  - [ ] Add request timeout and abort handling
  - [ ] Return usage metadata (token counts, cache stats if available)
  - [ ] Return rate limit headers (X-RateLimit-Remaining, X-Retry-After)

- [ ] **1.9** Add environment configuration
  - [ ] Create `.env.example` with required variables
  - [ ] Load env vars with `dotenv`
  - [ ] Validate required env vars on startup

---

### Frontend Setup

- [ ] **2.1** Initialize React project in `apps/web/`
  - [ ] Create `package.json` with dependencies
  - [ ] Configure Vite (`vite.config.ts`)
  - [ ] Set up TypeScript (`tsconfig.json`)
  - [ ] Configure ESLint + Prettier

- [ ] **2.2** Set up MUI
  - [ ] Install MUI dependencies (`@mui/material`, `@mui/icons-material`)
  - [ ] Create MUI theme with custom colors/typography
  - [ ] Add ThemeProvider to app root
  - [ ] Configure CSS baseline

- [ ] **2.3** Create app structure
  - [ ] Set up React Router with routes
  - [ ] Create main layout component
  - [ ] Add navigation header
  - [ ] Create pages directory structure

- [ ] **2.4** Implement session context
  - [ ] Create `SessionContext` with state
  - [ ] Implement `SessionProvider` component
  - [ ] Create `useSession` custom hook
  - [ ] Add API client for backend calls

- [ ] **2.5** Build chat UI components
  - [ ] `ChatContainer` - Main layout
  - [ ] `SessionSelector` - Session switching dropdown
  - [ ] `MessageList` - Message history display
  - [ ] `MessageItem` - Individual message styling
  - [ ] `PromptInput` - Text input with send button

- [ ] **2.6** Implement chat functionality
  - [ ] Send prompt to backend
  - [ ] Display streaming response (handle SSE stream)
  - [ ] Handle LLM response display (including tool calls when added)
  - [ ] Auto-scroll to latest message
  - [ ] Error handling with toast notifications
  - [ ] Show token usage after completion (optional)

- [ ] **2.7** Add session management UI
  - [ ] Session list view
  - [ ] Create new session dialog
  - [ ] Delete session confirmation
  - [ ] Session rename functionality

---

### Integration & Testing

- [ ] **3.1** Configure development environment
  - [ ] Set up root `package.json` with workspaces
  - [ ] Add concurrent dev script (runs frontend + backend)
  - [ ] Configure proxy in Vite for API calls
  - [ ] Add `.env` files for both apps

- [ ] **3.2** Test LLM integration
  - [ ] Verify Qwen authentication flow
  - [ ] Test token refresh (proactive before expiry)
  - [ ] Test 401 error recovery (reactive refresh)
  - [ ] Test rate limiting with backoff + jitter
  - [ ] Test basic prompt/response flow
  - [ ] Test session persistence
  - [ ] Test session restoration

- [ ] **3.3** Test error scenarios
  - [ ] Network failure handling
  - [ ] LLM API error handling
  - [ ] Session storage failure handling
  - [ ] Invalid input validation

- [ ] **3.4** Performance testing
  - [ ] Measure message load time
  - [ ] Test with large conversation history
  - [ ] Verify no memory leaks in long sessions

---

### Documentation & Setup

- [ ] **4.1** Create README for Phase 1
  - [ ] Installation instructions
  - [ ] Environment setup guide
  - [ ] Running development server
  - [ ] Basic usage guide

- [ ] **4.2** Create Qwen API setup guide
  - [ ] Link to DashScope console (https://dashscope.console.aliyun.com/)
  - [ ] API key generation instructions
  - [ ] Rate limit and quota information
  - [ ] Troubleshooting tips

- [ ] **4.3** Add API documentation
  - [ ] Document all endpoints
  - [ ] Include request/response examples
  - [ ] Error code reference

---

## Dependencies

### Backend (`apps/server/package.json`)
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "uuid": "^9.0.0",
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "zod": "^3.22.4",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.7",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.2",
    "tsx": "^4.7.0",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "vitest": "^1.0.0"
  }
}
```

**Key Packages:**
- `ai` - Vercel AI SDK core (unified interface, streaming, tool calling)
- `@ai-sdk/openai` - OpenAI-compatible provider (works with Qwen, OpenAI, etc.)
- `zod` - Schema validation for tool parameters
- `better-sqlite3` - SQLite for session storage (fast, file-based)
- `tsx` - TypeScript execution with watch mode
- `vitest` - Testing framework (for rate limiter, auth tests)

**Why Native Auth + Rate Limiting:**
- ✅ No external proxy dependency (OpenCode-Qwen-Proxy not needed)
- ✅ Qwen token management handled automatically
- ✅ Token refresh before expiry (proactive) + on 401 (reactive)
- ✅ Rate limiting with exponential backoff + jitter
- ✅ Same pattern works for any provider (Anthropic, OpenAI, etc.)
- ✅ Full observability (events, metrics, logging)

### Frontend (`apps/web/package.json`)
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@mui/material": "^5.15.0",
    "@mui/icons-material": "^5.15.0",
    "@emotion/react": "^11.11.1",
    "@emotion/styled": "^11.11.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.6",
    "typescript": "^5.3.0",
    "eslint": "^8.55.0",
    "prettier": "^3.1.0"
  }
}
```

---

## Environment Variables

### Backend (`.env`)
```bash
# LLM Provider
LLM_PROVIDER=qwen

# Qwen OAuth (no API key needed - uses OAuth Device Flow)
# OAuth endpoints (defaults to official Qwen OAuth)
QWEN_OAUTH_DEVICE_ENDPOINT=https://auth.qwen.ai/oauth/device/code
QWEN_OAUTH_TOKEN_ENDPOINT=https://auth.qwen.ai/oauth/token
QWEN_OAUTH_CLIENT_ID=qwen-code-cli

# Qwen API Base URL (OAuth endpoint)
QWEN_BASE_URL=https://portal.qwen.ai/v1

# Server
PORT=3001
NODE_ENV=development
```

### Frontend (`.env`)
```bash
# API
VITE_API_URL=http://localhost:3001

# App
VITE_APP_NAME=CycleDesign
```

**Note:** 
- **No API key required** - Uses OAuth Device Flow (free tier: 1000 requests/day)
- First run will open browser for authorization at qwen.ai
- Credentials stored in `~/.qwen/oauth_creds.json` (shared with qwen-code CLI)
- Token auto-refresh 5 min before expiry
- Request throttling: 1s + 0.5-1.5s jitter (avoids 60/min limit)
- Auto-retry on 429 with Retry-After header

---

## Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Backend setup | 1-2 days |
| Frontend setup | 1-2 days |
| LLM integration | 1 day |
| Session management | 1 day |
| UI components | 2 days |
| Integration testing | 1 day |
| Documentation | 0.5 day |
| **Total** | **7.5-9.5 days** |

---

## Exit Criteria

Phase 1 is complete when:
- [ ] User can create a new session
- [ ] User can send text prompts and see LLM responses
- [ ] Conversations persist after page refresh
- [ ] User can switch between sessions
- [ ] User can delete sessions
- [ ] All error states handled gracefully
- [ ] Documentation complete
- [ ] Code reviewed and merged to main

---

## Notes for Phase 2

Phase 2 will add:
- Session persistence with full conversation history
- Code generation from LLM responses
- Design system mode foundation
- Basic validation (TypeScript compilation)
- ID injection for generated components
- Tool calling for design system operations

---

## Appendix: Prompt Caching Reference

**Provider-Side Caching (Automatic):**

| Provider | Cache Method | Min Tokens | TTL | Cache Hit Savings |
|----------|-------------|-----------|-----|------------------|
| OpenAI | Automatic prefix matching | 1024 | 5-10 min (memory), 24h (extended) | Up to 90% |
| Anthropic | Explicit `cache_control` | 1024-4096 | 5 min - 1h | 90% |
| Qwen/DashScope | Automatic prefix matching | ~1024 | Similar to OpenAI | Similar to OpenAI |

**Key Points:**
- Caching happens on **provider servers**, not local files
- Local storage is for **your** ability to restore conversation context
- Restoring session = resending full conversation history to provider
- Same prefix within TTL = cache hit (cheaper + faster)
- Store **full conversation** including tool calls to enable cache reuse

**For More Info:**
- OpenAI: https://platform.openai.com/docs/guides/prompt-caching
- Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- LiteLLM (multi-provider): https://docs.litellm.ai/docs/
- Vercel AI SDK: https://sdk.vercel.ai/docs
