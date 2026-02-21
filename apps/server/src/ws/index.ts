import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { getMessages, addMessage } from '../sessions/storage';
import { QwenProvider } from '../llm/providers/qwen';
import { generateMessageId } from '../sessions/storage';
import { StoredMessage, CoreMessage } from '../llm/types';

interface SessionConnection {
  ws: WebSocket;
  sessionId: string;
  isStreaming: boolean;
  lastMessageTime: number;
  messageCount: number;
}

interface ClientMessage {
  type: string;
  id?: string;
  content?: string;
  timestamp?: number;
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_MESSAGES = 30;
const MAX_CONNECTIONS_PER_SESSION = 5;

export class WebSocketHandler {
  private wss: WebSocketServer;
  private connections = new Map<string, SessionConnection[]>();
  private qwenProvider: QwenProvider;

  constructor(server: Server) {
    this.qwenProvider = new QwenProvider();

    this.wss = new WebSocketServer({
      noServer: true,
      path: '/ws',
    });

    this.wss.on('connection', this.onConnection.bind(this));

    server.on('upgrade', (request: IncomingMessage, socket: import('net').Socket, head: Buffer) => {
      const parsedUrl = parseUrl(request.url || '', true);
      
      if (parsedUrl.pathname !== '/ws') {
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    console.log(`WebSocket server ready at ws://localhost:${process.env.PORT || 3001}/ws`);
  }

  private onConnection(ws: WebSocket, request: IncomingMessage): void {
    const parsedUrl = parseUrl(request.url || '', true);
    const sessionId = parsedUrl.query?.sessionId as string | undefined;

    if (!sessionId) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing sessionId parameter',
      } as ServerMessage));
      ws.close(4000, 'Missing sessionId');
      return;
    }

    const existingConnections = this.connections.get(sessionId) || [];
    if (existingConnections.length >= MAX_CONNECTIONS_PER_SESSION) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Too many connections for this session',
      } as ServerMessage));
      ws.close(4001, 'Too many connections');
      return;
    }

    const connection: SessionConnection = {
      ws,
      sessionId,
      isStreaming: false,
      lastMessageTime: 0,
      messageCount: 0,
    };

    this.connections.set(sessionId, [...existingConnections, connection]);

    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
    } as ServerMessage));

    this.loadAndSendHistory(connection);

    ws.on('message', (data: Buffer) => {
      this.onMessage(connection, data);
    });

    ws.on('pong', () => {
      connection.messageCount = 0;
    });

    ws.on('close', () => {
      this.onClose(connection);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error.message);
      this.onClose(connection);
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  }

  private async loadAndSendHistory(connection: SessionConnection): Promise<void> {
    const { ws, sessionId } = connection;

    try {
      const messages = await getMessages(sessionId);
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'history',
          messages,
          timestamp: Date.now(),
        } as ServerMessage));
      }
    } catch (error: unknown) {
      console.error(`Error loading history for session ${sessionId}:`, (error as Error).message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Failed to load message history',
        } as ServerMessage));
      }
    }
  }

  private onMessage(connection: SessionConnection, data: Buffer): void {
    const { ws } = connection;

    if (connection.isStreaming) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Please wait for the current response to complete',
      } as ServerMessage));
      return;
    }

    if (!this.checkRateLimit(connection)) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Rate limit exceeded. Please slow down.',
      } as ServerMessage));
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (error: unknown) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid JSON format',
      } as ServerMessage));
      return;
    }

    switch (message.type) {
      case 'message':
        this.handleUserMessage(connection, message);
        break;
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
        } as ServerMessage));
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`,
        } as ServerMessage));
    }
  }

  private checkRateLimit(connection: SessionConnection): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    if (connection.lastMessageTime < windowStart) {
      connection.messageCount = 0;
      connection.lastMessageTime = now;
    }

    if (connection.messageCount >= RATE_LIMIT_MAX_MESSAGES) {
      return false;
    }

    connection.messageCount++;
    return true;
  }

  private async handleUserMessage(connection: SessionConnection, message: ClientMessage): Promise<void> {
    const { ws, sessionId } = connection;
    const clientMsgId = message.id;
    const content = message.content;
    const timestamp = message.timestamp || Date.now();

    if (!clientMsgId || !content) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing required fields: id and content',
      } as ServerMessage));
      return;
    }

    const serverMsgId = generateMessageId();

    ws.send(JSON.stringify({
      type: 'ack',
      messageId: clientMsgId,
      serverId: serverMsgId,
      timestamp: Date.now(),
    } as ServerMessage));

    const userMsg: StoredMessage = {
      id: serverMsgId,
      role: 'user',
      content,
      timestamp,
    };

    try {
      await addMessage(sessionId, userMsg);
    } catch (error: unknown) {
      console.error(`Error saving message for session ${sessionId}:`, (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to save message',
      } as ServerMessage));
      return;
    }

    await this.streamLLM(connection);
  }

  private async streamLLM(connection: SessionConnection): Promise<void> {
    const { ws, sessionId } = connection;
    connection.isStreaming = true;

    try {
      const messages = await getMessages(sessionId);

      const coreMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content || '',
      })) as CoreMessage[];

      const result = await this.qwenProvider.complete(coreMessages, { stream: true });

      if (!result.stream) {
        throw new Error('Stream not available');
      }

      let fullContent = '';
      for await (const chunk of result.stream) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'content',
            content: chunk,
          } as ServerMessage));
        }
        fullContent += chunk;
      }

      const assistantMsg: StoredMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      };

      await addMessage(sessionId, assistantMsg);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'done',
          messageId: assistantMsg.id,
          timestamp: Date.now(),
        } as ServerMessage));
      }
    } catch (error: unknown) {
      console.error(`Error streaming LLM response for session ${sessionId}:`, (error as Error).message);
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error: (error as Error).message || 'LLM streaming error',
        } as ServerMessage));
      }
    } finally {
      connection.isStreaming = false;
    }
  }

  private onClose(connection: SessionConnection): void {
    const { sessionId, ws } = connection;
    
    const connections = this.connections.get(sessionId) || [];
    const filtered = connections.filter(conn => conn.ws !== ws);
    
    if (filtered.length === 0) {
      this.connections.delete(sessionId);
    } else {
      this.connections.set(sessionId, filtered);
    }
  }

  public broadcastToSession(sessionId: string, message: ServerMessage): void {
    const connections = this.connections.get(sessionId) || [];
    
    connections.forEach(conn => {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify(message));
      }
    });
  }

  public closeSessionConnections(sessionId: string): void {
    const connections = this.connections.get(sessionId) || [];
    
    connections.forEach(conn => {
      conn.ws.close(4002, 'Session deleted');
    });
    
    this.connections.delete(sessionId);
  }

  public getActiveConnections(): number {
    let total = 0;
    this.connections.forEach(conns => {
      total += conns.length;
    });
    return total;
  }
}
