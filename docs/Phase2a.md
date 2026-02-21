# Phase 2a: WebSocket-Based Real-Time Messaging

## Overview

Phase 2a refactors the session messaging system from Phase 2 to use WebSocket connections instead of REST API calls. This phase focuses on:

- Replace HTTP polling/SSE with persistent WebSocket connection
- Send conversation history once on connect (not per message)
- Enable bidirectional real-time communication
- Simplify client state management
- Improve message delivery efficiency
- Add automatic reconnection support

**Success Criteria:**
- WebSocket connection established on session load
- History sent once on connection (not per message)
- Subsequent messages only send new content
- Client state synchronized with server automatically
- Automatic reconnection on network failure
- Message queueing during disconnection
- No duplicate API calls or race conditions

**Note:** This is a refactoring of Phase 2, not new functionality. All features from Phase 2 remain, but with improved architecture.

---

## Technical Decisions

### 1. WebSocket Protocol

**Decision:** Use native WebSocket API instead of Server-Sent Events (SSE)

**Rationale:**
- **Bidirectional:** Client and server can both send messages
- **Efficient:** Single connection for entire session lifetime
- **History once:** Send conversation history only on connect
- **Lower latency:** No HTTP handshake overhead per message
- **Better for chat:** Natural fit for conversational interfaces
- **Reconnection:** Built-in connection management

**Comparison:**

| Feature | REST + SSE | WebSocket |
|---------|-----------|-----------|
| Connection | New per message | Persistent |
| History transfer | Every message | Once on connect |
| Direction | Unidirectional | Bidirectional |
| Latency | Higher (HTTP overhead) | Lower |
| Reconnection | Manual | Built-in |
| Server push | No | Yes |

---

### 2. Message Protocol

**Decision:** JSON message format over WebSocket with immediate acknowledgment

**Client → Server Messages:**
```typescript
// Send user message (client generates ID)
{
  "type": "message",
  "id": "msg_client_1234567890",  // Client-generated ID
  "content": "Create a landing page",
  "timestamp": 1234567890
}

// Ping (keep-alive)
{
  "type": "ping"
}
```

**Server → Client Messages:**
```typescript
// Connection acknowledgment + history
{
  "type": "connected",
  "sessionId": "session-abc123"
}

{
  "type": "history",
  "messages": [
    { "id": "msg_001", "role": "user", "content": "...", "timestamp": 1234567890 },
    { "id": "msg_002", "role": "assistant", "content": "...", "timestamp": 1234567895 }
  ],
  "timestamp": 1234567890
}

// Immediate acknowledgment (sent right after receiving message)
{
  "type": "ack",
  "messageId": "msg_client_1234567890",  // Echo client's ID
  "serverId": "msg_003",                  // Server's permanent ID
  "timestamp": 1234567891
}

// Streaming content chunk
{
  "type": "content",
  "content": "Here's a landing page..."
}

// Stream complete
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": 1234567900
}

// Error
{
  "type": "error",
  "error": "Rate limit exceeded"
}
```

**Rationale:**
- Simple JSON format (not binary)
- Easy to debug in browser DevTools
- Type field for message routing
- **Client generates message ID** for optimistic updates
- **Server acknowledges immediately** with mapping to server ID
- **No state reconciliation needed** - client ID maps to server ID
- Extensible (can add new message types)

---

### 3. Connection Management

**Decision:** One WebSocket per session with immediate acknowledgment

**Connection Lifecycle:**
```
1. User creates/loads session
2. Client creates WebSocket: ws://localhost:3001/ws?sessionId=abc123
3. Server sends: { type: "connected", sessionId: "abc123" }
4. Server sends: { type: "history", messages: [...] }
5. Client displays messages
6. User sends message → WebSocket → Server
7. Server immediately sends: { type: "ack", messageId: "client_id", serverId: "server_id" }
8. Server saves message, calls LLM, streams response
9. Connection persists for session lifetime
10. User switches session → Close old WS, open new WS
```

**Message Acknowledgment Flow:**
```typescript
// Client sends message with client-generated ID
const clientMsgId = `msg_${Date.now()}`;
ws.send(JSON.stringify({
  type: 'message',
  id: clientMsgId,
  content: 'Hello',
  timestamp: Date.now()
}));

// Server immediately acknowledges (before saving)
ws.send(JSON.stringify({
  type: 'ack',
  messageId: clientMsgId,      // Echo client's ID
  serverId: 'msg_003',         // Server's permanent ID
  timestamp: Date.now()
}));

// Client converts optimistic → confirmed
convertMessage(clientMsgId, 'msg_003');

// Server then saves and streams response
// ... streaming chunks ...
// ... done message ...
```

**Reconnection Strategy:**
```typescript
const delays = [1000, 2000, 4000, 8000, 16000, 30000]; // Exponential backoff

onClose() {
  if (reconnectAttempts < maxAttempts) {
    setTimeout(() => reconnect(), delays[reconnectAttempts]);
    reconnectAttempts++;
  }
}
```

**Message Queueing:**
```typescript
// Queue messages while disconnected or waiting for ack
sendMessage(content) {
  const clientMsgId = `msg_${Date.now()}`;
  
  // Add optimistic message
  addMessage({
    id: clientMsgId,
    role: 'user',
    content,
    status: 'pending'  // Pending acknowledgment
  });
  
  if (ws.readyState !== WebSocket.OPEN) {
    messageQueue.push({ id: clientMsgId, content });
    return;
  }
  
  ws.send(JSON.stringify({ 
    type: 'message', 
    id: clientMsgId,
    content 
  }));
}

// Flush queue on reconnect
onOpen() {
  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    ws.send(JSON.stringify({ 
      type: 'message', 
      id: msg.id,
      content: msg.content 
    }));
  }
}

// Convert on acknowledgment
onMessage(event) {
  if (event.type === 'ack') {
    convertMessage(event.messageId, event.serverId);
  }
}
```

---

### 4. State Management with MessageListState Hook

**Decision:** Use `useMessageListState` hook to abstract message state management

**Architecture:**
```
┌─────────────────┐
│  MessageList    │
│  Component      │
└────────┬────────┘
         │ Subscribes to
         ↓
┌─────────────────────────┐
│  useMessageListState    │
│  (Custom Hook)          │
├─────────────────────────┤
│ - Manages messages      │
│ - Handles optimistic    │
│ - Converts on ack       │
│ - WebSocket connection  │
│ - Exposes sendMessage() │
└────────┬────────────────┘
         │ Calls
         ↓
┌─────────────────┐
│  PromptInput    │
│  Component      │
└─────────────────┘
```

**State Flow:**
```
User sends message
  ↓
MessageListState.sendMessage(content)
  ↓
1. Generate client ID: msg_1234567890
2. Add optimistic message with status: 'pending'
3. Send via WebSocket with client ID
  ↓
Server immediately sends ack
  ↓
MessageListState receives ack
  ↓
4. Convert message: client ID → server ID
5. Update status: 'pending' → 'confirmed'
  ↓
Server streams response
  ↓
6. Add streaming message
7. Update streaming content
8. Mark complete on done
```

**Hook Interface:**
```typescript
interface MessageListState {
  // State (read-only)
  messages: DisplayMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  
  // Actions
  sendMessage: (content: string) => void;
  reconnect: () => void;
  clearError: () => void;
}

interface DisplayMessage extends Message {
  status: 'pending' | 'confirmed' | 'streaming' | 'completed';
  serverId?: string;  // For pending messages
}

function useMessageListState(sessionId: string | null): MessageListState;
```

**Hook Implementation:**
```typescript
function useMessageListState(sessionId: string | null) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Connect to WebSocket
  useEffect(() => {
    if (!sessionId) return;
    
    const ws = new WebSocket(`ws://localhost:3001/ws?sessionId=${sessionId}`);
    wsRef.current = ws;
    
    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'connected':
          // Connection established
          break;
          
        case 'history':
          // Replace with server history
          setMessages(data.messages.map(m => ({ ...m, status: 'completed' })));
          break;
          
        case 'ack':
          // Convert pending → confirmed
          setMessages(prev => prev.map(m => 
            m.id === data.messageId 
              ? { ...m, id: data.serverId, serverId: undefined, status: 'confirmed' }
              : m
          ));
          break;
          
        case 'content':
          // Update streaming message
          setMessages(prev => prev.map(m => 
            m.id === 'streaming' 
              ? { ...m, content: m.content + data.content }
              : m
          ));
          break;
          
        case 'done':
          // Mark streaming as complete
          setIsStreaming(false);
          setMessages(prev => prev.map(m => 
            m.id === 'streaming' 
              ? { ...m, id: data.messageId, status: 'completed' }
              : m
          ));
          break;
          
        case 'error':
          setError(data.error);
          setIsStreaming(false);
          break;
      }
    };
    
    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect logic...
    };
    
    return () => ws.close();
  }, [sessionId]);
  
  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const clientMsgId = `msg_${Date.now()}`;
    
    // Add optimistic message
    setMessages(prev => [...prev, {
      id: clientMsgId,
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'pending'
    }]);
    
    // Send to server
    wsRef.current.send(JSON.stringify({
      type: 'message',
      id: clientMsgId,
      content,
      timestamp: Date.now()
    }));
  }, []);
  
  return {
    messages,
    isConnected,
    isStreaming,
    error,
    sendMessage,
    reconnect: () => { /* reconnect logic */ },
    clearError: () => setError(null)
  };
}
```

**Component Usage:**
```typescript
// MessageList Component (just subscribes and renders)
function MessageList() {
  const { messages, isStreaming } = useMessageListState(sessionId);
  
  return (
    <Box>
      {messages.map(msg => (
        <MessageItem 
          key={msg.id}
          message={msg}
          isPending={msg.status === 'pending'}
          isStreaming={msg.status === 'streaming'}
        />
      ))}
      {isStreaming && <LoadingIndicator />}
    </Box>
  );
}

// PromptInput Component (calls sendMessage)
function PromptInput() {
  const { sendMessage, isStreaming } = useMessageListState(sessionId);
  const [input, setInput] = useState('');
  
  const handleSubmit = () => {
    sendMessage(input);
    setInput('');
  };
  
  return (
    <Box>
      <TextField 
        value={input}
        onChange={e => setInput(e.target.value)}
        disabled={isStreaming}
      />
      <Button onClick={handleSubmit} disabled={!input.trim() || isStreaming}>
        Send
      </Button>
    </Box>
  );
}

// SessionProvider (provides sessionId)
function SessionProvider({ children }) {
  const [currentSession, setCurrentSession] = useState(null);
  
  return (
    <SessionContext.Provider value={{ currentSession }}>
      {children}
    </SessionContext.Provider>
  );
}
```

**Benefits:**
- ✅ **Separation of concerns:** MessageList just renders, PromptInput just sends
- ✅ **Encapsulated logic:** WebSocket, optimistic updates, acknowledgments all in hook
- ✅ **Testable:** Can test hook in isolation
- ✅ **Reusable:** Any component can use the hook
- ✅ **No state reconciliation:** Client ID maps to server ID via acknowledgment
- ✅ **Instant feedback:** Optimistic updates appear immediately
- ✅ **Server is source of truth:** History replaces state on connect

---

### 5. Backend Architecture

**Decision:** WebSocket server attached to Express HTTP server with immediate acknowledgment

**Server Structure:**
```
apps/server/src/
├── index.ts              # Express + HTTP server
├── ws/
│   ├── index.ts          # WebSocket handler
│   └── SessionManager.ts # Connection tracking
├── routes/
│   ├── sessions.ts       # REST API (for CRUD)
│   └── completion.ts     # REST API (keep for fallback)
└── sessions/
    └── storage.ts        # File-based storage
```

**WebSocket Handler with Acknowledgment:**
```typescript
class WebSocketHandler {
  private connections = new Map<string, SessionConnection>();

  onConnection(ws, sessionId) {
    // Send connection acknowledgment first
    ws.send(JSON.stringify({ 
      type: 'connected', 
      sessionId 
    }));
    
    // Then load and send history
    getMessages(sessionId).then(messages => {
      ws.send(JSON.stringify({ type: 'history', messages }));
    });
    
    // Track connection
    connections.set(sessionId, { ws, sessionId, isStreaming: false });
  }

  async onMessage(connection, data) {
    const { ws, sessionId } = connection;
    const message = JSON.parse(data.toString());
    
    if (message.type !== 'message') {
      ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      return;
    }
    
    const { id: clientMsgId, content, timestamp } = message;
    
    // Generate server message ID
    const serverMsgId = generateMessageId();
    
    // IMMEDIATELY send acknowledgment (before saving)
    ws.send(JSON.stringify({
      type: 'ack',
      messageId: clientMsgId,
      serverId: serverMsgId,
      timestamp: Date.now()
    }));
    
    // Then save message (async, doesn't block)
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
    this.streamLLM(messages, connection);
  }

  private async streamLLM(messages: Message[], connection: SessionConnection) {
    const { ws, sessionId } = connection;
    connection.isStreaming = true;
    
    try {
      const result = await qwenProvider.complete(messages, { stream: true });
      
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
        id: generateMessageId(),
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
        error: error.message,
      }));
    } finally {
      connection.isStreaming = false;
    }
  }
}
```

**Key Design Decisions:**

1. **Immediate Acknowledgment:**
   - Ack sent **before** saving to storage
   - Client doesn't wait for disk I/O
   - Reduces perceived latency
   - Server assumes save will succeed (if fails, send error later)

2. **Client ID → Server ID Mapping:**
   - Client generates temporary ID for optimistic update
   - Server responds with permanent ID in acknowledgment
   - Client converts: `msg_client_123` → `msg_003`
   - No need to replace entire message array

3. **Async Save:**
   - Ack sent synchronously
   - Save happens asynchronously
   - If save fails, send error message
   - Client can retry or show error

4. **Connection Tracking:**
   - Map sessionId → Connection
   - Track streaming state per connection
   - Prevent concurrent streams
   - Enable targeted notifications

---

## Implementation Checklist

### Backend Implementation

- [ ] **1.1** Add `ws` package to dependencies
  ```bash
  npm install ws @types/ws
  ```

- [ ] **1.2** Create WebSocket server (`apps/server/src/ws/index.ts`)
  - [ ] WebSocketServer attached to HTTP server
  - [ ] Connection handler with sessionId validation
  - [ ] Message handler (parse JSON, route by type)
  - [ ] History loading on connect
  - [ ] Streaming response to client
  - [ ] Error handling and cleanup

- [ ] **1.3** Integrate WebSocket with Express
  - [ ] Create HTTP server in `index.ts`
  - [ ] Attach WebSocketHandler to server
  - [ ] Log WebSocket URL on startup

- [ ] **1.4** Update session storage
  - [ ] Ensure `getMessages()` is efficient
  - [ ] Add connection cleanup on session delete
  - [ ] Notify active connections on session changes

- [ ] **1.5** Add rate limiting for WebSocket
  - [ ] Track messages per second per connection
  - [ ] Disconnect on abuse
  - [ ] Send rate limit warnings

---

### Frontend Implementation

- [ ] **2.1** Create WebSocket client (`apps/web/src/api/websocket.ts`)
  - [ ] SessionWebSocket class
  - [ ] Connect with sessionId
  - [ ] Message handlers (history, content, done, error)
  - [ ] Automatic reconnection with exponential backoff
  - [ ] Message queueing during disconnection
  - [ ] Disconnect cleanup

- [ ] **2.2** Update SessionContext
  - [ ] Add `ws` field to state
  - [ ] Create WebSocket on loadSession
  - [ ] Handle history messages (replace state)
  - [ ] Handle streaming updates (append content)
  - [ ] Handle completion (mark done)
  - [ ] Handle errors (show toast)
  - [ ] Cleanup on session switch/unmount

- [ ] **2.3** Update sendMessage flow
  - [ ] Optimistic update (add to UI immediately)
  - [ ] Send via WebSocket
  - [ ] Wait for server history to reconcile
  - [ ] Handle streaming response
  - [ ] Remove duplicate API calls

- [ ] **2.4** Add connection status indicator
  - [ ] Show "Connecting..." when establishing
  - [ ] Show "Connected" with green dot
  - [ ] Show "Reconnecting..." on disconnect
  - [ ] Show "Offline" after max retries
  - [ ] Tooltip with connection details

- [ ] **2.5** Handle edge cases
  - [ ] Multiple tabs with same session
  - [ ] Network disconnection during stream
  - [ ] Server restart
  - [ ] Session not found
  - [ ] Concurrent message sending

---

### Testing & Validation

- [ ] **3.1** Test WebSocket connection
  - [ ] Connect to new session
  - [ ] Verify history received
  - [ ] Verify messages display correctly

- [ ] **3.2** Test message flow
  - [ ] Send message, verify appears instantly (optimistic)
  - [ ] Verify server history replaces optimistic
  - [ ] Verify streaming works
  - [ ] Verify completion message received

- [ ] **3.3** Test reconnection
  - [ ] Kill server, verify reconnection attempts
  - [ ] Restart server, verify auto-reconnect
  - [ ] Verify queued messages sent on reconnect

- [ ] **3.4** Test performance
  - [ ] Send 10 rapid messages
  - [ ] Verify no duplicates
  - [ ] Verify queue works correctly
  - [ ] Measure latency (should be <100ms)

- [ ] **3.5** Test error handling
  - [ ] Invalid sessionId
  - [ ] Network error during stream
  - [ ] Server error (500)
  - [ ] Rate limiting

---

### Documentation

- [ ] **4.1** Update Phase2.md
  - [ ] Mark Phase 2 as superseded by Phase 2a
  - [ ] Link to Phase2a.md
  - [ ] Note WebSocket migration

- [ ] **4.2** Document WebSocket protocol
  - [ ] Message types
  - [ ] Connection lifecycle
  - [ ] Error codes
  - [ ] Reconnection strategy

- [ ] **4.3** Update README
  - [ ] Document WebSocket requirement
  - [ ] Add troubleshooting for connection issues

---

## Dependencies

**Backend:**
```json
{
  "dependencies": {
    "ws": "^8.x",
    "@types/ws": "^8.x"
  }
}
```

**Frontend:**
- No new dependencies (native WebSocket API)

---

## Environment Variables

No new environment variables needed.

---

## Migration from Phase 2

### Breaking Changes

**API Changes:**
- ❌ `POST /api/complete/stream` → Deprecated (keep for fallback)
- ✅ `ws://localhost:3001/ws` → New primary interface
- ✅ `GET /api/sessions/:id/messages` → Still used for initial load (optional)

**Client Changes:**
- SessionContext now manages WebSocket connection
- sendMessage() no longer calls REST API directly
- State reconciliation happens via WebSocket history events

### Backward Compatibility

- Keep REST endpoints for clients that don't support WebSocket
- Fallback to SSE if WebSocket unavailable
- Session storage format unchanged

---

## Performance Benchmarks

**Target Metrics:**

| Metric | Phase 2 (REST) | Phase 2a (WebSocket) | Improvement |
|--------|----------------|----------------------|-------------|
| History transfer | ~5KB per message | ~5KB once | 99% reduction |
| Message latency | ~200ms | ~50ms | 4x faster |
| API calls per message | 2 (save + stream) | 1 (WebSocket send) | 50% reduction |
| Connection overhead | HTTP handshake each | None after connect | Significant |
| Concurrent messages | Queue manually | Built-in queue | Better UX |

---

## Exit Criteria

Phase 2a is complete when:

- [ ] WebSocket server running and accepting connections
- [ ] Client connects on session load
- [ ] History sent once on connect
- [ ] Subsequent messages don't resend history
- [ ] Optimistic updates work (instant UI feedback)
- [ ] Streaming responses display in real-time
- [ ] Automatic reconnection works (exponential backoff)
- [ ] Message queueing works during disconnection
- [ ] Connection status indicator visible
- [ ] All Phase 2 features still work
- [ ] No duplicate messages or race conditions
- [ ] Performance benchmarks met
- [ ] Error handling complete
- [ ] Documentation updated
- [ ] Code reviewed and merged

---

## Example User Flows

### Flow 1: New Session with WebSocket

**User Actions:**
1. Clicks "New Session"
2. Session created via REST API
3. WebSocket connects: `ws://localhost:3001/ws?sessionId=abc123`
4. Server sends: `{ type: "history", messages: [] }` (empty)
5. Client displays empty chat
6. User types: "Create a landing page"
7. Client adds optimistic message to UI
8. Client sends via WebSocket
9. Server saves, calls LLM, streams response
10. Client receives history (reconciles optimistic)
11. Client receives streaming chunks
12. Client receives done message
13. Connection persists for next message

**Behind the Scenes:**
- `POST /api/sessions` → Creates session
- `new WebSocket('/ws?sessionId=abc123')` → Connects
- Server: `getMessages(sessionId)` → Returns []
- Server: `ws.send({ type: 'history', messages: [] })`
- Client: `ws.send({ type: 'message', content: '...' })`
- Server: Saves message, calls LLM
- Server: Streams chunks via WebSocket
- Server: Saves assistant message
- Server: Sends `{ type: 'done' }`

---

### Flow 2: Rapid Fire Messages

**User Actions:**
1. Sends message A
2. Immediately sends message B (before A completes)
3. Immediately sends message C
4. Waits for responses

**Behind the Scenes:**
```
Client: Send A → ws.send()
Server: Receive A → Processing...
Client: Send B → Queue (isStreaming=true)
Client: Send C → Queue (isStreaming=true)

Server: Stream A response → Client displays
Server: Done A → Client marks complete

Client: Flush queue → Send B
Server: Receive B → Processing...
Server: Stream B response → Client displays
Server: Done B → Client marks complete

Client: Flush queue → Send C
... (repeat)
```

**Expected Behavior:**
- Messages queued on client
- Sent sequentially to server
- No race conditions
- Responses displayed in order

---

### Flow 3: Network Disconnection

**User Actions:**
1. Working on session
2. WiFi disconnects
3. User sends message (offline)
4. WiFi reconnects
5. Message sent automatically

**Behind the Scenes:**
```
Client: WebSocket closes
Client: Set status "Disconnected"
Client: Queue message (ws not open)

Client: Reconnection attempt 1 (1s delay) → Failed
Client: Reconnection attempt 2 (2s delay) → Failed
Client: Reconnection attempt 3 (4s delay) → Success!

Client: WebSocket opens
Client: Flush queue → Send queued messages
Server: Receive messages, process normally
Client: Set status "Connected"
```

**Expected Behavior:**
- User sees "Reconnecting..." indicator
- Messages queued, not lost
- Auto-reconnect on network recovery
- No user action required

---

## Notes for Phase 3

Phase 3 will build on WebSocket foundation:

- **Code Generation:** Stream generated code over WebSocket
- **Live Preview:** Push preview updates via WebSocket
- **Collaboration:** Multiple clients in same session
- **Presence:** Show who's viewing/editing
- **Notifications:** Push rate limits, errors, completions

WebSocket enables real-time features that REST cannot support efficiently.

---

## Appendix: WebSocket Message Examples

### Complete Conversation Session

```
Client → Server: Connect (ws://localhost:3001/ws?sessionId=abc123)

Server → Client: {
  "type": "connected",
  "sessionId": "abc123"
}

Server → Client: {
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

Client → Server: {
  "type": "message",
  "content": "Make it more modern"
}

Server → Client: {
  "type": "content",
  "content": "Here"
}

Server → Client: {
  "type": "content",
  "content": "'s"
}

Server → Client: {
  "type": "content",
  "content": " a more modern version..."
}

Server → Client: {
  "type": "done",
  "messageId": "msg_003",
  "timestamp": 1705312225000
}
```

### Error Scenarios

**Rate Limit:**
```
Server → Client: {
  "type": "error",
  "error": "Rate limit exceeded",
  "retryAfter": 60000
}
```

**Session Not Found:**
```
Server → Client: {
  "type": "error",
  "error": "Session not found"
}
Connection closed
```

**LLM Error:**
```
Server → Client: {
  "type": "error",
  "error": "LLM unavailable, please try again"
}
```

---

## Implementation Timeline

| Task | Estimated Time |
|------|----------------|
| Backend: WebSocket server | 0.5 day |
| Backend: Message handlers | 0.5 day |
| Backend: Integration with Express | 0.25 day |
| Frontend: WebSocket client | 0.5 day |
| Frontend: SessionContext update | 0.5 day |
| Frontend: Connection status UI | 0.25 day |
| Testing: Connection scenarios | 0.5 day |
| Testing: Error handling | 0.5 day |
| Testing: Performance | 0.25 day |
| Documentation | 0.25 day |
| **Total** | **3.5 days** |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket blocked by firewall | High | Fallback to SSE/REST |
| Server scaling complexity | Medium | Use Redis adapter when needed |
| Connection state management | Medium | Keep stateless, store in DB |
| Memory leaks from connections | Low | Proper cleanup on close |
| Browser compatibility | Low | WebSocket supported everywhere |

---

## Success Metrics

**Technical:**
- ✅ 99% WebSocket connection success rate
- ✅ <100ms message latency (p95)
- ✅ <5s reconnection time after network loss
- ✅ Zero duplicate messages
- ✅ Zero race conditions

**User Experience:**
- ✅ Messages appear instantly (optimistic)
- ✅ Streaming feels responsive
- ✅ Reconnection is seamless
- ✅ No user-visible errors

**Performance:**
- ✅ 99% reduction in history transfer
- ✅ 4x faster message latency
- ✅ 50% reduction in API calls

---

**Phase 2a represents a significant architectural improvement over Phase 2, enabling real-time features while simplifying the codebase and improving performance.**
