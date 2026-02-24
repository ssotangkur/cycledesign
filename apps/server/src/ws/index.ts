import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { getMessages, addMessage, generateMessageId } from '../sessions/storage';
import { StoredMessage } from '../llm/types';
import { SYSTEM_PROMPT } from '../llm/system-prompt';
import { executeToolCalls } from '../llm/tool-executor';
import { allTools } from '../llm/tools';
import { CoreMessage } from 'ai';
import { getLLMProvider } from '../llm/provider-factory';
import { getProviderConfig } from '../routes/providers';

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

  constructor(server: Server) {

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
      console.log('[WS] Connection rejected - missing sessionId');
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing sessionId parameter',
      } as ServerMessage));
      ws.close(4000, 'Missing sessionId');
      return;
    }

    console.log('[WS] Connection established for session:', sessionId);

    const existingConnections = this.connections.get(sessionId) || [];
    if (existingConnections.length >= MAX_CONNECTIONS_PER_SESSION) {
      console.log('[WS] Connection rejected - too many connections for session:', sessionId);
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
    console.log('[WS] Connection added to session:', sessionId, 'total connections:', existingConnections.length + 1);

    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
    } as ServerMessage));

    this.loadAndSendHistory(connection);

    ws.on('message', (data: Buffer) => {
      console.log('[WS] Raw message received for session:', sessionId, 'size:', data.length, 'bytes');
      this.onMessage(connection, data);
    });

    ws.on('pong', () => {
      connection.messageCount = 0;
    });

    ws.on('close', () => {
      console.log('[WS] Connection closed for session:', sessionId);
      this.onClose(connection);
    });

    ws.on('error', (error) => {
      console.error('[WS] Error for session', sessionId + ':', error.message);
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
    const { ws, sessionId } = connection;

    console.log('[WS] === onMessage START === session:', sessionId, 'data size:', data.length, 'bytes');
    console.log('[WS] Raw data:', data.toString('utf8'));

    if (connection.isStreaming) {
      console.log('[WS] Message ignored - streaming in progress for session:', sessionId);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Please wait for the current response to complete',
      } as ServerMessage));
      return;
    }

    const rateLimitOk = this.checkRateLimit(connection);
    console.log('[WS] Rate limit check:', rateLimitOk ? 'PASSED' : 'FAILED');
    if (!rateLimitOk) {
      console.log('[WS] Rate limit exceeded for session:', sessionId);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Rate limit exceeded. Please slow down.',
      } as ServerMessage));
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString());
      const contentPreview = message.content ? message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '') : '';
      console.log('[WS] Parsed message:', JSON.stringify({ type: message.type, id: message.id, content: contentPreview, timestamp: message.timestamp }, null, 2));
    } catch (error: unknown) {
      console.error('[WS] Failed to parse message for session', sessionId + ':', (error as Error).message);
      console.error('[WS] Raw data that failed:', data.toString('utf8'));
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid JSON format',
      } as ServerMessage));
      return;
    }

    switch (message.type) {
      case 'message':
        console.log('[WS] Handling user message for session:', sessionId);
        this.handleUserMessage(connection, message);
        break;
      case 'ping':
        console.log('[WS] Ping received, sending pong');
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
        } as ServerMessage));
        break;
      default:
        console.log('[WS] Unknown message type for session', sessionId + ':', message.type);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`,
        } as ServerMessage));
    }
    console.log('[WS] === onMessage END ===');
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

    console.log('[WS] === handleUserMessage START ===');
    console.log('[WS] clientMsgId:', clientMsgId);
    console.log('[WS] content length:', content?.length);
    console.log('[WS] content preview:', content?.substring(0, 100));

    if (!clientMsgId || !content) {
      console.log('[WS] Message rejected - missing required fields for session:', sessionId);
      console.log('[WS] clientMsgId present:', !!clientMsgId, 'content present:', !!content);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing required fields: id and content',
      } as ServerMessage));
      return;
    }

    const serverMsgId = generateMessageId();
    console.log('[WS] Generated serverMsgId:', serverMsgId);
    console.log('[WS] Sending ACK to client');

    ws.send(JSON.stringify({
      type: 'ack',
      messageId: clientMsgId,
      serverId: serverMsgId,
      timestamp: Date.now(),
    } as ServerMessage));
    console.log('[WS] ACK sent');

    const userMsg: StoredMessage = {
      id: serverMsgId,
      role: 'user',
      content,
      timestamp,
    };

    try {
      console.log('[WS] Saving user message to storage...');
      await addMessage(sessionId, userMsg);
      console.log('[WS] User message saved to session:', sessionId);
    } catch (error: unknown) {
      console.error('[WS] Error saving message for session', sessionId + ':', (error as Error).message);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to save message',
      } as ServerMessage));
      return;
    }

    console.log('[WS] Calling streamLLM...');
    await this.streamLLM(connection);
    console.log('[WS] === handleUserMessage END ===');
  }

  private async streamLLM(connection: SessionConnection): Promise<void> {
    const { ws, sessionId } = connection;
    connection.isStreaming = true;

    console.log('[WS] === streamLLM START === session:', sessionId);

    try {
      const messages = await getMessages(sessionId);
      console.log('[WS] Retrieved', messages.length, 'messages from storage');
      console.log('[WS] Messages:', messages.map(m => ({ role: m.role, content: m.content?.substring(0, 50) })));

      let currentMessages: CoreMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content || '',
        })),
      ];

      console.log('[WS] Built currentMessages array with', currentMessages.length, 'items');
      console.log('[WS] System prompt length:', SYSTEM_PROMPT.length);

      let hasToolCalls = false;
      let isFirstTurn = true;
      let hasMoreToolCalls = true;
      let loopCount = 0;

      while (hasMoreToolCalls) {
        loopCount++;
        console.log('[LLM] === Loop iteration', loopCount, '===');
        const providerConfig = getProviderConfig();
        console.log('[LLM] Calling', providerConfig.provider, 'provider with', currentMessages.length, 'messages');
        console.log('[LLM] Tools available:', Object.keys(allTools).join(', '));
        
        const result = await getLLMProvider().complete(currentMessages, {
          stream: true,
          tools: allTools,
        }) as unknown as { 
          stream: AsyncIterable<string>; 
          toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
        };
        
        console.log('[LLM] Provider.complete returned, result type:', typeof result);

        if (!result.stream) {
          console.error('[WS] Stream not available for session:', sessionId);
          throw new Error('Stream not available');
        }

        let fullContent = '';
        let chunkCount = 0;

        console.log('[WS] Starting to stream chunks to client for session:', sessionId);
        for await (const chunk of result.stream) {
          if (isFirstTurn && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'content',
              content: chunk,
            } as ServerMessage));
            chunkCount++;
            if (chunkCount <= 3 || chunkCount % 10 === 0) {
              console.log('[WS] Sent chunk', chunkCount, 'to session', sessionId + ':', chunk.substring(0, 50) + (chunk.length > 50 ? '...' : ''));
            }
          }
          fullContent += chunk;
        }
        console.log('[WS] Stream complete - received', chunkCount, 'chunks, total content length:', fullContent.length);

        console.log('[WS] Waiting for tool calls from LLM for session:', sessionId);
        const toolCalls = await result.toolCalls;
        
        console.log('[WS] Raw tool calls from LLM:', JSON.stringify(toolCalls, null, 2));
        
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        const messageId = lastUserMsg?.id || 'unknown';
        
        const toolCallsMissingArgs = !toolCalls || toolCalls.length === 0 || 
          toolCalls.some((tc: unknown) => {
            const t = tc as { args?: unknown };
            const args = t.args;
            return !args || (typeof args === 'object' && Object.keys(args).length === 0) || 
                   (typeof args === 'string' && (args === '' || args === '{}'));
          });
        
        if (toolCallsMissingArgs) {
          console.log('[WS] Tool calls missing arguments or no tool calls - ending loop');
          if (toolCalls && toolCalls.length > 0) {
            const tc = toolCalls[0] as { name?: string; toolName?: string };
            const name = tc.name || tc.toolName || 'unknown';
            ws.send(JSON.stringify({
              type: 'content',
              messageId,
              content: `I need more information to proceed. The ${name} tool requires additional parameters. Could you please provide more details?`,
            } as ServerMessage));
          }
          break;
        }
        
        if (toolCalls && toolCalls.length > 0) {
          console.log('[WS] Detected', toolCalls.length, 'tool calls for session:', sessionId);
          toolCalls.forEach((tc: unknown, idx: number) => {
            console.log('[TOOL] Raw tool call', idx + 1, ':', JSON.stringify(tc));
          });
          hasToolCalls = true;
          
          const toolCallArray = toolCalls.map(tc => ({
            id: tc.toolCallId ?? tc.id,
            type: 'function' as const,
            function: {
              name: tc.toolName ?? tc.name,
              arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
            },
          }));
          
          console.log('[TOOL] Executing', toolCallArray.length, 'tool calls for message:', messageId);
          await executeToolCalls(toolCallArray, messageId);
          console.log('[TOOL] All tool calls completed for message:', messageId);

          const newMessages: CoreMessage[] = [];

          if (fullContent.trim()) {
            newMessages.push({ role: 'assistant', content: fullContent });
          }

          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i] as { toolCallId?: string; id?: string; toolName?: string; name?: string };
            const resultContent = JSON.stringify({ success: true, output: 'Tool executed' });
            newMessages.push({
              role: 'tool',
              content: resultContent,
              toolCallId: tc.toolCallId ?? tc.id ?? `tool-${i}`,
              toolName: tc.toolName ?? tc.name ?? 'unknown',
            } as any);
          }

          currentMessages = [...currentMessages, ...newMessages];
          console.log('[LLM] Added', newMessages.length, 'messages for next turn (assistant:', fullContent.trim() ? 'yes' : 'no', ', tools:', toolCalls.length, ')');
          isFirstTurn = false;
        } else {
          console.log('[WS] No tool calls detected for session:', sessionId);
          hasMoreToolCalls = false;
          
          const assistantMsg: StoredMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: hasToolCalls ? '[Design generated]' : fullContent,
            timestamp: Date.now(),
          };

          await addMessage(sessionId, assistantMsg);
          console.log('[WS] Assistant message saved to session:', sessionId);

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'done',
              messageId: assistantMsg.id,
              timestamp: Date.now(),
            } as ServerMessage));
            console.log('[WS] Sent done signal to session:', sessionId);
          }
        }
      }

      // After multi-turn loop completes
      if (hasToolCalls) {
        // Check if submit_work was called by looking at the messages
        const submitWorkCalled = currentMessages.some(msg => 
          msg.role === 'assistant' && 
          typeof msg.content === 'string' && 
          msg.content.includes('[Design generated]')
        );
        
        // If files were created but submit_work wasn't called, trigger validation automatically
        if (!submitWorkCalled) {
          console.log('[WS] submit_work not called by LLM - triggering validation automatically');
          
          // Get the messageId from the last user message
          const lastUserMsg = messages.filter(m => m.role === 'user').pop();
          const autoMessageId = lastUserMsg?.id || generateMessageId();
          
          // Trigger validation pipeline
          try {
            const { handleValidationAndPreview } = await import('../llm/tool-executor.js');
            await handleValidationAndPreview(autoMessageId);
            console.log('[WS] Automatic validation completed successfully');
          } catch (error) {
            console.error('[WS] Automatic validation failed:', (error as Error).message);
          }
        }
      }
    } catch (error: unknown) {
      const errorMsg = (error as Error).message;
      const errorStack = (error as Error).stack;
      console.error('[WS] === streamLLM ERROR ===');
      console.error('[WS] Error message:', errorMsg);
      console.error('[WS] Error stack:', errorStack);
      console.error('[WS] Session:', sessionId);
      
      if (ws.readyState === WebSocket.OPEN) {
        console.log('[WS] Sending error to client');
        ws.send(JSON.stringify({
          type: 'error',
          error: errorMsg || 'LLM streaming error',
        } as ServerMessage));
      } else {
        console.log('[WS] WebSocket not open, cannot send error. readyState:', ws.readyState);
      }
    } finally {
      connection.isStreaming = false;
      console.log('[WS] === streamLLM END === session:', sessionId, 'streaming flag cleared');
    }
  }

  private onClose(connection: SessionConnection): void {
    const { sessionId, ws } = connection;
    
    console.log('[WS] Cleaning up connection for session:', sessionId);
    const connections = this.connections.get(sessionId) || [];
    const filtered = connections.filter(conn => conn.ws !== ws);
    
    if (filtered.length === 0) {
      console.log('[WS] Last connection closed - removing session:', sessionId);
      this.connections.delete(sessionId);
    } else {
      console.log('[WS] Connection removed -', filtered.length, 'remaining for session:', sessionId);
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
