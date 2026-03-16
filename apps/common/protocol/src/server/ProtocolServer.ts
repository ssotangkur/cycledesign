import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import {
  ChannelTypes,
  TransportEnvelope,
  ControlMessage,
  ServerChannel,
  ChannelSubscription,
} from '../types.js';
import { serializeMessage, deserializeMessage } from '../utils/serialization.js';

/**
 * Configuration options for ProtocolServer
 */
interface ProtocolServerOptions {
  /**
   * HTTP server for WebSocket upgrade
   */
  server: HttpServer;

  /**
   * Optional: error handler for connection and message errors
   */
  onError?: (error: Error) => void;
}

/**
 * Internal: Tracks active channel subscriptions and connection info
 */
interface ServerChannelInfo {
  channel: ServerChannelImpl<ChannelTypes[keyof ChannelTypes]>;
  channelType: string;
  ws: WebSocket;
  subscription?: ChannelSubscription<ChannelTypes[keyof ChannelTypes]>;
}

/**
 * Internal: ServerChannel implementation
 */
class ServerChannelImpl<T extends { client: Record<string, Record<string, unknown>>; server: Record<string, Record<string, unknown>> }> implements ServerChannel<T> {
  readonly id: string;
  private channelType: string;
  private ws: WebSocket;
  private nextMessageId = 1;
  private pendingMessages: TransportEnvelope[] = [];
  private handlersRegistered = false;

  constructor(id: string, channelType: string, ws: WebSocket) {
    this.id = id;
    this.channelType = channelType;
    this.ws = ws;
  }

  /**
   * Send server event to this connection
   */
  send<K extends keyof T['server']>(event: K, payload: T['server'][K]): void {
    const envelope: TransportEnvelope = {
      channelId: this.id,
      channelType: this.channelType,
      messageId: `server-msg-${this.nextMessageId++}`,
      timestamp: Date.now(),
      payload: {
        event: event as string,
        data: payload,
      },
    };

    // If handlers not yet registered, queue the message
    if (!this.handlersRegistered) {
      this.pendingMessages.push(envelope);
      return;
    }

    // Send immediately
    this._sendEnvelope(envelope);
  }

  /**
   * Internal: Send envelope to WebSocket
   */
  private _sendEnvelope(envelope: TransportEnvelope): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(envelope));
    }
  }

  /**
   * Internal: Mark handlers as registered and flush pending messages
   */
  _markHandlersRegistered(): void {
    this.handlersRegistered = true;
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const envelope of pending) {
      this._sendEnvelope(envelope);
    }
  }

  /**
   * Internal: Handle incoming message
   */
  _handleMessage(envelope: TransportEnvelope): { event: string; data: unknown } | null {
    // TODO: Add Zod runtime validation
    return envelope.payload;
  }
}

/**
 * ProtocolServer - Manages WebSocket connections and channel routing
 */
export class ProtocolServer {
  private wsServer: WebSocketServer;
  private channels = new Map<string, ServerChannelInfo>(); // channelId → info
  private pendingMessages = new Map<string, TransportEnvelope[]>(); // channelId → pending messages
  private onSubscribeCallbacks = new Map<string, (channel: ServerChannel<any>) => ChannelSubscription<any> | void>();
  private nextChannelId = 1;
  private onError?: (error: Error) => void;

  /**
   * Create ProtocolServer instance
   */
  constructor(options: ProtocolServerOptions) {
    this.onError = options.onError;

    this.wsServer = new WebSocketServer({
      noServer: true,
      path: '/protocol',
    });

    this.wsServer.on('connection', this.onConnection.bind(this));

    options.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '', 'http://localhost');
      if (url.pathname !== '/protocol') {
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.wsServer.emit('connection', ws, request);
      });
    });
  }

  /**
   * Register callback for channel subscription
   * Called when client subscribes to a channel type
   *
   * @param channelType - Channel type from ChannelTypes
   * @param onSubscribe - Callback invoked each time a client subscribes to this channel type
   *
   * @example
   * server.onChannelSubscribe('chat', (channel) => {
   *   return {
   *     handlers: {
   *       message: (payload) => { ... }
   *     },
   *     unsubscribe: () => { ... }
   *   };
   * });
   */
  onChannelSubscribe<K extends keyof ChannelTypes>(
    channelType: K,
    onSubscribe: (channel: ServerChannel<ChannelTypes[K]>) => ChannelSubscription<ChannelTypes[K]> | void
  ): void {
    this.onSubscribeCallbacks.set(channelType as string, onSubscribe as (channel: ServerChannel<any>) => ChannelSubscription<any> | void);
  }

  /**
   * Stop server and close all connections
   * Calls all unsubscribe callbacks synchronously
   */
  async close(): Promise<void> {
    // Call unsubscribe for all active channels
    for (const info of this.channels.values()) {
      info.subscription?.unsubscribe?.();
    }

    this.channels.clear();
    this.pendingMessages.clear();

    // Close WebSocket server
    await new Promise<void>((resolve) => {
      this.wsServer.close(() => {
        resolve();
      });
    });
  }

  /**
   * Get active channel count
   */
  getChannelCount(): number {
    return this.channels.size;
  }

  /**
   * Internal: Handle new WebSocket connection
   */
  private onConnection(ws: WebSocket): void {
    ws.on('message', (data: Buffer) => {
      try {
        const message = deserializeMessage(data.toString());
        if (!message) {
          // Silently ignore malformed messages
          return;
        }

        if (this.isControlMessage(message)) {
          this.handleControlMessage(ws, message);
        } else {
          this.handleTransportMessage(ws, message);
        }
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error('Unknown message error'));
      }
    });

    ws.on('close', () => {
      // Clean up all channels for this connection
      this.cleanupConnection(ws);
    });

    ws.on('error', (error) => {
      this.onError?.(error);
    });
  }

  /**
   * Internal: Handle control message
   */
  private handleControlMessage(ws: WebSocket, message: ControlMessage): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(ws, message.channelType, message.requestId);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(message.channelId);
        break;
    }
  }

  /**
   * Internal: Handle subscribe request from client
   */
  private handleSubscribe(ws: WebSocket, channelType: string, requestId: string): void {
    const channelId = `channel-${this.nextChannelId++}`;
    const channel = new ServerChannelImpl(channelId, channelType, ws);

    const info: ServerChannelInfo = {
      channel: channel as ServerChannelImpl<ChannelTypes[keyof ChannelTypes]>,
      channelType,
      ws,
    };

    this.channels.set(channelId, info);

    // Send subscribe-response to client with echoed requestId
    this.sendControlMessage(ws, {
      type: 'subscribe-response',
      channelType,
      channelId,
      requestId,
    });

    // Call onSubscribe callback
    const callback = this.onSubscribeCallbacks.get(channelType);
    if (callback) {
      try {
        const subscription = callback(channel as ServerChannel<any>);
        info.subscription = subscription as ChannelSubscription<ChannelTypes[keyof ChannelTypes]> | undefined;

        // Mark handlers as registered and flush pending messages
        channel._markHandlersRegistered();

        // Register handlers if provided
        if (subscription?.handlers) {
          // Handlers are registered - channel is ready to receive messages
          // The actual handler invocation happens in handleTransportMessage
        }
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(`onSubscribe callback error for ${channelType}`));
      }
    }
  }

  /**
   * Internal: Handle unsubscribe request from client
   */
  private handleUnsubscribe(channelId: string): void {
    const info = this.channels.get(channelId);
    if (info) {
      info.subscription?.unsubscribe?.();
      this.channels.delete(channelId);
      this.pendingMessages.delete(channelId);
    }
  }

  /**
   * Internal: Handle transport envelope message
   */
  private handleTransportMessage(ws: WebSocket, envelope: TransportEnvelope): void {
    const info = this.channels.get(envelope.channelId);
    if (!info) {
      // Channel not found - queue message for later
      let pending = this.pendingMessages.get(envelope.channelId);
      if (!pending) {
        pending = [];
        this.pendingMessages.set(envelope.channelId, pending);
      }
      pending.push(envelope);
      return;
    }

    // Verify message is for this connection
    if (info.ws !== ws) {
      // Message from wrong connection - ignore
      return;
    }

    // Process message through channel
    const payload = info.channel._handleMessage(envelope);
    if (!payload) {
      return;
    }

    // Invoke handler if registered
    const subscription = info.subscription;
    if (subscription?.handlers) {
      const handler = (subscription.handlers as Record<string, (data: unknown) => void>)[payload.event];
      if (handler) {
        try {
          handler(payload.data);
        } catch (error) {
          this.onError?.(error instanceof Error ? error : new Error(`Handler error for ${payload.event}`));
        }
      }
    }

    // Process any pending messages for this channel
    this.processPendingMessages(envelope.channelId);
  }

  /**
   * Internal: Process pending messages for a channel
   */
  private processPendingMessages(channelId: string): void {
    const pending = this.pendingMessages.get(channelId);
    if (pending && pending.length > 0) {
      const info = this.channels.get(channelId);
      if (info) {
        for (const envelope of pending) {
          this.handleTransportMessage(info.ws, envelope);
        }
      }
      this.pendingMessages.delete(channelId);
    }
  }

  /**
   * Internal: Cleanup when connection closes
   */
  private cleanupConnection(ws: WebSocket): void {
    // Find all channels for this connection
    const channelsToRemove: string[] = [];
    for (const [channelId, info] of this.channels.entries()) {
      if (info.ws === ws) {
        info.subscription?.unsubscribe?.();
        channelsToRemove.push(channelId);
      }
    }

    // Remove channels
    for (const channelId of channelsToRemove) {
      this.channels.delete(channelId);
      this.pendingMessages.delete(channelId);
    }
  }

  /**
   * Internal: Send control message to client
   */
  private sendControlMessage(ws: WebSocket, message: ControlMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeMessage(message));
    }
  }

  /**
   * Internal: Type guard for control messages
   */
  private isControlMessage(message: TransportEnvelope | ControlMessage): message is ControlMessage {
    return 'type' in message && ['subscribe', 'subscribe-response', 'unsubscribe'].includes(message.type);
  }
}
