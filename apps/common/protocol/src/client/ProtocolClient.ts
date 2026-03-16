import {
  ChannelTypes,
  TransportEnvelope,
  ControlMessage,
  Channel,
} from '../types.js';
import { serializeMessage, deserializeMessage } from '../utils/serialization.js';

/**
 * Configuration options for ProtocolClient
 */
export interface ProtocolClientOptions {
  /**
   * Optional: error handler for connection and message errors
   */
  onError?: (error: Error) => void;

  /**
   * Optional: connection state change handler
   */
  onStateChange?: (state: 'connecting' | 'connected' | 'disconnected') => void;
}

/**
 * Internal: Channel implementation for client side
 */
class ChannelImpl<T extends { client: Record<string, Record<string, unknown>>; server: Record<string, Record<string, unknown>> }> implements Channel<T> {
  private channelId: string;
  private channelType: string;
  private client: ProtocolClient;
  private nextMessageId = 1;
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  private pendingMessages: TransportEnvelope[] = [];
  private confirmed = false;

  constructor(channelId: string, channelType: string, client: ProtocolClient) {
    this.channelId = channelId;
    this.channelType = channelType;
    this.client = client;
  }

  /**
   * Internal: Update channel ID after server confirmation
   */
  _updateChannelId(channelId: string): void {
    this.channelId = channelId;
    this.confirmed = true;

    // Flush pending messages
    for (const envelope of this.pendingMessages) {
      this.client._sendEnvelope(envelope);
    }
    this.pendingMessages = [];
  }

  /**
   * Subscribe to event from server
   */
  subscribe<K extends keyof T['server']>(event: K, handler: (payload: T['server'][K]) => void): () => void {
    const eventStr = event as string;
    let handlerSet = this.handlers.get(eventStr);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(eventStr, handlerSet);
    }

    const wrappedHandler = handler as (payload: unknown) => void;
    handlerSet.add(wrappedHandler);

    // Return unsubscribe function
    return () => {
      handlerSet?.delete(wrappedHandler);
      if (handlerSet?.size === 0) {
        this.handlers.delete(eventStr);
      }
    };
  }

  /**
   * Publish event to server
   */
  async publish<K extends keyof T['client']>(event: K, payload: T['client'][K]): Promise<void> {
    const envelope: TransportEnvelope = {
      channelId: this.channelId,
      channelType: this.channelType,
      messageId: `client-msg-${this.nextMessageId++}`,
      timestamp: Date.now(),
      payload: {
        event: event as string,
        data: payload,
      },
    };

    // If not confirmed yet, queue the message
    if (!this.confirmed) {
      this.pendingMessages.push(envelope);
      return;
    }

    this.client._sendEnvelope(envelope);
  }

  /**
   * Internal: Handle incoming message from server
   */
  _handleMessage(envelope: TransportEnvelope): void {
    const payload = envelope.payload;
    const handlerSet = this.handlers.get(payload.event);
    if (handlerSet) {
      for (const handler of handlerSet) {
        try {
          handler(payload.data);
        } catch {
          // Handler errors are silently ignored to prevent one bad handler from breaking others
          // Application should handle errors in their handlers
        }
      }
    }
  }

  /**
   * Internal: Unsubscribe from channel
   */
  _unsubscribe(): void {
    this.client._sendControlMessage({
      type: 'unsubscribe',
      channelId: this.channelId,
    });
  }
}

/**
 * ProtocolClient - Manages WebSocket connection and channel instances
 */
export class ProtocolClient {
  private ws: WebSocket | null = null;
  private channels = new Map<string, ChannelImpl<ChannelTypes[keyof ChannelTypes]>>(); // channelId → channel (key is temp ID until server assigns real ID)
  private url: string;
  private options?: ProtocolClientOptions;
  private nextChannelId = 1;
  private disposed = false;
  private pendingControlMessages: ControlMessage[] = []; // Queue for messages before connection is open
  private pendingTransportMessages = new Map<string, TransportEnvelope[]>(); // Queue for transport messages before channel is confirmed

  /**
   * Create ProtocolClient instance
   *
   * @param url - WebSocket server URL (e.g., 'ws://localhost:3001')
   * @param options - Optional configuration
   */
  constructor(url: string, options?: ProtocolClientOptions) {
    this.url = url;
    this.options = options;
  }

  /**
   * Create or get channel instance
   * Each call creates independent channel instance
   * Auto-connects on first channel() call
   *
   * @param channelType - Channel type from ChannelTypes
   * @returns New Channel instance for this type
   *
   * @example
   * const channel1 = client.channel('chat');  // Auto-connects
   * const channel2 = client.channel('chat');  // Independent instance, same connection
   *
   * channel1.publish('message', { content: 'Hello' });
   */
  channel<T extends keyof ChannelTypes>(channelType: T): Channel<ChannelTypes[T]> {
    if (this.disposed) {
      throw new Error('ProtocolClient has been disposed');
    }

    // Auto-connect on first channel() call
    if (!this.ws) {
      this.connect();
    }

    // Create a temporary channel ID for tracking before server assigns real ID
    const tempChannelId = `temp-${this.nextChannelId++}`;

    // Create channel instance
    const channel = new ChannelImpl<ChannelTypes[T]>(tempChannelId, channelType as string, this);
    this.channels.set(tempChannelId, channel);

    // Send subscribe message with requestId
    this.sendControlMessage({
      type: 'subscribe',
      channelType: channelType as string,
      requestId: tempChannelId,
    });

    return channel as Channel<ChannelTypes[T]>;
  }

  /**
   * Connect to server
   * Private - called automatically on first channel() call
   */
  private connect(): void {
    this.options?.onStateChange?.('connecting');

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.options?.onStateChange?.('connected');
      
      // Flush pending control messages
      for (const message of this.pendingControlMessages) {
        this.ws!.send(serializeMessage(message));
      }
      this.pendingControlMessages = [];
    };

    this.ws.onmessage = (event) => {
      const message = deserializeMessage(event.data as string);
      if (!message) {
        // Silently ignore malformed messages
        return;
      }

      if (this.isControlMessage(message)) {
        this.handleControlMessage(message);
      } else {
        this.handleTransportMessage(message);
      }
    };

    this.ws.onclose = () => {
      this.options?.onStateChange?.('disconnected');
      this.ws = null;
    };

    this.ws.onerror = (_error) => {
      this.options?.onError?.(new Error('WebSocket error'));
    };
  }

  /**
   * Internal: Send control message to server
   */
  private sendControlMessage(message: ControlMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(message));
    } else {
      // Queue message for when connection is open
      this.pendingControlMessages.push(message);
    }
  }

  /**
   * Internal: Handle control message from server
   */
  private handleControlMessage(message: ControlMessage): void {
    if (message.type === 'subscribe-response') {
      const { channelId, requestId } = message;

      // Get the channel by requestId
      const channel = this.channels.get(requestId);
      if (!channel) {
        // Channel not found - unexpected but safe to ignore
        return;
      }

      // Remove from channels map with temp ID
      this.channels.delete(requestId);

      // Update channel ID with the real ID from server
      channel._updateChannelId(channelId);

      // Re-register with the real channel ID
      this.channels.set(channelId, channel);

      // Flush any pending transport messages for this channel
      const pending = this.pendingTransportMessages.get(channelId);
      if (pending) {
        for (const envelope of pending) {
          channel._handleMessage(envelope);
        }
        this.pendingTransportMessages.delete(channelId);
      }
    }
  }

  /**
   * Internal: Handle transport envelope message
   */
  private handleTransportMessage(envelope: TransportEnvelope): void {
    const channel = this.channels.get(envelope.channelId);
    if (channel) {
      channel._handleMessage(envelope);
    } else {
      // Channel not found - message may have arrived before channel was confirmed
      // Queue it for later delivery
      let pending = this.pendingTransportMessages.get(envelope.channelId);
      if (!pending) {
        pending = [];
        this.pendingTransportMessages.set(envelope.channelId, pending);
      }
      pending.push(envelope);
    }
  }

  /**
   * Internal: Send envelope (used by ChannelImpl)
   */
  _sendEnvelope(envelope: TransportEnvelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(envelope));
    }
  }

  /**
   * Internal: Send control message (used by ChannelImpl)
   */
  _sendControlMessage(message: ControlMessage): void {
    this.sendControlMessage(message);
  }

  /**
   * Dispose client and cleanup all resources
   * Disconnects and releases all channel instances
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // Unsubscribe from all channels
    for (const channel of this.channels.values()) {
      channel._unsubscribe();
    }

    this.channels.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Internal: Type guard for control messages
   */
  private isControlMessage(message: TransportEnvelope | ControlMessage): message is ControlMessage {
    return 'type' in message && ['subscribe', 'subscribe-response', 'unsubscribe'].includes(message.type);
  }
}
