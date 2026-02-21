import { randomBytes, createHash } from 'node:crypto';
import { EventEmitter } from 'events';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
  clientId: process.env.QWEN_OAUTH_CLIENT_ID || 'qwen-code-cli',
  deviceCodeEndpoint: process.env.QWEN_OAUTH_DEVICE_ENDPOINT || 'https://auth.qwen.ai/oauth/device/code',
  tokenEndpoint: process.env.QWEN_OAUTH_TOKEN_ENDPOINT || 'https://auth.qwen.ai/oauth/token',
  scope: 'openid qwen_code',
  grantType: 'urn:ietf:params:oauth:grant-type:device_code',
};

export class QwenAuth extends EventEmitter {
  private refreshTimer: NodeJS.Timeout | null = null;
  private cachedToken: string | null = null;
  private cachedTokenExpiry: number = 0;
  
  private readonly TOKEN_CACHE_DURATION = 5 * 60 * 1000;
  private readonly REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

  private getCredsPath(): string {
    return join(homedir(), '.qwen', 'oauth_creds.json');
  }

  private generatePKCE(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  async getToken(): Promise<string | null> {
    const now = Date.now();

    if (this.cachedToken && now < this.cachedTokenExpiry && 
        now - this.cachedTokenExpiry < this.TOKEN_CACHE_DURATION) {
      return this.cachedToken;
    }

    const creds = await this.loadCredentials();
    if (!creds) return null;

    const shouldRefresh = now > creds.expiryDate - this.REFRESH_BEFORE_EXPIRY_MS;
    
    if (shouldRefresh && creds.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(creds.refreshToken);
        await this.saveCredentials(refreshed);
        this.cachedToken = refreshed.accessToken;
        this.cachedTokenExpiry = refreshed.expiryDate;
        this.emit('tokenRefreshed', refreshed);
        return refreshed.accessToken;
      } catch (error) {
        this.emit('tokenRefreshError', error);
        return null;
      }
    }

    this.cachedToken = creds.accessToken;
    this.cachedTokenExpiry = creds.expiryDate;
    return creds.accessToken;
  }

  async performDeviceAuthFlow(): Promise<QwenCredentials> {
    const { verifier, challenge } = this.generatePKCE();

    const deviceAuth = await this.requestDeviceAuthorization(challenge);
    
    this.emit('authorizationRequired', {
      verificationUrl: deviceAuth.verification_uri_complete,
      userCode: deviceAuth.user_code,
    });
    this.openBrowser(deviceAuth.verification_uri_complete);

    const tokenResponse = await this.pollForToken(
      deviceAuth.device_code,
      verifier,
      deviceAuth.expires_in * 1000
    );

    const credentials = this.tokenResponseToCredentials(tokenResponse);
    await this.saveCredentials(credentials);
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
    let interval = 5000;

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
          
          if (error.error === 'authorization_pending') {
            continue;
          }
          
          if (error.error === 'slow_down') {
            interval = Math.min(interval + 5000, 15000);
            continue;
          }
        } catch {
          // Non-JSON error, continue polling
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
    try {
      const credsPath = this.getCredsPath();
      const data = await fs.readFile(credsPath, 'utf-8');
      const parsed = JSON.parse(data) as any;
      // Support both camelCase and snake_case from qwen-code CLI
      return {
        accessToken: parsed.access_token || parsed.accessToken,
        tokenType: parsed.token_type || parsed.tokenType || 'Bearer',
        refreshToken: parsed.refresh_token || parsed.refreshToken,
        expiryDate: parsed.expiry_date || parsed.expiryDate,
        scope: parsed.scope,
      } as QwenCredentials;
    } catch {
      return null;
    }
  }

  private async saveCredentials(creds: QwenCredentials): Promise<void> {
    const credsPath = this.getCredsPath();
    const credsDir = join(homedir(), '.qwen');
    await fs.mkdir(credsDir, { recursive: true });
    // Save in snake_case format for compatibility with qwen-code CLI
    const data = {
      access_token: creds.accessToken,
      token_type: creds.tokenType,
      refresh_token: creds.refreshToken,
      expiry_date: creds.expiryDate,
      resource_url: 'portal.qwen.ai',
      scope: creds.scope,
    };
    await fs.writeFile(credsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async openBrowser(url: string): Promise<void> {
    const { spawn } = await import('child_process');
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
