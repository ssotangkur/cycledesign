export type ServerState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

export interface PreviewServerStatus {
  status: ServerState;
  port?: number;
  url?: string;
  pid?: number;
  uptime?: number;
}

export interface LogEntry {
  type: 'stdout' | 'stderr' | 'ready' | 'exit';
  message: string;
  timestamp: number;
}

export interface StartOptions {
  designName?: string;
}

export interface RestartOptions {
  designName?: string;
}
