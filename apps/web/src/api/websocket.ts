import type { Message } from './client';

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export interface WebSocketMessage {
  type: 'message' | 'ping' | 'connected' | 'history' | 'ack' | 'content' | 'done' | 'error' | 'pong';
  id?: string;
  content?: string;
  timestamp?: number;
  messageId?: string;
  serverId?: string;
  messages?: Message[];
  error?: string;
  retryAfter?: number;
}

export interface DisplayMessage extends Message {
  status: 'pending' | 'confirmed' | 'streaming' | 'completed';
  serverId?: string;
}

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS.length;

export class SessionWebSocket {
  private sessionId: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private messageQueue: QueuedMessage[] = [];
  private isManualDisconnect = false;
  private pingInterval: number | null = null;

  // Event callbacks
  onHistory?: (messages: DisplayMessage[]) => void;
  onMessageAck?: (clientMsgId: string, serverMsgId: string) => void;
  onContent?: (content: string) => void;
  onDone?: (messageId: string) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (connected: boolean) => void;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  connect(): void {
    this.isManualDisconnect = false;
    this.reconnectAttempts = 0;
    this.openConnection();
  }

  private openConnection(): void {
    const url = `${WS_BASE_URL}/ws?sessionId=${this.sessionId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = this.handleOpen.bind(this);
    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
    this.ws.onerror = this.handleError.bind(this);
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.onConnectionChange?.(true);
    this.startPingInterval();
    this.flushMessageQueue();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data) as WebSocketMessage;

      switch (data.type) {
        case 'connected':
          // Connection established, history will follow
          break;

        case 'history':
          this.handleHistory(data);
          break;

        case 'ack':
          this.handleAck(data);
          break;

        case 'content':
          this.onContent?.(data.content || '');
          break;

        case 'done':
          this.onDone?.(data.messageId || '');
          break;

        case 'error':
          this.onError?.(data.error || 'Unknown error');
          break;

        case 'pong':
          // Keep-alive response, ignore
          break;

        default:
          console.warn('Unknown WebSocket message type:', data);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      this.onError?.('Failed to parse server message');
    }
  }

  private handleHistory(data: WebSocketMessage): void {
    const messages = data.messages || [];
    const displayMessages: DisplayMessage[] = messages.map((msg) => ({
      ...msg,
      status: 'completed' as const,
    }));
    this.onHistory?.(displayMessages);
  }

  private handleAck(data: WebSocketMessage): void {
    if (data.messageId && data.serverId) {
      this.onMessageAck?.(data.messageId, data.serverId);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.stopPingInterval();
    this.onConnectionChange?.(false);

    if (!this.isManualDisconnect && !event.wasClean) {
      this.scheduleReconnect();
    }
  }

  private handleError(): void {
    // Error details are limited in WebSocket API
    // The handleClose event will provide more context
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onError?.('Connection failed after maximum retries');
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempts];
    this.reconnectAttempts++;

    setTimeout(() => {
      if (!this.isManualDisconnect) {
        this.openConnection();
      }
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect(): void {
    this.isManualDisconnect = true;
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendMessage(content: string): string {
    const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();

    const message: QueuedMessage = {
      id: clientMsgId,
      content,
      timestamp,
    };

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendWebSocketMessage(message);
    } else {
      this.messageQueue.push(message);
    }

    return clientMsgId;
  }

  private sendWebSocketMessage(message: QueuedMessage): void {
    const wsMessage: WebSocketMessage = {
      type: 'message',
      id: message.id,
      content: message.content,
      timestamp: message.timestamp,
    };

    this.ws?.send(JSON.stringify(wsMessage));
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendWebSocketMessage(message);
      }
    }
  }
}
