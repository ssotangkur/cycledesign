import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import killPort from 'kill-port';
import { PreviewServerStatus, LogEntry, StartOptions, RestartOptions, ServerState } from './types';

// Paths are relative to the server root (apps/server)
const SERVER_ROOT = resolve(__dirname, '../..');
const WORKSPACE_DIR = resolve(SERVER_ROOT, '../../workspace');
const DESIGNS_DIR = resolve(WORKSPACE_DIR, 'designs');
const PREVIEW_DIR = resolve(SERVER_ROOT, '../preview');
const TEMPLATE_PATH = resolve(SERVER_ROOT, 'resources/templates/app.tsx');
const DEFAULT_PORT = 3002;
const MAX_LOG_BUFFER = 100;

let previewProcess: ReturnType<typeof spawn> | null = null;

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

    // Use default port directly - kill any process using it first
    const targetPort = DEFAULT_PORT;
    await this.killPortOnEndpoint(targetPort);
    this.port = targetPort;

    try {
      console.log('[PREVIEW] Starting Vite on port', targetPort);
      
      // Start Vite directly with spawn
      const env = { ...process.env, PORT: targetPort.toString(), IN_PREVIEW_SERVER: 'true' };
      
      previewProcess = spawn('npx', ['vite'], {
        cwd: PREVIEW_DIR,
        env,
        shell: true,
      });

      previewProcess.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        this.addLog('stdout', line.trim());
        if (line.includes('ready in')) {
          this.startTime = Date.now();
          this.state = 'RUNNING';
          this.emit('stateChange', this.state);
          this.emit('ready', { port: targetPort });
        }
      });

      previewProcess.stderr?.on('data', (data: Buffer) => {
        this.addLog('stderr', data.toString().trim());
      });

      previewProcess.on('error', (error: Error) => {
        this.state = 'ERROR';
        this.emit('stateChange', this.state);
        this.emit('error', error);
      });

      previewProcess.on('exit', (code: number | null) => {
        this.state = 'STOPPED';
        this.port = undefined;
        this.startTime = undefined;
        this.emit('stateChange', this.state);
        this.emit('stopped');
        this.addLog('stdout', `Preview server exited with code ${code}`);
      });

      this.addLog('stdout', `Started preview server on port ${targetPort}`);

      await this.waitForReady();
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

    // Kill the preview process if running
    if (previewProcess) {
      previewProcess.kill();
      previewProcess = null;
      this.addLog('stdout', 'Preview server stopped');
    }

    // Kill any remaining process on the port
    if (this.port) {
      await this.killPortOnEndpoint(this.port);
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

  async reset(): Promise<void> {
    if (!existsSync(DESIGNS_DIR)) {
      mkdirSync(DESIGNS_DIR, { recursive: true });
    }

    // Remove all files in designs dir except app.tsx (we'll overwrite it)
    const files = readdirSync(DESIGNS_DIR);
    for (const file of files) {
      if (file !== 'app.tsx') {
        unlinkSync(join(DESIGNS_DIR, file));
        this.addLog('stdout', `Deleted: ${file}`);
      }
    }

    // Copy bootstrap template to app.tsx (overwrites if exists)
    const targetPath = join(DESIGNS_DIR, 'app.tsx');
    this.addLog('stdout', `Resetting preview to bootstrap template`);
    copyFileSync(TEMPLATE_PATH, targetPath);
    this.addLog('stdout', `Preview reset to bootstrap version at ${targetPath}`);
  }

  async getLogs(): Promise<LogEntry[]> {
    return [...this.logs];
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
              const detectedPort = parseInt(portMatch[1], 10);
              console.log('[PREVIEW] Vite ready detected on port:', detectedPort);
              // Don't overwrite this.port - keep our target port
            }
            clearTimeout(timeout);
            console.log('[PREVIEW] Preview ready');
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

  private async killPortOnEndpoint(port: number): Promise<void> {
    try {
      await killPort(port);
      console.log(`[PREVIEW] Killed process on port ${port}`);
    } catch {
      // No process on port, that's fine
    }
  }

  private loadDesign(designName: string): void {
    if (!existsSync(DESIGNS_DIR)) {
      mkdirSync(DESIGNS_DIR, { recursive: true });
    }

    const sourcePath = resolve(DESIGNS_DIR, `${designName}.tsx`);
    const destPath = resolve(DESIGNS_DIR, 'app.tsx');

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
