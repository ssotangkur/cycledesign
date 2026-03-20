# WebSocket Protocol Specification

**Phase:** 2a
**Version:** 1.0
**Last Updated:** 2026-02-21

> **⚠️ Deprecation Notice**
>
> This WebSocket protocol specification describes the **current implementation** (Phase 2a, Version 1.0).
>
> **Target Architecture:** The protocol will be replaced by a **type-safe channel transport** system. See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) for the complete specification.
>
> **Timeline:** Migration planned for Q2 2026.
>
> **Why the Change?**
> - Compile-time type safety vs. runtime validation
> - Per-session channel instances vs. raw message routing
> - Directional event separation (client→server vs server→client)
> - Type-enforced handler registration
> - Simpler client API (auto-connect, no manual reconnection)

This document specifies the WebSocket-based real-time messaging protocol used in CycleDesign for bidirectional communication between client and server.

---

## Table of Contents

1. [Connection](#1-connection)
2. [Message Formats](#2-message-formats)
3. [Message Flow Diagrams](#3-message-flow-diagrams)
4. [Error Handling](#4-error-handling)
5. [Reconnection Strategy](#5-reconnection-strategy)
6. [Rate Limiting](#6-rate-limiting)
7. [Example Implementations](#7-example-implementations)

---

## 1. Connection

### 1.1 Endpoint

**Current Implementation:**
```
ws://localhost:3001/ws?sessionId=<session_id>
```

**Target (Channel Transport):**
```
ws://localhost:3001/
// No sessionId in URL - managed by ProtocolClient
// Client creates channels: client.channel('chat')
// Server generates channel IDs: 'channel-1', 'channel-2', ...
```

See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) Section "Connection and Subscription Protocol" for details.

**Parameters:**

| Parameter   | Type   | Required | Description                          |
|-------------|--------|----------|--------------------------------------|
| `sessionId` | string | Yes      | Unique identifier for the session    |

### 1.2 Connection Lifecycle

```
1. Client creates WebSocket connection with sessionId
2. Server validates sessionId exists
3. Server sends "connected" acknowledgment
4. Server sends current conversation history
5. Connection persists for session lifetime
6. Client closes connection when switching sessions
```

### 1.3 Connection States

| State        | Description                                      |
|--------------|--------------------------------------------------|
| Connecting   | WebSocket handshake in progress                  |
| Connected    | Connection established, history received         |
| Streaming    | Server is streaming LLM response                 |
| Disconnected | Connection closed (intentional or network error) |
| Reconnecting | Attempting to re-establish connection            |

---

## 2. Message Formats

### Message Format Comparison

| Aspect | Current (WebSocket) | Target (Channels) |
|--------|---------------------|-------------------|
| **Envelope** | `{ type, id, content, timestamp }` | `TransportEnvelope` with channelId, channelType, messageId |
| **Control Messages** | `connected`, `history`, `ack`, `content`, `done` | `subscribe`, `subscribe-response`, `unsubscribe` |
| **Application Messages** | `{ type: "message", ... }` | `{ channelId, channelType, payload: { event, data } }` |
| **ID Generation** | Client generates message IDs | Server generates channelIds, sender generates messageIds |
| **Direction** | Untyped bidirectional | Separated client→server and server→client |

### 2.1 Client → Server Messages

#### 2.1.1 Send Message

Sent when user submits a new message.

```typescript
{
  "type": "message",
  "id": "msg_client_1234567890",
  "content": "Create a landing page",
  "timestamp": 1705312210000
}
```

| Field       | Type   | Required | Description                                      |
|-------------|--------|----------|--------------------------------------------------|
| `type`      | string | Yes      | Always `"message"`                               |
| `id`        | string | Yes      | Client-generated unique ID (for optimistic UI)   |
| `content`   | string | Yes      | Message content                                  |
| `timestamp` | number | No       | Unix timestamp in milliseconds (defaults to now) |

#### 2.1.2 Ping (Keep-Alive)

Sent periodically to maintain connection.

```typescript
{
  "type": "ping"
}
```

### 2.2 Server → Client Messages

#### 2.2.1 Connected

Sent immediately after WebSocket handshake.

```typescript
{
  "type": "connected",
  "sessionId": "session-abc123"
}
```

| Field       | Type   | Description                    |
|-------------|--------|--------------------------------|
| `type`      | string | Always `"connected"`           |
| `sessionId` | string | Confirmed session identifier   |

#### 2.2.2 History

Sent after `connected` with full conversation history.

```typescript
{
  "type": "history",
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Create a landing page",
      "timestamp": 1705312210000
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Here's a landing page...",
      "timestamp": 1705312215000,
      "tokenCount": 150
    }
  ],
  "timestamp": 1705312220000
}
```

| Field       | Type     | Description                              |
|-------------|----------|------------------------------------------|
| `type`      | string   | Always `"history"`                       |
| `messages`  | array    | Array of Message objects                 |
| `timestamp` | number   | Unix timestamp of history snapshot       |

**Message Object:**

| Field       | Type   | Description                          |
|-------------|--------|--------------------------------------|
| `id`        | string | Server-generated message ID          |
| `role`      | string | `"user"` or `"assistant"`            |
| `content`   | string | Message content                      |
| `timestamp` | number | Unix timestamp in milliseconds       |
| `tokenCount`| number | Optional: token count for assistant  |

#### 2.2.3 Acknowledgment (Ack)

Sent immediately after receiving a message (before saving).

```typescript
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": 1705312211000
}
```

| Field       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `type`      | string | Always `"ack"`                           |
| `messageId` | string | Echo of client's message ID              |
| `serverId`  | string | Server's permanent ID for the message    |
| `timestamp` | number | Unix timestamp in milliseconds           |

#### 2.2.4 Content (Streaming)

Sent for each chunk of streaming LLM response.

```typescript
{
  "type": "content",
  "content": "Here's a landing page..."
}
```

| Field     | Type   | Description                    |
|-----------|--------|--------------------------------|
| `type`    | string | Always `"content"`             |
| `content` | string | Content chunk (append to UI)   |

#### 2.2.5 Done

Sent when streaming is complete.

```typescript
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": 1705312220000
}
```

| Field       | Type   | Description                              |
|-------------|--------|------------------------------------------|
| `type`      | string | Always `"done"`                          |
| `messageId` | string | Server ID of the completed message       |
| `timestamp` | number | Unix timestamp in milliseconds           |

#### 2.2.6 Error

Sent when an error occurs.

```typescript
{
  "type": "error",
  "error": "Rate limit exceeded",
  "retryAfter": 60000
}
```

| Field       | Type   | Required | Description                              |
|-------------|--------|----------|------------------------------------------|
| `type`      | string | Yes      | Always `"error"`                         |
| `error`     | string | Yes      | Human-readable error message             |
| `retryAfter`| number | No       | Milliseconds to wait before retrying     |

---

## 3. Message Flow Diagrams

### 3.1 Initial Connection Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  ws://localhost:3001/ws?sessionId=abc123│
     │────────────────────────────────────────>│
     │                                         │
     │         { type: "connected" }           │
     │<────────────────────────────────────────│
     │                                         │
     │  { type: "history", messages: [...] }   │
     │<────────────────────────────────────────│
     │                                         │
     │         Connection Established          │
     │                                         │
```

### 3.2 Message Exchange Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  Add optimistic message (pending)       │
     │                                         │
     │  { type: "message", id: "client_123" }  │
     │────────────────────────────────────────>│
     │                                         │
     │  { type: "ack", serverId: "msg_003" }   │
     │<────────────────────────────────────────│
     │                                         │
     │  Convert: client_123 → msg_003          │
     │  Status: pending → confirmed            │
     │                                         │
     │  { type: "content", content: "..." }    │
     │<────────────────────────────────────────│
     │                                         │
     │  Append content to streaming message    │
     │                                         │
     │  { type: "content", content: "..." }    │
     │<────────────────────────────────────────│
     │                                         │
     │  { type: "done", messageId: "msg_004" } │
     │<────────────────────────────────────────│
     │                                         │
     │  Mark streaming message complete        │
     │                                         │
```

### 3.3 Reconnection Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  [Network Disconnected]                 │
     │                                         │
     │  Queue messages locally                 │
     │                                         │
     │  [Network Reconnected]                  │
     │                                         │
     │  Reconnect WebSocket                    │
     │────────────────────────────────────────>│
     │                                         │
     │  { type: "connected" }                  │
     │<────────────────────────────────────────│
     │                                         │
     │  { type: "history", messages: [...] }   │
     │<────────────────────────────────────────│
     │                                         │
     │  Flush queued messages                  │
     │────────────────────────────────────────>│
     │                                         │
```

### 3.4 Rapid-Fire Messages Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  Send Message A                         │
     │────────────────────────────────────────>│
     │  [isStreaming = true]                   │
     │                                         │
     │  Queue Message B                        │
     │  Queue Message C                        │
     │                                         │
     │  { type: "content" }...{ type: "done" } │
     │<────────────────────────────────────────│
     │                                         │
     │  [isStreaming = false]                  │
     │                                         │
     │  Flush: Send Message B                  │
     │────────────────────────────────────────>│
     │  [isStreaming = true]                   │
     │                                         │
     │  Queue Message C (still)                │
     │                                         │
     │  { type: "content" }...{ type: "done" } │
     │<────────────────────────────────────────│
     │                                         │
     │  [isStreaming = false]                  │
     │                                         │
     │  Flush: Send Message C                  │
     │────────────────────────────────────────>│
     │                                         │
```

---

## 4. Error Handling

### 4.1 Error Types

| Error Code              | Description                              | Retry |
|-------------------------|------------------------------------------|-------|
| `Session not found`     | Invalid or deleted sessionId             | No    |
| `Rate limit exceeded`   | Too many messages per second             | Yes   |
| `LLM unavailable`       | Qwen API error or timeout                | Yes   |
| `Unknown message type`  | Client sent unrecognized message type    | No    |
| `Invalid JSON`          | Malformed message payload                | No    |
| `Connection closed`     | Server closed connection unexpectedly    | Yes   |

### 4.2 Error Message Format

```typescript
{
  "type": "error",
  "error": "Error message description",
  "retryAfter": 60000  // Optional: milliseconds to wait
}
```

### 4.3 Client Error Handling

```typescript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'error') {
    setError(data.error);
    setIsStreaming(false);
    
    if (data.retryAfter) {
      setTimeout(() => clearError(), data.retryAfter);
    }
  }
};
```

### 4.4 Server Error Handling

```typescript
try {
  // Process message
} catch (error: any) {
  ws.send(JSON.stringify({
    type: 'error',
    error: error.message,
    retryAfter: error.retryAfter
  }));
}
```

---

## 5. Reconnection Strategy

**Current Implementation:** Exponential backoff with message queuing

**Target (Channel Transport):** No automatic reconnection

> **Note:** The channel-based transport does not support automatic reconnection by design. Applications should create a new `ProtocolClient` instance to reconnect. This simplifies the protocol and removes state management complexity.
>
> See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) FAQ: "How do I handle reconnection?"

### 5.1 Exponential Backoff

Reconnection attempts use exponential backoff with a maximum delay:

```typescript
const delays = [1000, 2000, 4000, 8000, 16000, 30000]; // milliseconds
const maxAttempts = 6;
```

| Attempt | Delay     |
|---------|-----------|
| 1       | 1 second  |
| 2       | 2 seconds |
| 3       | 4 seconds |
| 4       | 8 seconds |
| 5       | 16 seconds|
| 6+      | 30 seconds|

### 5.2 Reconnection Logic

```typescript
class SessionWebSocket {
  private reconnectAttempts = 0;
  private messageQueue: QueuedMessage[] = [];
  
  connect(sessionId: string) {
    const ws = new WebSocket(`ws://localhost:3001/ws?sessionId=${sessionId}`);
    
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.flushQueue();
    };
    
    ws.onclose = () => {
      if (this.reconnectAttempts < maxAttempts) {
        const delay = delays[this.reconnectAttempts];
        setTimeout(() => this.connect(sessionId), delay);
        this.reconnectAttempts++;
      }
    };
  }
  
  send(content: string) {
    const clientMsgId = `msg_${Date.now()}`;
    
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push({ id: clientMsgId, content });
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'message',
      id: clientMsgId,
      content
    }));
  }
  
  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this.ws.send(JSON.stringify({
        type: 'message',
        id: msg.id,
        content: msg.content
      }));
    }
  }
}
```

### 5.3 Connection Status States

| Status         | Display          | Behavior                           |
|----------------|------------------|------------------------------------|
| Connecting     | "Connecting..."  | Show spinner, disable send         |
| Connected      | Green dot        | Normal operation                   |
| Reconnecting   | "Reconnecting..."| Queue messages, show progress      |
| Offline        | "Offline"        | Queue messages, manual retry option|

---

## 6. Rate Limiting

### 6.1 Server-Side Rate Limits

| Limit Type          | Threshold        | Action                    |
|---------------------|------------------|---------------------------|
| Messages per second | 5 msg/s          | Queue excess messages     |
| Messages per minute | 60 msg/min       | Return rate limit error   |
| Concurrent streams  | 1 per session    | Queue until stream done   |

### 6.2 Rate Limit Response

When rate limit is exceeded:

```typescript
{
  "type": "error",
  "error": "Rate limit exceeded",
  "retryAfter": 60000
}
```

### 6.3 Client-Side Throttling

```typescript
class SessionWebSocket {
  private lastSendTime = 0;
  private readonly minDelay = 200; // 5 msg/s
  
  send(content: string) {
    const now = Date.now();
    const elapsed = now - this.lastSendTime;
    
    if (elapsed < this.minDelay) {
      // Throttle: delay send
      setTimeout(() => this._send(content), this.minDelay - elapsed);
      return;
    }
    
    this._send(content);
  }
  
  private _send(content: string) {
    this.lastSendTime = Date.now();
    // ... send logic
  }
}
```

---

## Migration to Channel Transport

### What Changes

1. **Client API:**
   ```typescript
   // Current
   const ws = new SessionWebSocket(sessionId, callbacks);
   ws.send({ type: 'message', content: 'Hello' });
   
   // Target
   const client = new ProtocolClient('ws://localhost:3001');
   const channel = client.channel('chat');
   channel.publish('message', { content: 'Hello' });
   ```

2. **Server API:**
   ```typescript
   // Current
   ws.on('message', (data) => {
     const msg = JSON.parse(data);
     if (msg.type === 'message') { ... }
   });
   
   // Target
   server.onChannelSubscribe('chat', (channel) => {
     return {
       handlers: {
         message: (payload) => { ... }
       },
       unsubscribe: () => { ... }
     };
   });
   ```

3. **Type Safety:**
   ```typescript
   // Target - Compile-time enforcement
   interface ChannelTypes {
     'chat': {
       client: { 'message': { content: string } };
       server: { 'message': { content: string; userId: string } };
     };
   }
   
   // Missing handlers = TYPE ERROR
   server.onChannelSubscribe('chat', (channel) => {
     return {
       handlers: {
         message: handler  // ❌ Missing 'typing' handler
       }
     };
   });
   ```

### Migration Phases

1. **Phase 1:** Implement `ProtocolServer` and `ProtocolClient`
2. **Phase 2:** Migrate status messages to channel transport
3. **Phase 3:** Migrate chat messages to channel transport
4. **Phase 4:** Deprecate raw WebSocket API
5. **Phase 5:** Remove WebSocket protocol layer

### Backward Compatibility

During migration, both protocols will coexist:
- New clients use channel transport
- Existing clients continue with WebSocket protocol
- Gradual migration path with feature flags

See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) for complete migration guide.

---

## 7. Example Implementations

### 7.1 Client: TypeScript WebSocket Class

```typescript
type MessageStatus = 'pending' | 'confirmed' | 'streaming' | 'completed';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  status?: MessageStatus;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

class SessionWebSocket {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private messageQueue: Array<{ id: string; content: string }> = [];
  private readonly delays = [1000, 2000, 4000, 8000, 16000, 30000];
  private readonly maxAttempts = 6;
  
  private onHistory?: (messages: Message[]) => void;
  private onContent?: (content: string) => void;
  private onDone?: (messageId: string) => void;
  private onError?: (error: string) => void;
  private onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  
  constructor(
    sessionId: string,
    callbacks: {
      onHistory?: (messages: Message[]) => void;
      onContent?: (content: string) => void;
      onDone?: (messageId: string) => void;
      onError?: (error: string) => void;
      onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
    }
  ) {
    this.sessionId = sessionId;
    this.onHistory = callbacks.onHistory;
    this.onContent = callbacks.onContent;
    this.onDone = callbacks.onDone;
    this.onError = callbacks.onError;
    this.onStatusChange = callbacks.onStatusChange;
    
    this.connect();
  }
  
  private connect() {
    if (!this.sessionId) return;
    
    this.onStatusChange?.('connecting');
    
    const ws = new WebSocket(`ws://localhost:3001/ws?sessionId=${this.sessionId}`);
    this.ws = ws;
    
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatusChange?.('connected');
      this.flushQueue();
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as WebSocketMessage;
      this.handleMessage(data);
    };
    
    ws.onclose = () => {
      this.onStatusChange?.('disconnected');
      this.scheduleReconnect();
    };
    
    ws.onerror = () => {
      this.onError?.('Connection error');
    };
  }
  
  private handleMessage(data: WebSocketMessage) {
    switch (data.type) {
      case 'connected':
        // Connection established
        break;
        
      case 'history':
        this.onHistory?.(data.messages);
        break;
        
      case 'ack':
        // Convert pending message to confirmed
        this.onAck?.(data.messageId, data.serverId);
        break;
        
      case 'content':
        this.onContent?.(data.content);
        break;
        
      case 'done':
        this.onDone?.(data.messageId);
        break;
        
      case 'error':
        this.onError?.(data.error);
        break;
    }
  }
  
  send(content: string): string {
    const clientMsgId = `msg_${Date.now()}`;
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push({ id: clientMsgId, content });
      return clientMsgId;
    }
    
    this.ws.send(JSON.stringify({
      type: 'message',
      id: clientMsgId,
      content,
      timestamp: Date.now()
    }));
    
    return clientMsgId;
  }
  
  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      this.ws?.send(JSON.stringify({
        type: 'message',
        id: msg.id,
        content: msg.content,
        timestamp: Date.now()
      }));
    }
  }
  
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxAttempts) {
      this.onError?.('Max reconnection attempts reached');
      return;
    }
    
    const delay = this.delays[this.reconnectAttempts];
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
  
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
```

### 7.2 Client: React Hook

```typescript
function useMessageListState(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<SessionWebSocket | null>(null);
  
  useEffect(() => {
    if (!sessionId) return;
    
    wsRef.current = new SessionWebSocket(sessionId, {
      onHistory: (msgs) => {
        setMessages(msgs.map(m => ({ ...m, status: 'completed' })));
      },
      onContent: (content) => {
        setMessages(prev => prev.map(m => 
          m.status === 'streaming' 
            ? { ...m, content: m.content + content }
            : m
        ));
      },
      onDone: (messageId) => {
        setIsStreaming(false);
        setMessages(prev => prev.map(m => 
          m.status === 'streaming' 
            ? { ...m, id: messageId, status: 'completed' }
            : m
        ));
      },
      onError: (err) => {
        setError(err);
        setIsStreaming(false);
      },
      onStatusChange: (status) => {
        setIsConnected(status === 'connected');
      }
    });
    
    return () => {
      wsRef.current?.disconnect();
    };
  }, [sessionId]);
  
  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current) return;
    
    const clientMsgId = wsRef.current.send(content);
    
    // Add optimistic message
    setMessages(prev => [...prev, {
      id: clientMsgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'pending'
    }]);
  }, []);
  
  return {
    messages,
    isConnected,
    isStreaming,
    error,
    sendMessage,
    clearError: () => setError(null)
  };
}
```

### 7.3 Server: WebSocket Handler (Node.js)

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getMessages, addMessage } from '../sessions/storage';
import { streamLLM } from '../llm/qwen';

interface SessionConnection {
  ws: WebSocket;
  sessionId: string;
  isStreaming: boolean;
}

class WebSocketHandler {
  private wss: WebSocketServer;
  private connections = new Map<string, SessionConnection>();
  private rateLimits = new Map<string, number[]>();
  
  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ 
      server, 
      path: '/ws' 
    });
    
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }
  
  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'sessionId required' 
      }));
      ws.close();
      return;
    }
    
    // Send connected acknowledgment
    ws.send(JSON.stringify({ 
      type: 'connected', 
      sessionId 
    }));
    
    // Load and send history
    getMessages(sessionId).then(messages => {
      ws.send(JSON.stringify({ 
        type: 'history', 
        messages,
        timestamp: Date.now()
      }));
    });
    
    // Track connection
    this.connections.set(sessionId, { ws, sessionId, isStreaming: false });
    
    ws.on('message', (data) => {
      this.handleMessage(sessionId, data);
    });
    
    ws.on('close', () => {
      this.connections.delete(sessionId);
    });
  }
  
  private async handleMessage(sessionId: string, data: RawData) {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    
    const { ws } = connection;
    
    // Rate limiting
    if (!this.checkRateLimit(sessionId)) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Rate limit exceeded',
        retryAfter: 60000
      }));
      return;
    }
    
    let message: any;
    try {
      message = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Invalid JSON' 
      }));
      return;
    }
    
    if (message.type === 'ping') {
      // Keep-alive, no response needed
      return;
    }
    
    if (message.type !== 'message') {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Unknown message type' 
      }));
      return;
    }
    
    // Prevent concurrent streams
    if (connection.isStreaming) {
      // Queue message (client should handle this too)
      return;
    }
    
    const { id: clientMsgId, content, timestamp } = message;
    const serverMsgId = this.generateMessageId();
    
    // IMMEDIATE acknowledgment (before saving)
    ws.send(JSON.stringify({
      type: 'ack',
      messageId: clientMsgId,
      serverId: serverMsgId,
      timestamp: Date.now()
    }));
    
    // Save user message (async)
    const userMsg = {
      id: serverMsgId,
      role: 'user' as const,
      content,
      timestamp: timestamp || Date.now(),
    };
    
    await addMessage(sessionId, userMsg);
    
    // Get full conversation for LLM
    const messages = await getMessages(sessionId);
    
    // Stream LLM response
    connection.isStreaming = true;
    this.streamLLM(messages, connection);
  }
  
  private async streamLLM(messages: Message[], connection: SessionConnection) {
    const { ws, sessionId } = connection;
    
    try {
      const result = await streamLLM(messages);
      
      if (!result.stream) {
        throw new Error('Stream not available');
      }
  
      let fullContent = '';
      for await (const chunk of result.stream) {
        fullContent += chunk;
        ws.send(JSON.stringify({
          type: 'content',
          content: chunk,
        }));
      }
  
      // Save assistant message
      const assistantMsg = {
        id: this.generateMessageId(),
        role: 'assistant' as const,
        content: fullContent,
        timestamp: Date.now(),
      };
      await addMessage(sessionId, assistantMsg);
  
      ws.send(JSON.stringify({
        type: 'done',
        messageId: assistantMsg.id,
        timestamp: Date.now(),
      }));
  
    } catch (error: any) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message || 'LLM unavailable',
      }));
    } finally {
      connection.isStreaming = false;
    }
  }
  
  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 60;
    
    const timestamps = this.rateLimits.get(sessionId) || [];
    const recent = timestamps.filter(t => now - t < windowMs);
    
    if (recent.length >= maxRequests) {
      return false;
    }
    
    recent.push(now);
    this.rateLimits.set(sessionId, recent);
    return true;
  }
  
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### 7.4 Server: Integration with Express

```typescript
import express from 'express';
import http from 'http';
import { WebSocketHandler } from './ws';

const app = express();
const server = http.createServer(app);

// Attach WebSocket handler
const wsHandler = new WebSocketHandler(server);

// REST routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/complete', completionRouter);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
```

---

## Appendix A: Message Type Reference

| Type         | Direction      | Description                        |
|--------------|----------------|------------------------------------|
| `message`    | Client → Server| Send a new user message            |
| `ping`       | Client → Server| Keep-alive heartbeat               |
| `connected`  | Server → Client| Connection established             |
| `history`    | Server → Client| Full conversation history          |
| `ack`        | Server → Client| Message acknowledgment             |
| `content`    | Server → Client| Streaming content chunk            |
| `done`       | Server → Client| Streaming complete                 |
| `error`      | Server → Client| Error occurred                     |

---

## Appendix B: Status Codes

The WebSocket protocol does not use custom status codes. Standard WebSocket close codes apply:

| Code | Meaning           |
|------|-------------------|
| 1000 | Normal closure    |
| 1001 | Going away        |
| 1006 | Abnormal closure  |
| 1011 | Server error      |

---

## Appendix C: WebSocket Migration History (Completed March 2026)

This appendix documents the completed migration from dual WebSocket implementations to a unified WebSocket architecture. This work is **complete** and provides the foundation for the upcoming channel transport migration.

For the future channel migration plan, see [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md).

### Migration Goals (Completed)

1. **Unified WebSocket Implementations:** Merged `src/ws/ws.ts` and `src/websocket/` into single `transport/ws/`
2. **Clear Boundaries:** Established transport/application/domain layer separation
3. **Deduplicated Validation:** Extracted shared `ValidationService`
4. **Status Message Integration:** Server broadcasts status, client receives and displays
5. **Deterministic E2E Tests:** Mock LLM provider enables reliable testing

### Phases Completed

#### Phase 1: Deduplicate Validation Logic

**Goal:** Eliminate duplicate `handleValidationAndPreview()` functions in `agent.ts` and `tool-executor.ts`.

**Changes:**
- Created `ValidationService` in `validation/validation-service.ts`
- Refactored `agent.ts` and `tool-executor.ts` to use shared service
- Extracted common validation logic (TypeScript, ESLint, preview management)

**Files Created:**
- `apps/server/src/validation/validation-service.ts`

**Files Modified:**
- `apps/server/src/llm/agent.ts`
- `apps/server/src/llm/tool-executor.ts`

---

#### Phase 2: Restructure Directories

**Goal:** Establish clear architectural boundaries between transport and application layers.

**Changes:**
- Created `transport/ws/` for WebSocket transport layer
- Created `features/status/` for status broadcasting feature
- Moved `ws/ws.ts` → `transport/ws/WebSocketHandler.ts`
- Moved `websocket/types.ts` → `features/status/types.ts`
- Moved `websocket/status-broadcaster.ts` → `features/status/StatusBroadcaster.ts`
- Deleted unused `websocket/handler.ts`

**Files Created:**
- `apps/server/src/transport/ws/` (directory)
- `apps/server/src/features/status/` (directory)

**Files Moved:**
- `apps/server/src/ws/ws.ts` → `apps/server/src/transport/ws/WebSocketHandler.ts`
- `apps/server/src/websocket/types.ts` → `apps/server/src/features/status/types.ts`
- `apps/server/src/websocket/status-broadcaster.ts` → `apps/server/src/features/status/StatusBroadcaster.ts`

**Files Deleted:**
- `apps/server/src/websocket/handler.ts` (unused)

---

#### Phase 3: Create WebSocket Bridge

**Goal:** Connect application-layer status events to WebSocket transport.

**Changes:**
- Created `WebSocketBridge` class to subscribe to `StatusBroadcaster` events
- Bridge calls `WebSocketHandler.broadcastToSession()` to send via WebSocket
- Added `status` message type to WebSocket protocol
- Wired bridge in `server.ts`

**Files Created:**
- `apps/server/src/features/status/WebSocketBridge.ts`

**Files Modified:**
- `apps/server/src/server.ts`
- `apps/server/src/transport/ws/WebSocketHandler.ts`

**Message Format Added:**
```typescript
{
  type: 'status';
  status: StatusType;
  messageId: string;
  tool?: string;
  details: string;
  timestamp: number;
}
```

---

#### Phase 4: Create Mock Provider

**Goal:** Enable deterministic E2E testing with mock LLM responses.

**Changes:**
- Created `MockProvider` class in `llm/providers/mock.ts`
- Added `ENABLE_MOCK_PROVIDER` environment variable
- Integrated mock provider into provider router
- Configured deterministic responses for known prompts

**Files Created:**
- `apps/server/src/llm/providers/mock.ts`

**Files Modified:**
- `apps/server/src/trpc/routers/providers.ts`
- `apps/server/.env.example`

**Features:**
- Deterministic text responses for known prompts
- Configurable tool call responses
- No external API calls
- Works offline
- Simulates streaming with delays

---

#### Phase 5: Client-Side Integration

**Goal:** Display real-time status messages in the client UI.

**Changes:**
- Added status message handling to `SessionWebSocket` class
- Updated `useMessageListState` hook with `currentStatus` state
- Created `StatusDisplay` component
- Integrated status display into `ChatPage`

**Files Modified:**
- `apps/web/src/api/websocket.ts`
- `apps/web/src/hooks/useMessageListState.ts`

**Files Created:**
- `apps/web/src/components/status/StatusDisplay.tsx`

**Status Types Displayed:**
- `generation_start` / `generation_complete`
- `tool_call_start` / `tool_call_complete` / `tool_call_error`
- `validation_start` / `validation_complete` / `validation_error`
- `preview_start` / `preview_ready` / `preview_error`

---

#### Phase 6: E2E Testing with Mock Provider

**Goal:** Enable reliable, deterministic end-to-end tests.

**Changes:**
- Created mock provider E2E fixture (`useMockProvider`)
- Wrote deterministic chat flow test (`chat-mock.spec.ts`)
- Wrote status message test (`status-messages.spec.ts`)

**Files Created:**
- `tests/e2e/tests/chat-mock.spec.ts`
- `tests/e2e/tests/status-messages.spec.ts`

**Files Modified:**
- `tests/e2e/fixtures/test-fixtures.ts`

**Test Coverage:**
- Full chat flow with mock provider
- Tool call execution and status display
- Validation pipeline status messages
- Error state handling

---

#### Phase 7: Cleanup and Documentation

**Goal:** Finalize migration with documentation and cleanup.

**Changes:**
- Removed old directory structures
- Updated all imports to new paths
- Created comprehensive documentation
- Verified all tests pass

**Files Created:**
- `docs/WEBSOCKET-MIGRATION.md` (original version)
- `docs/WEBSOCKET_PROTOCOL.md` (this document)

**Files Deleted:**
- `apps/server/src/ws/` (after successful move)
- `apps/server/src/websocket/` (after successful move)

**Documentation Added:**
- Architecture overview with responsibility boundaries
- Status message protocol reference
- Mock provider usage guide
- E2E testing guide

---

### Legacy Code Status

All code from this migration is **production-ready** and will be replaced by the channel transport in Q2 2026.

### Architecture Achieved

```
apps/server/src/
├── transport/
│   └── ws/
│       └── WebSocketHandler.ts    # WebSocket connections, sessions, rate limiting
│
├── features/
│   └── status/
│       ├── types.ts               # StatusMessage, StatusType
│       ├── StatusBroadcaster.ts   # Pub/sub core
│       └── WebSocketBridge.ts     # Bridge: application status → WebSocket
│
├── llm/
│   ├── agent.ts                   # ToolLoopAgent with streaming
│   ├── tool-executor.ts           # Manual tool execution (legacy)
│   ├── tools/                     # Tool definitions
│   ├── providers/
│   │   ├── mock.ts                # Mock provider for testing
│   │   ├── mistral.ts
│   │   └── qwen.ts
│   └── work-tracker.ts            # Tracks pending work per messageId
│
├── validation/
│   ├── validation-service.ts      # Shared validation logic
│   ├── pipeline.ts                # ValidationPipeline class
│   ├── typescript.ts              # TypeScript compilation checks
│   ├── eslint.ts                  # ESLint validation
│   └── id-injector.ts             # ID injection for testing
│
└── preview/
    └── preview-manager.ts         # Vite preview server management
```

### Responsibility Boundaries Achieved

| Layer | Directory | Responsibilities | Status |
|-------|-----------|------------------|--------|
| **Transport** | `transport/ws/` | WebSocket protocol, TCP connections, session tracking, rate limiting, message routing | ✅ Complete |
| **Application** | `features/status/` | Status message types, pub/sub broadcasting, WebSocket bridge | ✅ Complete |
| **Domain** | `llm/`, `validation/`, `preview/` | LLM orchestration, tool execution, validation logic, preview management | ✅ Complete |

### Next Steps

The next phase of evolution is the **channel transport migration** described in [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md). This will add a type-safe protocol layer on top of the WebSocket transport.
