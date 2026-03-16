# Channel Subscription Design

**Pattern:** Closure-based state with type-safe channel registry

---

## Purpose

The Channel transport system provides a **type-safe, bidirectional communication abstraction** between client and server:

- **Channel** = A single, independent communication flow between one client session and the server
- **Multiple instances** = Each session gets its own independent channel instance
- **Client creates channels** = A single client can create multiple channel instances of the same type (each independent)
- **Client manages singletons** = Client application can create singleton channel instances if desired (transport doesn't enforce)
- **Bidirectional** = Client can send events to server, server can send events to client
- **Type-safe** = All events and payloads are enforced at compile-time
- **Primitive** = Foundation for building complex interactions (chat rooms, collaborative editing, etc.)

**Key Insight:** The transport layer provides the primitive (independent channels). Application layers decide how to use them (singleton per type, multiple instances, etc.).

---

## Type Definitions

### Core Types

**Note:** Application-specific types like `ChatMessage`, `Operation`, `DocumentState`, and `EditEvent` shown in examples are defined by the implementor based on their use case. The examples in this document show the pattern, but actual types are application-specific.

```typescript
// packages/protocol/src/types.ts

/**
 * Channel type registry - defines all available channels and their events
 * Separates client-to-server and server-to-client events
 */
export interface ChannelTypes {
  'chat': {
    // Events client sends to server
    client: {
      'message': { content: string };
      'typing': { isTyping: boolean };
    };
    // Events server sends to client
    server: {
      'message': { content: string; userId: string; timestamp: number };
      'history': { messages: ChatMessage[] };
      'user-joined': { userId: string; name: string };
    };
  };

  'status:updates': {
    // Status is server-to-client only
    client: {};
    server: {
      'generation_start': { messageId: string; details: string };
      'tool_call_start': { tool: string; details: string };
      'tool_call_complete': { tool: string; details: string };
      'validation_complete': { success: boolean };
    };
  };

  'doc:main': {
    // Bidirectional editing
    client: {
      'edit': { operations: Operation[] };
      'ack': { version: number; ackId: string };
    };
    server: {
      'edit': { version: number; operations: Operation[] };
      'ack': { version: number; ackId: string };
      'snapshot': { version: number; state: DocumentState };
    };
  };
}

/**
 * Helper type: Extract client-sent events for a channel
 */
type ClientEvents<K extends keyof ChannelTypes> = ChannelTypes[K]['client'];

/**
 * Helper type: Extract server-sent events for a channel
 */
type ServerEvents<K extends keyof ChannelTypes> = ChannelTypes[K]['server'];

/**
 * Internal: Wraps payload with metadata for transport
 * Not exposed to application code
 */
interface TransportEnvelope {
  channelId: string;     // Unique channel instance ID
  channelType: string;   // Channel type name (e.g., 'chat')
  messageId: string;
  timestamp: number;
  payload: { event: string; data: unknown };
}

/**
 * Internal: Represents a single client connection
 * Not exposed to application code
 */
class Connection {
  constructor(
    private ws: WebSocket            // Actual connection
  ) {}

  send(envelope: TransportEnvelope): void {
    this.ws.send(JSON.stringify(envelope));
  }
}
```

### Public API Types

```typescript
/**
 * Client-side channel interface
 * - Can PUBLISH client events (to server)
 * - Can SUBSCRIBE to server events (from server)
 */
interface Channel<T extends { client: Record<string, Record<string, unknown>>; server: Record<string, Record<string, unknown>> }> {
  /**
   * Subscribe to event from server
   */
  subscribe<K extends keyof T['server']>(
    event: K,
    handler: (payload: T['server'][K]) => void
  ): () => void;

  /**
   * Publish event to server
   */
  publish<K extends keyof T['client']>(
    event: K,
    payload: T['client'][K]
  ): Promise<void>;
}

/**
 * Return type for onChannelSubscribe callback
 * - handlers: All client event handlers (required, type-enforced)
 * - unsubscribe: Optional cleanup function
 */
interface ChannelSubscription<T extends { client: Record<string, Record<string, unknown>> }> {
  handlers: {
    [K in keyof T['client']]: (payload: T['client'][K]) => void
  };
  unsubscribe?: () => void;
}

/**
 * Server-side channel interface (passed to onSubscribe callback)
 * - Tied to single WebSocket connection
 * - Can SUBSCRIBE to client events (from this connection)
 * - Can SEND server events (to this connection)
 */
interface ServerChannel<T extends { client: Record<string, Record<string, unknown>>; server: Record<string, Record<string, unknown>> }> {
  /**
   * Unique channel instance ID
   */
  readonly id: string;

  /**
   * Send server event to this connection
   */
  send<K extends keyof T['server']>(
    event: K,
    payload: T['server'][K]
  ): void;
}
```

---

## Type Registry

The `ChannelTypes` interface defines all available channels with **directional event separation**. See the full definition in [Type Definitions](#type-definitions).

**Structure pattern:**
```typescript
ChannelTypes['chat'] = {
  client: { /* client → server events */ };
  server: { /* server → client events */ };
}
```

**How it works:**

1. **Channel name** (`'chat'`) → Maps to `{ client, server }` event maps
2. **Direction** (`client` | `server`) → Maps to event types for that direction
3. **Event name** (`'message'`) → Maps to payload type
4. TypeScript enforces direction at compile-time

```typescript
// Server side - type inference from ChannelTypes
server.onChannelSubscribe('chat', (channel) => {
  // channel is typed as ServerChannel<ChannelTypes['chat']>

  // ✅ Return handlers for CLIENT events (received from this session)
  return {
    handlers: {
      message: (payload) => {
        // payload is typed as ChannelTypes['chat']['client']['message']
        // = { content: string }
        console.log(payload.content);  // ✅ Type-safe

        // ✅ Can send SERVER events (sent to this session)
        channel.send('message', {
          content: payload.content,
          userId: 'server',
          timestamp: Date.now()
        });
      },
      typing: (payload) => {
        // payload is typed as ChannelTypes['chat']['client']['typing']
        // = { isTyping: boolean }
        if (payload.isTyping) {
          console.log('User is typing');
        }
      }
    },
    unsubscribe: () => {
      console.log('Chat channel cleanup');
    }
  };
});

// Client side - same type inference
const channel = client.channel('chat');

// ✅ Can subscribe to SERVER events (received from server)
channel.subscribe('message', (payload) => {
  // payload is typed as ChannelTypes['chat']['server']['message']
  // = { content: string; userId: string; timestamp: number }
  console.log(`${payload.userId}: ${payload.content}`);
});

channel.subscribe('history', (payload) => {
  // payload is typed as ChannelTypes['chat']['server']['history']
  // = { messages: ChatMessage[] }
});

// ✅ Can publish CLIENT events (sent to server)
channel.publish('message', { content: 'Hello' });
channel.publish('typing', { isTyping: true });

// ❌ Type error - can't publish server events
channel.publish('history', { messages: [] });  // 'history' not in client events

// ❌ Type error - can't subscribe to client events
channel.subscribe('message', handler);  // Wrong payload type
```

**Type Enforcement:**
```typescript
// ❌ Type error - missing required handler
server.onChannelSubscribe('chat', (channel) => {
  return {
    handlers: {
      message: handler  // Missing 'typing' handler - TYPE ERROR
    }
  };
});

// ✅ All handlers provided - type-safe
server.onChannelSubscribe('chat', (channel) => {
  return {
    handlers: {
      message: handler,
      typing: handler
    }
  };
});
```

---

## Server API

For complete API reference including implementation details, see [Implementation Details: ProtocolServer API](#protocolserver-api).

```typescript
import { ProtocolServer } from '@cycledesign/protocol/server';

const server = new ProtocolServer(httpServer);

// Subscribe to channel type
server.onChannelSubscribe('chat', (channel) => {
  // Closure captures per-subscription state
  let messageCount = 0;
  const typingUsers = new Set<string>();

  // Return ALL event handlers at once - type-enforced
  return {
    handlers: {
      message: (payload) => {
        messageCount++;

        channel.send('message', {
          content: payload.content,
          userId: 'user',
          timestamp: Date.now(),
        });
      },

      typing: (payload) => {
        if (payload.isTyping) {
          typingUsers.add('anonymous');
        }

        channel.send('typing', {
          users: Array.from(typingUsers),
        });
      },
    },
    unsubscribe: () => {
      console.log('Chat channel cleanup');
    }
  };
});
```

### Handler Signature

```typescript
onChannelSubscribe<K extends keyof ChannelTypes>(
  channelType: K,
  onSubscribe: (channel: ServerChannel<ChannelTypes[K]>) => ChannelSubscription<ChannelTypes[K]> | void
): void
```

**Parameters:**
- `channelType` - Channel name from `ChannelTypes`
- `onSubscribe` - Callback invoked each time a client subscribes to this channel type

**Callback receives:**
- `channel` - ServerChannel instance for publishing/broadcasting

**Callback returns:**
- `ChannelSubscription` object with `handlers` (required) and `unsubscribe` (optional)
- Handlers for ALL client events must be provided (type-enforced)
- Cleanup function called when session ends

---

## Client API

For complete API reference including implementation details, see [Implementation Details: ProtocolClient API](#protocolclient-api).

```typescript
import { ProtocolClient } from '@cycledesign/protocol/client';

const client = new ProtocolClient('ws://localhost:3001');

// Get channel by type (auto-connects on first call)
const chatChannel = client.channel('chat');

// Subscribe to events
const unsubscribe = chatChannel.subscribe('message', (payload) => {
  console.log('Message:', payload.content);
});

// Publish events
chatChannel.publish('message', { content: 'Hello!' });
chatChannel.publish('typing', { isTyping: true });

// Cleanup
unsubscribe();
```

### Channel Methods

```typescript
interface Channel<T extends { client: Record<string, Record<string, unknown>>; server: Record<string, Record<string, unknown>> }> {
  // Subscribe to event
  subscribe<K extends keyof T['server']>(
    event: K,
    handler: (payload: T['server'][K]) => void
  ): () => void;

  // Publish event to server
  publish<K extends keyof T['client']>(
    event: K,
    payload: T['client'][K]
  ): Promise<void>;
}
```

---

## Examples

### Chat Channel (Application Service Pattern)

```typescript
class ChatRoom {
  private messageHandlers = new Set<(msg: ChatMessage) => void>();

  addMessage(content: string, userId: string): ChatMessage {
    const message: ChatMessage = {
      content,
      userId,
      timestamp: Date.now(),
    };

    this.messageHandlers.forEach(handler => handler(message));
    return message;
  }

  onMessage(handler: (msg: ChatMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
}

const chatRoom = new ChatRoom();

server.onChannelSubscribe('chat', (channel) => {
  const unsubscribe = chatRoom.onMessage((msg) => {
    if (msg.userId !== channel.id) {
      channel.send('message', msg);
    }
  });

  return {
    handlers: {
      message: (payload) => {
        const message = chatRoom.addMessage(
          payload.content,
          channel.id
        );
      },
    },
    unsubscribe
  };
});

// Client usage
const channel = client.channel('chat');

channel.subscribe('message', (payload) => {
  appendMessage(payload);
});

channel.publish('message', { content: 'Hello!' });
```

### Document Editing (Application Service Pattern)

```typescript
class DocumentRoom {
  private editHandlers = new Set<(edit: EditEvent) => void>();
  private version = 0;
  private documentState: DocumentState;

  constructor(initialState: DocumentState) {
    this.documentState = initialState;
  }

  applyEdit(operations: Operation[], sessionId: string): EditEvent {
    this.version++;
    applyOperations(this.documentState, operations);

    const edit: EditEvent = {
      version: this.version,
      operations,
      editedBy: sessionId,
      timestamp: Date.now(),
    };

    this.editHandlers.forEach(handler => handler(edit));
    return edit;
  }

  getState(): { version: number; state: DocumentState } {
    return { version: this.version, state: this.documentState };
  }

  onEdit(handler: (edit: EditEvent) => void): () => void {
    this.editHandlers.add(handler);
    return () => this.editHandlers.delete(handler);
  }
}

const docRoom = new DocumentRoom(initialState);

server.onChannelSubscribe('doc:main', (channel) => {
  const { version, state } = docRoom.getState();
  channel.send('snapshot', { version, state });

  const unsubscribe = docRoom.onEdit((edit) => {
    channel.send('edit', edit);
  });

  return {
    handlers: {
      edit: (payload) => {
        const edit = docRoom.applyEdit(payload.operations, channel.id);
      },
      ack: (payload) => {
        console.log('Ack received for version', payload.version);
      }
    },
    unsubscribe
  };
});

// Client usage
const channel = client.channel('doc:main');

channel.subscribe('edit', (payload) => {
  applyRemoteOperations(payload.operations);
});

channel.subscribe('snapshot', (payload) => {
  loadDocument(payload.state);
});

channel.subscribe('ack', (payload) => {
  console.log('Ack received for version', payload.version);
});

channel.publish('edit', { operations: localOperations });
channel.publish('ack', { version: 1, ackId: 'ack-123' });
```

### Status Updates (Server-to-Client Only)

```typescript
server.onChannelSubscribe('status:updates', (channel) => {
  channel.send('generation_start', { /* ... */ });
  channel.send('tool_call_start', { /* ... */ });
  channel.send('validation_complete', { /* ... */ });

  return {
    handlers: {},
    unsubscribe: () => {
      console.log('Status updates cleanup');
    }
  };
});

// Client usage
const channel = client.channel('status:updates');

channel.subscribe('generation_start', (payload) => {
  showStatus('Generation started');
});

channel.subscribe('tool_call_start', (payload) => {
  showStatus(`Tool: ${payload.tool}`);
});

channel.subscribe('validation_complete', (payload) => {
  if (payload.success) {
    showStatus('Validation passed');
  }
});
```

**Note on Empty Handlers:** When a channel has `client: {}` (no client-to-server events), returning `handlers: {}` is valid and type-safe. However, when client events ARE defined, you must provide handlers for ALL of them—partial handlers cause type errors.

---

## Implementation Notes

### Channel Instances

**Server side:**
- One `ServerChannel` instance per subscription
- Each client subscription gets its own independent channel instance

**Client side:**
- Client can create multiple channel instances of the same type
- Each channel instance is independent

**Example:**
```typescript
server.onChannelSubscribe('chat', (channel) => {
  const chatRoom = getChatRoom();
  const unsubscribe = chatRoom.onMessage((msg) => {
    if (msg.userId !== channel.id) {
      channel.send('message', msg);
    }
  });

  return {
    handlers: {
      message: (payload) => {
        chatRoom.addMessage(payload.content, channel.id);
      }
    },
    unsubscribe
  };
});

// Client: Multiple instances are independent
const channel1 = client.channel('chat');
const channel2 = client.channel('chat');
```

---

## Subscription Lifecycle

```
1. Client calls: client.channel('chat')
   ↓
2. Client creates temp channel ID: 'temp-1'
   ↓
3. Client sends: { type: 'subscribe', channelType: 'chat', requestId: 'temp-1' }
   ↓
4. Server receives subscription
   ↓
5. Server generates channel ID: 'channel-1'
   ↓
6. Server sends: { type: 'subscribe-response', channelType: 'chat', channelId: 'channel-1', requestId: 'temp-1' }
   ↓
7. Server calls onSubscribe callback
   ↓
8. Client matches requestId 'temp-1' to channel
   ↓
9. Client updates channel ID to 'channel-1'
   ↓
10. Client can immediately send channel messages
    ↓
11. Server queues messages until callback completes
    ↓
12. Messages flow bidirectionally
    ↓
13. Client disconnects or unsubscribes
    ↓
14. Server removes subscriber
    ↓
15. Cleanup function called
```

**Key Points:**
- Connection is established automatically on first `channel()` call
- Each `channel()` call creates an independent channel instance
- Client generates `requestId` (format: `temp-${sequence}`) for matching
- Server echoes `requestId` in `subscribe-response` for correct channel matching
- Multiple channels of same type can be created rapidly without FIFO assumptions
- Client can send messages immediately after subscribe (no wait)
- Cleanup (`unsubscribe()`) is called synchronously when connection ends
- No automatic reconnect - create new `ProtocolClient` instance to reconnect

---

## Adding New Channels

1. **Add to `ChannelTypes` interface with directional events:**

```typescript
export interface ChannelTypes {
  'new-channel': {
    client: { 'event-name': { field: string } };
    server: { 'response': { result: string } };
  };
}
```

2. **Create application service:**

```typescript
class NewChannelService {
  private responseHandlers = new Set<(response: { result: string }) => void>();

  processEvent(field: string): { result: string } {
    const response = { result: 'success: ' + field };
    this.responseHandlers.forEach(handler => handler(response));
    return response;
  }

  onResponse(handler: (response: { result: string }) => void): () => void {
    this.responseHandlers.add(handler);
    return () => this.responseHandlers.delete(handler);
  }
}
```

3. **Subscribe on server:**

```typescript
const service = new NewChannelService();

server.onChannelSubscribe('new-channel', (channel) => {
  const unsubscribe = service.onResponse((response) => {
    channel.send('response', response);
  });

  return {
    handlers: {
      'event-name': (payload) => {
        const result = service.processEvent(payload.field);
      }
    },
    unsubscribe
  };
});
```

4. **Use on client:**

```typescript
const channel = client.channel('new-channel');

channel.subscribe('response', (payload) => {
  console.log(payload.result);
});

channel.publish('event-name', { field: 'value' });
```

---

## Race Conditions and Solutions

| Race Condition | Problem | Solution | Complexity |
|----------------|---------|----------|------------|
| Client sends before server ready | Client publishes before handlers registered | Server-side message queue | Low |
| Server sends before client ready | Server sends before subscription confirmed | Client-side message queue | Low |
| Publish before subscribe acknowledged | Client publishes before subscription complete | No ack needed - server queues automatically | Low |
| Cleanup during message delivery | Client disconnects during async handler | Track active handlers | Medium |
| Client publishes before server subscribes | Client publishes before `onChannelSubscribe` called | Server-side queue + instance routing | Low |

**Implementation Priority:**
- **Must Have:** Server/client message queues, publish serialization, synchronous handler return, active handler tracking, channel instance ID routing

**Implementation Details:**
- Message queues are implemented in `ProtocolServer.pendingMessages` and client-side equivalents
- Channel instance ID routing uses the `channelId` field in `TransportEnvelope`
- Cleanup guarantees ensure `unsubscribe()` is always called synchronously

---

## FAQ

### Authentication & Authorization

**Q: How do I authenticate connections?**

Authentication is application-specific and out of scope for the transport layer. Pass auth tokens via URL query string or WebSocket subprotocol, and validate in your application logic.

---

**Q: How do I authorize channel access?**

Authorization is application-specific. Check permissions in your `onChannelSubscribe` callback and throw an error if the client is not authorized.

---

### Broadcast & Multicast

**Q: How do I broadcast to multiple sessions?**

Broadcast is an application-layer pattern. Track channel instances in your application service and iterate to send to multiple sessions. The transport layer provides per-session channels.

---

**Q: How do I create chat rooms or groups?**

Rooms are application-layer abstractions. Maintain a set of channel instances per room and send to all members. The transport layer handles individual session communication.

---

**Q: How do I send to a specific connection?**

Maintain a connection registry keyed by channel ID. Look up the channel by ID and call `send()` on it.

---

### Reconnection

**Q: How do I handle reconnection?**

Reconnection is not supported by design. Create a new `ProtocolClient` instance to reconnect. Application state management is out of scope for the transport layer.

---

### Security

**Q: Should I use WSS?**

Yes, use WSS in production. TLS encryption is essential for production deployments.

---

**Q: Should I validate payloads?**

Yes, validate payloads at the application layer. The transport layer delivers messages but doesn't validate content.

---

**Q: How do I prevent abuse?**

Rate limiting is application-specific. Implement rate checks in your application handlers before processing messages.

---

### Performance

**Q: How do I handle large messages?**

Message size limits are application-specific. Consider payload size constraints for your use case and validate accordingly.

---

**Q: How do I handle high-frequency updates?**

For high-frequency updates, consider batching or throttling at the application layer. The transport layer delivers messages as sent.

---

### Debugging

**Q: How do I debug message flow?**

Log messages at the application layer. The transport layer is transparent - you can add logging in your handlers and `onError` callbacks.

---

## Implementation Details

This section contains internal implementation details including architecture diagrams, complete API references, message protocols, and testing information.

### Architecture Overview

#### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Side                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Application │───▶│ Protocol     │───▶│  WebSocket   │      │
│  │   Service    │◀───│   Client     │◀───│   Client     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                              │                                   │
│                         channel()                                │
│                              │                                   │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │   Channel    │◀───│  Channel     │                           │
│  │              │    │   Registry   │                           │
│  └──────────────┘    └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              │ (TransportEnvelope)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Server Side                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  WebSocket   │───▶│ Protocol     │───▶│  Server      │      │
│  │   Server     │    │   Server     │    │   Channel    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                              │              │                   │
│                              │         registerHandlers()       │
│                              │              │                   │
│                              ▼              ▼                   │
│                       ┌──────────────────────────┐             │
│                       │   Application Service    │             │
│                       │   (ChatRoom, DocRoom)    │             │
│                       └──────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

#### Message Flow Diagram

```
Client                              Server
  │                                   │
  │────── WebSocket Connect ─────────▶│
  │                                   │
  │────── { type: 'subscribe',        │
  │         channelType: 'chat',      │
  │         requestId: 'temp-1' } ───▶│  (client generates requestId)
  │                                   │
  │◀───── { type: 'subscribe-response',│
  │         channelType: 'chat',      │
  │         channelId: 'channel-1',   │
  │         requestId: 'temp-1' } ────│  (server echoes requestId)
  │                                   │
  │◀───── onChannelSubscribe callback │
  │     (creates channel instance)    │
  │                                   │
  │────── { channelId: 'channel-1',   │
  │         messageId: 'client-msg-1',│
  │         payload: {...} } ────────▶│
  │                                   │
  │◀───── { channelId: 'channel-1',   │
  │         messageId: 'server-msg-1',│
  │         payload: {...} } ─────────│
  │                                   │
  │────── { type: 'unsubscribe',      │
  │         channelId: 'channel-1' }─▶│
  │                                   │
  │◀───── unsubscribe() called        │
  │     (only for this channel)       │
  │                                   │
```

**Key Points:**
- `requestId` is generated by client (format: `temp-${sequence}`)
- Server echoes `requestId` in `subscribe-response` for matching
- Client matches `requestId` to correct pending channel
- Multiple channels of same type can be created rapidly without FIFO queue assumptions

#### Key Components

**Client Side:**
- **Application Service**: Business logic layer (e.g., ChatRoom, DocumentRoom)
- **ProtocolClient**: Manages WebSocket connection and message routing
- **Channel**: Type-safe interface for individual channel instances
- **Channel Registry**: Tracks active channel instances by ID

**Server Side:**
- **WebSocket Server**: Handles HTTP upgrade and raw WebSocket connections
- **ProtocolServer**: Manages connections, routing, and lifecycle
- **ServerChannel**: Per-subscription channel instance with send/receive capabilities
- **Application Service**: Business logic layer subscribed to by ProtocolServer

**Communication:**
- All messages flow through WebSocket as `TransportEnvelope` objects
- Control messages (subscribe, unsubscribe) are separate from channel messages
- Each channel instance has a unique ID generated by the server

---

### ProtocolServer API

```typescript
import { createServer, http } from 'http';
import { ProtocolServer } from '@cycledesign/protocol/server';

/**
 * Configuration options for ProtocolServer
 */
interface ProtocolServerOptions {
  /** HTTP server for WebSocket upgrade */
  server: http.Server;

  /**
   * Optional: error handler for connection and message errors
   */
  onError?: (error: Error) => void;
}

/**
 * Internal: Tracks active channel subscriptions
 */
interface ServerChannelInfo {
  channel: ServerChannel;
  channelType: string;
}

/**
 * ProtocolServer - Manages WebSocket connections and channel routing
 */
class ProtocolServer {
  private wsServer: WebSocket.Server;
  private channels = new Map<string, ServerChannelInfo>();  // channelId → info
  private pendingMessages = new Map<string, TransportEnvelope[]>();
  private onSubscribeCallbacks = new Map<string, (channel: ServerChannel) => Promise<ChannelSubscription<any> | void>>();
  private nextChannelId = 1;

  /**
   * Create ProtocolServer instance
   */
  constructor(options: ProtocolServerOptions);

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
    onSubscribe: (channel: ServerChannel<ChannelTypes[K]>) =>
      ChannelSubscription<ChannelTypes[K]> | void
  ): void;

  /**
   * Stop server and close all connections
   * Calls all unsubscribe callbacks synchronously
   */
  close(): Promise<void>;

  /**
   * Get active channel count
   */
  getChannelCount(): number;
  
  /**
   * Internal: Handle subscribe request from client
   */
  private handleSubscribe(ws: WebSocket, channelType: string): void {
    const channelId = `channel-${this.nextChannelId++}`;
    const channel = new ServerChannel(channelId, channelType);

    this.channels.set(channelId, {
      channel,
      channelType
    });

    this.sendControlMessage(ws, {
      type: 'subscribe-response',
      channelType,
      channelId
    });

    const callback = this.onSubscribeCallbacks.get(channelType);
    if (callback) {
      callback(channel);
    }
  }

  /**
   * Internal: Send control message to client
   */
  private sendControlMessage(ws: WebSocket, message: ControlMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

**Implementation Notes:**

- **Channel Registry**: Maps `channelId` to active channel instances for message routing
- **Pending Messages**: Messages received before `onChannelSubscribe` callback completes are queued per channel instance
- **Incrementing Channel IDs**: Server generates channel IDs using incrementing counter (`channel-1`, `channel-2`, ...)
- **Cleanup Guarantees**:
  - `unsubscribe()` is ALWAYS called when connection ends
  - No reconnect - connection is final
  - Cleanup is synchronous

---

### ProtocolClient API

```typescript
import { ProtocolClient } from '@cycledesign/protocol/client';

/**
 * Configuration options for ProtocolClient
 */
interface ProtocolClientOptions {
  /**
   * Optional: error handler for connection and message errors
   */
  onError?: (error: Error) => void;

  /**
   * Optional: connection state change handler
   */
  onStateChange?: (state: 'connecting' | 'connected' | 'disconnected') => void;

  /**
   * Optional: custom WebSocket implementation
   * Default: global WebSocket in browsers, ws in Node.js
   */
  WebSocket?: typeof WebSocket;
}

/**
 * ProtocolClient - Manages WebSocket connection and channel instances
 */
class ProtocolClient {
  private ws: WebSocket | null = null;
  private channels = new Map<string, Channel<any>>();  // requestId → channel (until server assigns real channelId)
  private url: string;
  private options?: ProtocolClientOptions;
  private nextChannelId = 1;

  /**
   * Create ProtocolClient instance
   *
   * @param url - WebSocket server URL (e.g., 'ws://localhost:3001')
   * @param options - Optional configuration
   */
  constructor(url: string, options?: ProtocolClientOptions);

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
    if (!this.ws) {
      this.connect();
    }

    // Create temporary channel ID for tracking until server assigns real ID
    const requestId = `temp-${this.nextChannelId++}`;

    const channel = new ChannelImpl(requestId, channelType as string, this);
    this.channels.set(requestId, channel);

    // Send subscribe with requestId for matching response
    this.sendControlMessage({
      type: 'subscribe',
      channelType: channelType as string,
      requestId
    });

    return channel;
  }

  /**
   * Connect to server
   * Private - application code should not call directly
   */
  private connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.options?.onStateChange?.('connected');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'subscribe-response') {
        const { requestId, channelId } = message;
        // Match response to channel by requestId
        const channel = this.channels.get(requestId);
        if (channel) {
          channel.updateChannelId(channelId);
          // Re-register with real channel ID
          this.channels.delete(requestId);
          this.channels.set(channelId, channel);
        }
      } else if ('channelId' in message) {
        const channel = this.channels.get(message.channelId);
        if (channel) {
          channel.handleMessage(message);
        }
      }
    };

    this.ws.onclose = () => {
      this.options?.onStateChange?.('disconnected');
      this.ws = null;
    };

    this.ws.onerror = (error) => {
      this.options?.onError?.(error);
    };
  }

  /**
   * Send control message to server
   */
  private sendControlMessage(message: ControlMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Dispose client and cleanup all resources
   * Disconnects and releases all channel instances
   */
  dispose(): void;
}
```

**Implementation Notes:**

- **Auto-Connect**: Connection is established automatically on first `channel()` call
- **Channel Independence**: Each `channel()` call creates a new independent instance
- **No Reconnect**: Once disconnected, create new client instance to reconnect
- **Resource Cleanup**: `dispose()` should be called when client is no longer needed

---

### Message Protocol

#### TransportEnvelope

All channel messages are wrapped in a `TransportEnvelope` for routing and tracking:

```typescript
/**
 * Message envelope for all channel communication
 */
interface TransportEnvelope {
  /**
   * Channel instance ID - unique per channel instance
   * Format: `channel-${sequence}` (server-generated incrementing counter)
   * Generated by server when onChannelSubscribe is called
   * Example: 'channel-1', 'channel-2', ...
   */
  channelId: string;

  /**
   * Channel type from ChannelTypes
   * Used for routing to correct handler
   */
  channelType: string;

  /**
   * Message ID - unique per channel instance
   * Format: `${sender}-msg-${sequence}` where sender is 'client' or 'server'
   * Generated by sender: incrementing counter per channel
   * Example: 'client-msg-1', 'server-msg-23'
   */
  messageId: string;

  /**
   * Unix timestamp in milliseconds
   * Generated by sender: Date.now()
   */
  timestamp: number;

  /**
   * Actual message payload
   */
  payload: {
    event: string;
    data: unknown;
  };
}
```

#### Control Messages

Control messages manage subscription lifecycle. They are NOT sent through channels:

```typescript
/**
 * Control messages for subscription management
 * Note: No subscribe-ack - server uses queuing for flow control
 *
 * Protocol flow:
 * 1. Client sends 'subscribe' with channelType and requestId (temp channel ID)
 * 2. Server generates channelId and responds with 'subscribe-response' including requestId
 * 3. Client matches requestId to the correct pending channel and updates its ID
 */
type ControlMessage =
  /**
   * Client requests subscription to channel type
   * Includes requestId (temp channel ID) for matching response
   * Server generates channelId and responds with 'subscribe-response'
   */
  | { type: 'subscribe'; channelType: string; requestId: string }

  /**
   * Server responds with generated channelId
   * Echoes back the requestId so client can match to correct channel
   * Client uses assigned channelId for all subsequent messages
   */
  | { type: 'subscribe-response'; channelType: string; channelId: string; requestId: string }

  /** Client unsubscribes from channel (explicit per-channel cleanup) */
  | { type: 'unsubscribe'; channelId: string };
```

#### Serialization

```typescript
/**
 * Serialize message for WebSocket transmission
 */
function serializeMessage(envelope: TransportEnvelope | ControlMessage): string {
  return JSON.stringify(envelope);
}

/**
 * Deserialize message from WebSocket
 * Returns null for malformed messages (silently ignored)
 */
function deserializeMessage(data: string): TransportEnvelope | ControlMessage | null {
  try {
    const parsed = JSON.parse(data);

    // Basic validation - must be object
    if (!parsed || typeof parsed !== 'object') return null;

    return parsed as TransportEnvelope | ControlMessage;
  } catch {
    // Silently ignore malformed messages
    return null;
  }
}
```

#### ID Generation Strategy

```typescript
/**
 * ID Generation Strategy
 * 
 * - Channel IDs: Server-generated incrementing counter
 *   - Format: 'channel-1', 'channel-2', ...
 *   - Generated when server receives subscribe request
 *   - Returned to client in subscribe-response message
 *   - Client does NOT generate channelIds
 * 
 * - Message IDs: Sender-generated incrementing counter per channel
 *   - Client generates: 'client-msg-1', 'client-msg-2', ...
 *   - Server generates: 'server-msg-1', 'server-msg-2', ...
 *   - Reset for each channel instance
 */

class ProtocolClient {
  private nextMessageId = 1;

  private generateMessageId(): string {
    return `client-msg-${this.nextMessageId++}`;
  }
  
  // Client does NOT generate channelIds - server does
}

class ProtocolServer {
  private nextChannelId = 1;

  private generateChannelId(): string {
    return `channel-${this.nextChannelId++}`;
  }
}
```

**ID Guarantees:**
- **Channel ID**: Unique per channel instance, generated by server ONLY, stable for lifetime of instance
- **Message ID**: Unique per channel instance, generated by sender, used for debugging/tracing only
- **Simple counters**: No UUIDs or complex generation - just incrementing integers
- **Single source of truth**: Server exclusively generates channelIds (no client-side generation)

---

### Connection Lifecycle

#### Client Lifecycle

```typescript
import { ProtocolClient } from '@cycledesign/protocol/client';

const client = new ProtocolClient('ws://localhost:3001');

// First channel() call - auto-connects
const channel1 = client.channel('chat');  // WebSocket connects here

// Additional channels - reuse existing connection
const channel2 = client.channel('chat');  // Same WebSocket, independent channel

// Last channel unsubscribe - auto-disconnects
// When all channels are unsubscribed, WebSocket closes automatically

// Cleanup - release all resources (optional, happens automatically)
client.dispose();
```

### Single Connection Per Client

Each client should create ONE ProtocolClient instance per WebSocket connection.
The client automatically manages the connection lifecycle:
- Connects on first `channel()` call
- Disconnects when last channel is unsubscribed
- Reuse the same client for multiple channels

**Example:**
```typescript
const client = new ProtocolClient('ws://localhost:3001');

// First channel() call - auto-connects
const channel1 = client.channel('chat');  // WebSocket connects here

// Additional channels - reuse existing connection
const channel2 = client.channel('chat');  // Same WebSocket

// Last channel unsubscribe - auto-disconnects
// When all channels are unsubscribed, WebSocket closes
```

#### Server Lifecycle

```typescript
import { ProtocolServer } from '@cycledesign/protocol/server';
import { createServer } from 'http';

const httpServer = createServer();
const server = new ProtocolServer({ server: httpServer });

// 1. Server listens on WebSocket upgrade events
// (handled internally by ProtocolServer)

// 2. onChannelSubscribe called when client subscribes
server.onChannelSubscribe('chat', (channel) => {
  return {
    handlers: {
      message: (payload) => {
        // Handle message
      }
    },
    unsubscribe: () => {
      // Called when:
      // - Client disconnects
      // - Client calls channel.unsubscribe()
      // - Server closes
    }
  };
});

// 3. Graceful shutdown
await server.close();  // Calls all unsubscribe callbacks
```

#### Cleanup Guarantees

**When `unsubscribe()` is called:**
- Client disconnects (WebSocket close)
- Client calls `channel.unsubscribe()` for all channels
- Server calls `close()`
- Connection error occurs

**Cleanup Order:**
1. WebSocket connection closed
2. All active message handlers complete (synchronously)
3. All `unsubscribe()` callbacks called (synchronously)
4. Channel registry cleared
5. Resources released

**Important:**
- `unsubscribe()` is ALWAYS called when connection ends
- No reconnect - connection is final
- Cleanup is synchronous

---

### Connection and Subscription Protocol

#### Connection Flow

```typescript
const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: 'chat'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'subscribe-response') {
    const channelId = message.channelId;
  }
};
```

#### Subscription Message Format

**Client → Server:**
```json
{
  "type": "subscribe",
  "channelType": "chat"
}
```

**Server → Client:**
```json
{
  "type": "subscribe-response",
  "channelType": "chat",
  "channelId": "channel-1"
}
```

**Unsubscribe:**
```json
{
  "type": "unsubscribe",
  "channelId": "channel-1"
}
```

---

### Why No Subscribe-ACK?

The protocol uses **server-side queuing** instead of acknowledgment messages:

1. Client sends `subscribe` message
2. Client can immediately send channel messages (no wait)
3. Server queues messages until `onChannelSubscribe` callback completes
4. Server processes queued messages when channel is ready

**Benefits:**
- Fewer round trips (no ack message)
- Simpler client code (no promise management)
- Same guarantee (no lost messages via queuing)

---

### WebSocket Built-in Features

#### Connection State

WebSocket provides built-in connection state tracking via `ws.readyState` (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED).

#### Heartbeat/Ping-Pong

WebSocket protocol handles keepalive automatically with configurable ping/pong intervals.

#### Automatic Cleanup

WebSocket connection close triggers automatic cleanup. Server calls `unsubscribe()` when WebSocket closes. Use explicit unsubscribe for per-channel cleanup while keeping other channels active.

---

### Error Handling

#### Connection Errors

**Client-side connection handling:**

```typescript
import { ProtocolClient } from '@cycledesign/protocol/client';

const client = new ProtocolClient('ws://localhost:3001', {
  onError: (error) => {
    console.error('Client error:', error);
    // No automatic reconnect - application decides what to do
  }
});

// Connection happens automatically on first channel() call
const channel = client.channel('chat');

// Errors during connection are reported via onError callback
// Application can handle by creating new client instance if needed
```

**Common connection errors:**
- `ECONNREFUSED` - Server not running
- `ENOTFOUND` - Invalid hostname
- `WebSocket closed` - Connection closed during setup

#### Message Send Errors

```typescript
import { ConnectionClosedError } from '@cycledesign/protocol/errors';

const channel = client.channel('chat');

try {
  await channel.publish('message', { content: 'Hello' });
} catch (error) {
  // TODO: Handle specific error types
  console.error('Publish error:', error);
}
```

**When send errors occur:**
- WebSocket connection is closed
- Message serialization fails
- Channel is unsubscribed

**TODO: Define specific error conditions and error types:**
- Connection closed during send
- Message serialization failure
- Channel unsubscribed

#### Handler Errors

**Server-side handler error isolation:**

```typescript
server.onChannelSubscribe('chat', (channel) => {
  return {
    handlers: {
      message: async (payload) => {
        try {
          await processMessage(payload);
        } catch (error) {
          // Error logged but doesn't crash server
          // Other handlers continue processing
          console.error('Handler error:', error);

          // Optionally notify client
          channel.send('error', {
            message: 'Failed to process message',
            code: 'PROCESSING_ERROR'
          });
        }
      }
    }
  };
});
```

**Error isolation guarantees:**
- Handler errors don't crash the server
- Errors in one handler don't affect other handlers
- Errors don't affect other channel instances
- Application is responsible for error logging

#### Malformed Message Handling

**Server-side:**

```typescript
// Internal ProtocolServer implementation
ws.on('message', (data: Buffer) => {
  const envelope = deserializeMessage(data.toString());

  if (!envelope) {
    // Silently ignore malformed messages
    // Optionally log for debugging
    console.debug('Received malformed message, ignoring');
    return;
  }

  // Process valid message
  handleMessage(envelope);
});
```

**Client-side:**

```typescript
// Internal ProtocolClient implementation
ws.onmessage = (event) => {
  const message = deserializeMessage(event.data);

  if (!message) {
    // Silently ignore malformed messages
    return;
  }

  // Route to appropriate handler
  if ('channelId' in message) {
    routeToChannel(message);
  } else {
    handleControlMessage(message);
  }
};
```

#### Error Types

```typescript
/**
 * Base error for protocol errors
 */
class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * Connection was closed during operation
 */
class ConnectionClosedError extends ProtocolError {
  constructor() {
    super('Connection closed');
    this.name = 'ConnectionClosedError';
  }
}

/**
 * Subscription failed
 */
class SubscriptionError extends ProtocolError {
  constructor(channelType: string, reason: string) {
    super(`Subscription to ${channelType} failed: ${reason}`);
    this.name = 'SubscriptionError';
  }
}

/**
 * Message send failed
 */
class SendError extends ProtocolError {
  constructor(message: string) {
    super(`Send failed: ${message}`);
    this.name = 'SendError';
  }
}
```

---

### Testing

#### Unit Test ProtocolServer

**Test cases:**
- onSubscribe callback is invoked when client subscribes
- unsubscribe callback is called on dispose
- getChannelCount returns correct count
- onError callback is invoked on errors

**Setup:** Create server with mock HTTP server, verify callbacks are invoked.

#### Unit Test ProtocolClient

**Test cases:**
- channel() creates independent channel instances
- First channel() call triggers auto-connect
- Connection errors are reported via onError
- dispose() cleans up all resources

**Setup:** Create client with mock WebSocket, verify lifecycle methods.

#### Integration Tests

**Test cases:**
- Messages are delivered from client to server
- Messages are delivered from server to client
- unsubscribe callback is called on client dispose
- Multiple channel instances work independently
- Multiple clients can connect simultaneously

**Setup:** Start real server, create client instances, verify message delivery and cleanup.

#### Mock WebSocket for Testing

Use a mock WebSocket implementation for unit tests. The mock should:
- Track readyState (CONNECTING, OPEN, CLOSING, CLOSED)
- Support event handlers (onopen, onclose, onerror, onmessage)
- Provide send() and close() methods
- Allow simulating incoming messages

Implementation is straightforward - a simple class with event emitter pattern.

