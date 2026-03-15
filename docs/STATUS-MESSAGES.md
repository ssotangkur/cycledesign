# Status Messages Reference

**Last Updated:** March 11, 2026

This document provides a comprehensive reference for all status message types used in the CycleDesign WebSocket architecture.

---

## Overview

Status messages are real-time updates broadcast from the server to connected clients during AI generation, tool execution, validation, and preview operations. They provide visibility into the system's internal state and progress.

### Message Format

All status messages follow this WebSocket protocol format:

```typescript
{
  type: 'status';
  status: StatusType;        // The type of status (see below)
  messageId: string;         // Unique identifier for the generation session
  tool?: string;             // Tool name (for tool_call_* statuses)
  details: string;           // Human-readable description
  timestamp: number;         // Unix timestamp in milliseconds
}
```

---

## Generation Status

Status messages related to AI generation lifecycle.

### `generation_start`

**When Sent:** When the AI begins processing a user's message.

**Payload:**
```typescript
{
  type: 'status',
  status: 'generation_start',
  messageId: 'msg_123',
  details: 'Starting generation...',
  timestamp: 1710123456789
}
```

**Client Handling:** Display a loading indicator or "AI is thinking..." message.

---

### `generation_thinking`

**When Sent:** During LLM inference, typically when the model is processing the prompt.

**Payload:**
```typescript
{
  type: 'status',
  status: 'generation_thinking',
  messageId: 'msg_123',
  details: 'Processing request...',
  timestamp: 1710123456890
}
```

**Client Handling:** Show a subtle progress indicator. May be sent multiple times during long inference.

---

### `generation_complete`

**When Sent:** When the AI response is fully generated and ready.

**Payload:**
```typescript
{
  type: 'status',
  status: 'generation_complete',
  messageId: 'msg_123',
  details: 'Generation complete',
  timestamp: 1710123457000
}
```

**Client Handling:** Clear loading indicators, enable input field for next message.

---

## Tool Call Status

Status messages for tool execution during AI-assisted code generation.

### `tool_call_start`

**When Sent:** Immediately before a tool begins execution.

**Payload:**
```typescript
{
  type: 'status',
  status: 'tool_call_start',
  messageId: 'msg_123',
  tool: 'create_file',
  details: 'Creating landing-page.tsx...',
  timestamp: 1710123456789
}
```

**Common Tool Names:**
- `create_file` - Creating a new design file
- `edit_file` - Modifying an existing file
- `rename_file` - Renaming a file
- `delete_file` - Deleting a file
- `add_dependency` - Installing an npm package
- `submit_work` - Triggering validation pipeline
- `ask_user` - Requesting user input

**Client Handling:** Display an info badge with the tool name and details.

---

### `tool_call_complete`

**When Sent:** After a tool successfully completes execution.

**Payload:**
```typescript
{
  type: 'status',
  status: 'tool_call_complete',
  messageId: 'msg_123',
  tool: 'create_file',
  details: 'File created: landing-page.tsx',
  timestamp: 1710123456890
}
```

**Client Handling:** Display a success badge. May be followed by additional tool calls or validation.

---

### `tool_call_error`

**When Sent:** After a tool fails to execute.

**Payload:**
```typescript
{
  type: 'status',
  status: 'tool_call_error',
  messageId: 'msg_123',
  tool: 'create_file',
  details: 'Failed to create file: permission denied',
  timestamp: 1710123456890
}
```

**Client Handling:** Display an error badge. The AI may retry or ask for clarification.

---

## Validation Status

Status messages for the validation pipeline that runs after code generation.

### `validation_start`

**When Sent:** When a validation stage begins. May be sent multiple times for different stages.

**Payload:**
```typescript
{
  type: 'status',
  status: 'validation_start',
  messageId: 'msg_123',
  details: 'Running dependency check...',
  timestamp: 1710123456789
}
```

**Validation Stages:**
1. `dependency check` - Verifies npm packages are installed
2. `TypeScript compilation` - Checks for type errors
3. `ESLint check` - Validates code style
4. `ID injection` - Injects unique IDs for testing

**Client Handling:** Display a progress indicator with the current stage name.

---

### `validation_complete`

**When Sent:** When all validation stages pass successfully.

**Payload:**
```typescript
{
  type: 'status',
  status: 'validation_complete',
  messageId: 'msg_123',
  details: 'All validations passed',
  timestamp: 1710123457000
}
```

**Client Handling:** Display a success badge. Preview server should be starting.

---

### `validation_error`

**When Sent:** When any validation stage fails.

**Payload:**
```typescript
{
  type: 'status',
  status: 'validation_error',
  messageId: 'msg_123',
  details: 'TypeScript error: landing-page.tsx:42 - Property does not exist',
  timestamp: 1710123457000
}
```

**Client Handling:** Display an error badge with details. The AI may attempt to fix the errors.

---

## Preview Status

Status messages for the preview server that hosts generated designs.

### `preview_start`

**When Sent:** When the preview server is starting up.

**Payload:**
```typescript
{
  type: 'status',
  status: 'preview_start',
  messageId: 'msg_123',
  details: 'Starting preview server...',
  timestamp: 1710123457000
}
```

**Client Handling:** Display a loading indicator. Preview will be available shortly.

---

### `preview_ready`

**When Sent:** When the preview server is running and accessible.

**Payload:**
```typescript
{
  type: 'status',
  status: 'preview_ready',
  messageId: 'msg_123',
  details: 'Preview ready at http://localhost:3002',
  timestamp: 1710123457100
}
```

**Client Handling:** Display a success badge. Enable preview panel or link to view the design.

---

### `preview_error`

**When Sent:** When the preview server fails to start.

**Payload:**
```typescript
{
  type: 'status',
  status: 'preview_error',
  messageId: 'msg_123',
  details: 'Preview failed to start: port already in use',
  timestamp: 1710123457100
}
```

**Client Handling:** Display an error badge. User may need to retry or resolve port conflicts.

---

## Status Message Flow

### Typical Generation Flow

```
User sends message
    ↓
generation_start
    ↓
generation_thinking (optional, may repeat)
    ↓
tool_call_start (if tools are called)
    ↓
tool_call_complete (or tool_call_error)
    ↓
[Repeat tool calls as needed]
    ↓
submit_work tool called
    ↓
validation_start (dependency check)
    ↓
validation_start (TypeScript compilation)
    ↓
validation_start (ESLint check)
    ↓
validation_start (ID injection)
    ↓
validation_complete (or validation_error)
    ↓
preview_start
    ↓
preview_ready (or preview_error)
    ↓
generation_complete
```

### Error Recovery Flow

```
tool_call_start
    ↓
tool_call_error
    ↓
generation_thinking (AI decides to retry)
    ↓
tool_call_start (retry)
    ↓
tool_call_complete
    ↓
[Continue normal flow]
```

---

## Client-Side Implementation

### TypeScript Types

```typescript
export type StatusType =
  | 'generation_start'
  | 'generation_thinking'
  | 'generation_complete'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'tool_call_error'
  | 'validation_start'
  | 'validation_complete'
  | 'validation_error'
  | 'preview_start'
  | 'preview_ready'
  | 'preview_error';

export interface StatusMessage {
  type: 'status';
  status: StatusType;
  messageId: string;
  tool?: string;
  details: string;
  timestamp: number;
}
```

### React Hook Example

```typescript
// apps/web/src/hooks/useMessageListState.ts
export function useMessageListState(sessionId: string | null) {
  const [currentStatus, setCurrentStatus] = useState<StatusMessage | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const ws = new SessionWebSocket(sessionId);
    
    ws.onStatus = (status: StatusMessage) => {
      setCurrentStatus(status);
      
      // Clear status after a delay for non-error statuses
      if (!status.status.includes('_error')) {
        setTimeout(() => setCurrentStatus(null), 3000);
      }
    };

    return () => ws.close();
  }, [sessionId]);

  return { currentStatus, /* ... */ };
}
```

### UI Component Example

```tsx
// apps/web/src/components/status/StatusDisplay.tsx
import { Box, Chip, CircularProgress } from '@mui/material';

interface StatusDisplayProps {
  status: StatusMessage | null;
}

export function StatusDisplay({ status }: StatusDisplayProps) {
  if (!status) return null;

  const getColor = () => {
    if (status.status.includes('_start')) return 'info';
    if (status.status.includes('_complete') || status.status.includes('_ready')) return 'success';
    if (status.status.includes('_error')) return 'error';
    return 'default';
  };

  const getIcon = () => {
    if (status.status.includes('_start')) return <CircularProgress size={16} />;
    if (status.status.includes('_complete') || status.status.includes('_ready')) return <CheckCircleIcon />;
    if (status.status.includes('_error')) return <ErrorIcon />;
    return null;
  };

  return (
    <Box sx={{ py: 1, px: 2, bgcolor: 'action.hover', borderRadius: 1, my: 1 }}>
      <Chip
        icon={getIcon()}
        label={`${status.tool ? `${status.tool}: ` : ''}${status.details}`}
        color={getColor() as any}
        size="small"
        variant="outlined"
      />
    </Box>
  );
}
```

---

## Server-Side Broadcasting

### Using StatusBroadcaster

```typescript
import { statusBroadcaster } from '../features/status/StatusBroadcaster.js';

// Send a custom status
statusBroadcaster.sendStatus(messageId, {
  status: 'generation_start',
  details: 'Starting generation...',
});

// Send tool call status
statusBroadcaster.sendToolCallStart(messageId, 'create_file', 'Creating file...');
statusBroadcaster.sendToolCallComplete(messageId, 'create_file', 'File created');
statusBroadcaster.sendToolCallError(messageId, 'create_file', 'Permission denied');

// Send validation status
statusBroadcaster.sendValidationStart(messageId, 'TypeScript compilation');
statusBroadcaster.sendValidationComplete(messageId);
statusBroadcaster.sendValidationError(messageId, 'Type error on line 42');

// Send preview status
statusBroadcaster.sendPreviewStart(messageId);
statusBroadcaster.sendPreviewReady(messageId, 3002);
statusBroadcaster.sendPreviewError(messageId, 'Port in use');
```

### Using WebSocketBridge

```typescript
import { webSocketBridge } from '../features/status/WebSocketBridge.js';

// Register a session (call when message processing starts)
webSocketBridge.registerSession(messageId, sessionId);

// Broadcast status to the session
webSocketBridge.broadcastStatus(sessionId, messageId, {
  status: 'generation_start',
  details: 'Starting...',
  timestamp: Date.now(),
});

// Unregister when done
webSocketBridge.unregisterSession(messageId);
```

---

## Best Practices

### For Server Developers

1. **Always send start and end statuses** for long-running operations
2. **Include meaningful details** that help users understand what's happening
3. **Use appropriate status types** - don't misuse `tool_call_error` for validation errors
4. **Broadcast early** - send status before starting the operation, not after
5. **Clean up sessions** - call `unregisterSession()` when message processing completes

### For Client Developers

1. **Handle all status types** - even if you don't display them all
2. **Clear statuses appropriately** - error statuses should persist until dismissed
3. **Show progress indicators** for `_start` statuses
4. **Provide visual feedback** with colors (info=blue, success=green, error=red)
5. **Don't block UI** - status messages are informational, not modal

---

## Troubleshooting

### Status Messages Not Appearing

1. Verify WebSocket connection is established
2. Check browser console for WebSocket errors
3. Ensure `statusBroadcaster.addClient()` is called on connection
4. Verify `messageId` to `sessionId` mapping in `WebSocketBridge`

### Status Messages Out of Order

1. Check for race conditions in tool execution
2. Ensure `await` is used for async operations
3. Verify status is sent before the operation starts, not after

### Duplicate Status Messages

1. Check for multiple `statusBroadcaster.send*()` calls
2. Verify event subscriptions aren't duplicated
3. Ensure `WebSocketBridge.subscribe()` is called only once

---

## Related Documentation

- [WebSocket Migration Plan](./WEBSOCKET-MIGRATION.md) - Architecture overview
- [Tool Calling Specification](./TOOL_CALLING.md) - Tool definitions and usage
- [WebSocket Protocol](./WEBSOCKET_PROTOCOL.md) - Full protocol specification
