import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import * as net from 'net';
import { resolve } from 'path';
import { promisify } from 'util';
import { PreviewServerStatus, LogEntry, StartOptions, RestartOptions, ServerState } from './types';

const execAsync = promisify(exec);

// Paths are relative to the server root (apps/server)
const SERVER_ROOT = resolve(__dirname, '../..');
const WORKSPACE_DIR = resolve(SERVER_ROOT, '../../workspace');
const DESIGNS_DIR = resolve(WORKSPACE_DIR, 'designs');
const PREVIEW_DIR = resolve(SERVER_ROOT, '../preview');
const DEFAULT_PORT = 3002;
const MAX_LOG_BUFFER = 100;
const PM2_APP_NAME = 'preview';

export class PreviewManager extends EventEmitter {
  private state: ServerState = 'STOPPED';
  private port: number | undefined;
  private logs: LogEntry[] = [];
  private startTime: number | undefined;

  getStatus(): PreviewServerStatus {
    const status: PreviewServerStatus = {
      status: this.state,
    };

    if (this.port !== undefined) {
      status.port = this.port;
      status.url = `http://localhost:${this.port}`;
    }

    if (this.startTime !== undefined) {
      status.uptime = Date.now() - this.startTime;
    }

    return status;
  }

  async start(options: StartOptions = {}): Promise<void> {
    const { designName } = options;

    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      throw new Error('Preview server is already running or starting');
    }

    this.state = 'STARTING';
    this.emit('stateChange', this.state);

    if (designName) {
      this.loadDesign(designName);
    }

    const availablePort = await this.findAvailablePort(DEFAULT_PORT);
    this.port = availablePort;

    try {
      console.log('[PREVIEW] Starting Vite via PM2 on port', availablePort);
      
      // Stop existing instance if any (don't delete - keep in PM2 list)
      try {
        await execAsync(`pm2 stop ${PM2_APP_NAME}`);
      } catch {
        // Ignore if not running
      }

      // Start with PM2 (reuse existing entry)
      const env = { PORT: availablePort.toString(), IN_PREVIEW_SERVER: 'true' };
      const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
      
      await execAsync(
        `cd /d "${PREVIEW_DIR}" && ${envStr} pm2 restart ${PM2_APP_NAME} --update-env`,
        { shell: 'cmd.exe' }
      );

      this.startTime = Date.now();
      this.addLog('stdout', `Started preview server via PM2 on port ${availablePort}`);

      await this.waitForReady();

      this.state = 'RUNNING';
      this.emit('stateChange', this.state);
      this.emit('ready', { port: availablePort });
    } catch (error) {
      this.state = 'ERROR';
      this.emit('stateChange', this.state);
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'STOPPED') {
      return;
    }

    this.emit('stopping');

    try {
      await execAsync(`pm2 stop ${PM2_APP_NAME}`, { shell: 'cmd.exe' });
      
      this.addLog('stdout', 'Preview server stopped via PM2');
    } catch (error) {
      this.addLog('stderr', `Failed to stop via PM2: ${(error as Error).message}`);
    }

    this.state = 'STOPPED';
    this.port = undefined;
    this.startTime = undefined;
    this.emit('stateChange', this.state);
    this.emit('stopped');
  }

  async restart(options: RestartOptions = {}): Promise<void> {
    await this.stop();
    await this.start(options);
  }

  async getLogs(): Promise<LogEntry[]> {
    try {
      const { stdout } = await execAsync(`pm2 logs ${PM2_APP_NAME} --lines 100 --nostream`, { shell: 'cmd.exe' });
      const lines = stdout.split('\n').filter(Boolean);
      
      return lines.map((line) => ({
        type: 'stdout',
        message: line,
        timestamp: Date.now(),
      }));
    } catch {
      return [...this.logs];
    }
  }

  clearLogs(): void {
    this.logs = [];
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[PREVIEW] Timeout waiting for Vite ready');
        reject(new Error('Preview server failed to start within timeout'));
      }, 30000);

      const checkReady = async () => {
        try {
          const logs = await this.getLogs();
          const readyLog = logs.find((log) => 
            log.message.includes('ready') || log.message.includes('Local:')
          );
          
          if (readyLog) {
            const portMatch = readyLog.message.match(/:(\d+)/);
            if (portMatch) {
              this.port = parseInt(portMatch[1], 10);
            }
            clearTimeout(timeout);
            console.log('[PREVIEW] Vite ready detected, port:', this.port);
            resolve();
          } else {
            setTimeout(checkReady, 500);
          }
        } catch {
          setTimeout(checkReady, 500);
        }
      };

      checkReady();

      if (this.state === 'ERROR') {
        clearTimeout(timeout);
        reject(new Error('Preview server failed to start'));
      }
    });
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort;
    const maxAttempts = 10;

    for (let i = 0; i < maxAttempts; i++) {
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
      this.addLog('stdout', `Port ${port} is in use, trying ${port + 1}...`);
      port++;
    }

    throw new Error(`Could not find available port after ${maxAttempts} attempts`);
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  private loadDesign(designName: string): void {
    if (!existsSync(DESIGNS_DIR)) {
      mkdirSync(DESIGNS_DIR, { recursive: true });
    }

    const sourcePath = resolve(DESIGNS_DIR, `${designName}.tsx`);
    const destPath = resolve(DESIGNS_DIR, 'current.tsx');

    if (!existsSync(sourcePath)) {
      this.addLog('stderr', `Design file not found: ${designName}.tsx`);
      return;
    }

    try {
      copyFileSync(sourcePath, destPath);
      this.addLog('stdout', `Loaded design: ${designName}.tsx`);
    } catch (error) {
      this.addLog('stderr', `Failed to load design: ${error}`);
    }
  }

  private addLog(type: LogEntry['type'], message: string): void {
    const entry: LogEntry = {
      type,
      message,
      timestamp: Date.now(),
    };

    this.logs.push(entry);

    if (this.logs.length > MAX_LOG_BUFFER) {
      this.logs.shift();
    }
  }
}

export const previewManager = new PreviewManager();
