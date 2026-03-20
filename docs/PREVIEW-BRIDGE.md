# Preview Communication Bridge

**Last Updated:** March 2026  
**Related Documents:** [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Message Protocol](#message-protocol)
4. [Implementation Details](#implementation-details)
5. [Cross-Origin Security](#cross-origin-security)
6. [Use Cases](#use-cases)
7. [Files Involved](#files-involved)

---

## Overview

### Purpose

The Preview Communication Bridge enables real-time, cross-origin communication between the **Tool UI** (running on `http://localhost:3000`) and the **Preview Iframe** (running on `http://localhost:3002`). This bridge is essential for:

- **Mode Synchronization**: Switching between select, preview, and audit modes
- **Component Selection**: Capturing user clicks on components within the preview
- **Visual Feedback**: Highlighting selected components in the preview
- **Error Reporting**: Propagating runtime errors from the preview to the tool UI

### Architecture Context

The bridge uses the browser's `postMessage` API to facilitate secure communication across different origins. This is necessary because:

1. The preview runs in an isolated Vite development server (port 3002)
2. The tool UI runs on a separate development server (port 3000)
3. Cross-origin isolation prevents direct DOM access between frames
4. `postMessage` provides a secure, asynchronous messaging protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                  Tool Frontend (React + MUI)                    │
│  Origin: http://localhost:3000                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  PreviewFrame.tsx                                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  iframe (sandboxed)                                 │  │  │
│  │  │  Origin: http://localhost:3002                      │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │  Preview Vite App                             │  │  │  │
│  │  │  │  - main.tsx (entry point)                     │  │  │  │
│  │  │  │  - @design/app (loaded design)                │  │  │  │
│  │  │  │  - SelectionBox wrappers                      │  │  │  │
│  │  │  │  - AuditWrapper wrappers                      │  │  │  │
│  │  │  │  - usePostMessage hook                        │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                    useIframeBridge hook                         │
│                    (message queue, event listeners)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                    postMessage API
                    (window.postMessage)
                              │
                    ┌─────────▼─────────┐
                    │  Message Bridge   │
                    │  - Origin check   │
                    │  - Type safety    │
                    │  - Error handling │
                    └───────────────────┘
```

---

## Architecture

### Component Breakdown

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **PreviewFrame** | `apps/web/src/components/preview/PreviewFrame.tsx` | Parent component that renders the iframe and manages mode state |
| **useIframeBridge** | `apps/web/src/hooks/useIframeBridge.ts` | React hook for parent-side message handling with queuing |
| **usePostMessage** | `packages/design-system-runtime/src/hooks/usePostMessage.ts` | React hook for iframe-side message handling |
| **SelectionBox** | `packages/design-system-runtime/src/components/SelectionBox.tsx` | Wrapper component for click-to-select functionality |
| **AuditWrapper** | `packages/design-system-runtime/src/components/AuditWrapper.tsx` | Wrapper component for audit mode highlighting |

### Data Flow

```
User Action (Tool UI)
        ↓
┌───────────────────────┐
│  PreviewFrame.tsx     │  Parent component
│  - Mode toggle buttons│
│  - iframe element     │
└───────────────────────┘
        ↓
┌───────────────────────┐
│  useIframeBridge      │  Parent hook
│  - Message queue      │
│  - Origin validation  │
│  - Ready state        │
└───────────────────────┘
        ↓
┌───────────────────────┐
│  postMessage API      │  Cross-origin transport
│  window.postMessage() │
└───────────────────────┘
        ↓
┌───────────────────────┐
│  usePostMessage       │  Iframe hook
│  - Event listener     │
│  - Origin validation  │
│  - Message parsing    │
└───────────────────────┘
        ↓
┌───────────────────────┐
│  Wrapper Components   │  SelectionBox, AuditWrapper
│  - Visual feedback    │
│  - Click handlers     │
└───────────────────────┘
```

---

## Message Protocol

### TypeScript Interfaces

All message types are defined in two locations for type safety on both sides:

**Parent Side** (`apps/web/src/hooks/useIframeBridge.ts`):
```typescript
export type ParentMessage =
  | {
      type: 'SET_MODE';
      payload: { mode: 'select' | 'preview' | 'audit' };
    }
  | {
      type: 'HIGHLIGHT_COMPONENT';
      payload: { instanceId: string };
    }
  | {
      type: 'UPDATE_PROPS';
      payload: { instanceId: string; props: Record<string, unknown> };
    };

export type IframeMessage =
  | {
      type: 'MODE_READY';
      payload: { mode: string };
    }
  | {
      type: 'COMPONENT_SELECTED';
      payload: { instanceId: string; componentName: string };
    }
  | {
      type: 'ERROR';
      payload: { error: string };
    };
```

**Iframe Side** (`packages/design-system-runtime/src/hooks/usePostMessage.ts`):
```typescript
export type ParentToIframeMessage = SetModeMessage | HighlightComponentMessage;
export type IframeToParentMessage = IframeMessage | ComponentSelectedMessage | ErrorMessage;

export interface SetModeMessage {
  type: 'SET_MODE';
  payload: { mode: 'select' | 'preview' | 'audit' };
}

export interface HighlightComponentMessage {
  type: 'HIGHLIGHT_COMPONENT';
  payload: { instanceId: string };
}

export interface IframeMessage {
  type: 'MODE_READY';
  payload: { mode: string };
}

export interface ComponentSelectedMessage {
  type: 'COMPONENT_SELECTED';
  payload: { instanceId: string; componentName: string };
}

export interface ErrorMessage {
  type: 'ERROR';
  payload: { error: string };
}
```

### Message Types Reference

#### Parent → Iframe (Tool UI to Preview)

| Type | Payload | Description | When Sent |
|------|---------|-------------|-----------|
| `SET_MODE` | `{ mode: 'select' \| 'preview' \| 'audit' }` | Change the interaction mode | User clicks mode toggle button |
| `HIGHLIGHT_COMPONENT` | `{ instanceId: string }` | Highlight a specific component | User selects component from tool UI |
| `UPDATE_PROPS` | `{ instanceId: string; props: Record<string, unknown> }` | Update component props | User edits props in tool UI (future) |

#### Iframe → Parent (Preview to Tool UI)

| Type | Payload | Description | When Sent |
|------|---------|-------------|-----------|
| `MODE_READY` | `{ mode: string }` | Confirm mode change | After iframe processes `SET_MODE` |
| `COMPONENT_SELECTED` | `{ instanceId: string; componentName: string }` | Report component click | User clicks wrapped component |
| `ERROR` | `{ error: string }` | Report an error | Runtime error in preview |

---

## Implementation Details

### Parent Side (Tool UI)

#### useIframeBridge Hook

**File:** `apps/web/src/hooks/useIframeBridge.ts`

**Key Features:**
- Message queuing before iframe is ready
- Origin validation for security
- Automatic queue flush on `MODE_READY`
- Ready state tracking

**Implementation:**
```typescript
export function useIframeBridge({
  iframeRef,
  previewOrigin,
  onMessage,
}: UseIframeBridgeOptions): UseIframeBridgeReturn {
  const [isReady, setIsReady] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const messageQueueRef = useRef<ParentMessage[]>([]);
  const eventListenerAddedRef = useRef(false);

  // Send message with queuing
  const sendMessage = useCallback(
    (message: ParentMessage) => {
      if (!isReady || !iframeRef.current?.contentWindow) {
        // Queue message for later delivery
        messageQueueRef.current.push(message);
        setQueueSize(messageQueueRef.current.length);
        return;
      }
      iframeRef.current.contentWindow.postMessage(message, previewOrigin);
    },
    [isReady, iframeRef, previewOrigin]
  );

  // Listen for iframe messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Origin validation
      if (event.origin !== previewOrigin) {
        return;
      }

      const message = event.data as IframeMessage;

      // Type validation
      if (
        message.type !== 'MODE_READY' &&
        message.type !== 'COMPONENT_SELECTED' &&
        message.type !== 'ERROR'
      ) {
        return;
      }

      // Handle MODE_READY: flush queue
      if (message.type === 'MODE_READY') {
        setIsReady(true);

        if (messageQueueRef.current.length > 0) {
          const queue = [...messageQueueRef.current];
          messageQueueRef.current = [];
          setQueueSize(0);

          queue.forEach((queuedMessage) => {
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                queuedMessage,
                previewOrigin
              );
            }
          });
        }
      }

      onMessage?.(message);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [previewOrigin, onMessage, iframeRef]);

  // Reset on iframe reload
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setIsReady(false);
      messageQueueRef.current = [];
      setQueueSize(0);
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [iframeRef]);

  return { sendMessage, isReady, queueSize };
}
```

#### PreviewFrame Component

**File:** `apps/web/src/components/preview/PreviewFrame.tsx`

**Usage Pattern:**
```typescript
function PreviewFrame({ onComponentSelected, onModeReady }: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<Mode>('select');

  // Handle incoming messages
  const handleMessage = useCallback((message: IframeMessage) => {
    if (message.type === 'COMPONENT_SELECTED' && onComponentSelected) {
      onComponentSelected(message.payload.instanceId, message.payload.componentName);
    } else if (message.type === 'MODE_READY' && onModeReady) {
      onModeReady(message.payload.mode);
    }
  }, [onComponentSelected, onModeReady]);

  // Initialize bridge
  const { sendMessage } = useIframeBridge({
    iframeRef,
    previewOrigin: url ? new URL(url).origin : 'http://localhost:3002',
    onMessage: handleMessage,
  });

  // Send mode change
  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: Mode | null) => {
    if (newMode) {
      setMode(newMode);
      const message: ParentMessage = {
        type: 'SET_MODE',
        payload: { mode: newMode },
      };
      sendMessage(message);
    }
  };

  return (
    <iframe
      ref={iframeRef}
      src={url}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
```

### Iframe Side (Preview)

#### usePostMessage Hook

**File:** `packages/design-system-runtime/src/hooks/usePostMessage.ts`

**Key Features:**
- Origin validation against allowed list
- Message type filtering
- Error handling with fallback error reporting

**Implementation:**
```typescript
export function usePostMessage(config: PostMessageConfig) {
  const [lastMessage, setLastMessage] = useState<ParentToIframeMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Send message to parent
  const sendMessage = useCallback((message: IframeToParentMessage) => {
    try {
      window.parent.postMessage(message, config.targetOrigin);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      // Send error to parent
      const errorPayload: ErrorMessage = {
        type: 'ERROR',
        payload: { error: errorMessage },
      };
      window.parent.postMessage(errorPayload, config.targetOrigin);
    }
  }, [config.targetOrigin]);

  // Listen for parent messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Origin validation
      if (!config.allowedOrigins.includes(event.origin)) {
        return;
      }

      try {
        const message = event.data as ParentToIframeMessage;

        if (!message || !message.type) {
          return;
        }

        // Filter for relevant message types
        if (message.type === 'SET_MODE' || message.type === 'HIGHLIGHT_COMPONENT') {
          setLastMessage(message);
          setError(null);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to parse message';
        setError(errorMessage);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [config.allowedOrigins]);

  return { lastMessage, sendMessage, error };
}
```

#### SelectionBox Component

**File:** `packages/design-system-runtime/src/components/SelectionBox.tsx`

**Purpose:** Wraps components to enable click-to-select functionality in **select mode**.

```typescript
export function SelectionBox({ id, componentName, children }: SelectionBoxProps) {
  const { sendMessage } = usePostMessage({
    targetOrigin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
  });

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    sendMessage({
      type: 'COMPONENT_SELECTED',
      payload: {
        instanceId: id,
        componentName,
      },
    });
  };

  return (
    <Box
      sx={{
        display: 'inline-block',
        maxWidth: '100%',
        cursor: 'pointer',
        '&:hover': {
          outline: '1px dashed #1976d2',
          outlineOffset: '2px',
        },
      }}
      onClick={handleClick}
      data-component-id={id}
      data-component-name={componentName}
    >
      {children}
    </Box>
  );
}
```

#### AuditWrapper Component

**File:** `packages/design-system-runtime/src/components/AuditWrapper.tsx`

**Purpose:** Wraps components to enable highlighting in **audit mode**.

```typescript
export function AuditWrapper({ id, componentName, children }: AuditWrapperProps) {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [mode, setMode] = useState<'select' | 'preview' | 'audit'>('preview');
  const { sendMessage, lastMessage } = usePostMessage({
    targetOrigin: 'http://localhost:3000',
    allowedOrigins: ['http://localhost:3000'],
  });

  useEffect(() => {
    if (lastMessage?.type === 'SET_MODE') {
      const newMode = lastMessage.payload.mode;
      setMode(newMode);
      // Confirm mode change to parent
      sendMessage({
        type: 'MODE_READY',
        payload: { mode: newMode },
      });
    }

    if (lastMessage?.type === 'HIGHLIGHT_COMPONENT') {
      setIsHighlighted(lastMessage.payload.instanceId === id);
    }
  }, [lastMessage, id, sendMessage]);

  const shouldHighlight = isHighlighted && mode === 'audit';

  return (
    <Box
      sx={{
        border: shouldHighlight ? '2px solid #1976d2' : 'none',
        backgroundColor: shouldHighlight ? 'rgba(25, 118, 210, 0.1)' : 'transparent',
        transition: 'all 0.2s ease-in-out',
        display: 'inline-block',
        maxWidth: '100%',
      }}
      data-component-id={id}
      data-component-name={componentName}
    >
      {children}
    </Box>
  );
}
```

---

## Cross-Origin Security

### Origin Validation

Both sides implement strict origin validation:

**Parent Side (useIframeBridge):**
```typescript
if (event.origin !== previewOrigin) {
  return;  // Reject messages from unknown origins
}
```

**Iframe Side (usePostMessage):**
```typescript
if (!config.allowedOrigins.includes(event.origin)) {
  return;  // Reject messages from unknown origins
}
```

### Development Configuration

| Side | Origin | Allowed Origins |
|------|--------|-----------------|
| Parent (Tool UI) | `http://localhost:3000` | `http://localhost:3002` |
| Iframe (Preview) | `http://localhost:3002` | `http://localhost:3000` |

### Iframe Sandbox Attributes

```typescript
<iframe
  src={url}
  sandbox="allow-scripts allow-same-origin"
/>
```

**Sandbox Permissions:**
- `allow-scripts`: Required for React app execution
- `allow-same-origin`: Required for postMessage to work correctly
- **Not allowed:** `allow-forms`, `allow-popups`, `allow-top-navigation` (security)

### Production Considerations

For production deployment:

1. **HTTPS Required**: Both origins must use HTTPS
2. **Strict Origin Matching**: No wildcards or patterns
3. **CORS Headers**: Configure appropriate CORS headers on preview server
4. **Content Security Policy**: Add CSP headers to prevent XSS
5. **Message Signing**: Consider adding message authentication for sensitive operations

Example production configuration:
```typescript
const config = {
  targetOrigin: 'https://preview.example.com',
  allowedOrigins: ['https://app.example.com'],
};
```

---

## Use Cases

### 1. Mode Switching Flow

**Scenario:** User switches from "select" mode to "audit" mode.

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  User   │                    │  Tool   │                    │ Iframe  │
│         │                    │  UI     │                    │         │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │ Click "Audit" button        │                              │
     ├─────────────────────────────>│                              │
     │                              │                              │
     │                              │ SET_MODE { mode: 'audit' }  │
     │                              ├─────────────────────────────>│
     │                              │                              │
     │                              │                              │ Process mode change
     │                              │                              │
     │                              │ MODE_READY { mode: 'audit' }│
     │                              │<─────────────────────────────┤
     │                              │                              │
     │                              │ Update UI state              │
     │                              │                              │
     │ Mode indicator updates       │                              │
     │<─────────────────────────────┤                              │
     │                              │                              │
```

**Sequence:**
1. User clicks "Audit" toggle button in `PreviewFrame`
2. `handleModeChange` creates `SET_MODE` message
3. `sendMessage` sends message via `postMessage`
4. Iframe's `usePostMessage` receives message
5. `AuditWrapper` components update internal mode state
6. Iframe sends `MODE_READY` confirmation
7. Tool UI updates mode indicator

---

### 2. Component Selection Flow

**Scenario:** User clicks a component in the preview to select it.

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  User   │                    │  Tool   │                    │ Iframe  │
│         │                    │  UI     │                    │         │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │ Click component              │                              │
     ├────────────────────────────────────────────────────────────>│
     │                              │                              │
     │                              │                              │ SelectionBox.handleClick
     │                              │                              │
     │                              │ COMPONENT_SELECTED           │
     │                              │ { instanceId, componentName }│
     │                              │<─────────────────────────────┤
     │                              │                              │
     │                              │ onComponentSelected()        │
     │                              │                              │
     │ Component selected in UI     │                              │
     │<─────────────────────────────┤                              │
     │                              │                              │
```

**Sequence:**
1. User clicks a component wrapped in `SelectionBox`
2. `handleClick` stops event propagation
3. `SelectionBox` sends `COMPONENT_SELECTED` message
4. Parent's `handleMessage` receives message
5. `onComponentSelected` callback fires
6. Tool UI updates selection state

---

### 3. Highlighting Flow

**Scenario:** Tool UI highlights a component in audit mode.

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  User   │                    │  Tool   │                    │ Iframe  │
│         │                    │  UI     │                    │         │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │ Select component from list  │                              │
     ├─────────────────────────────>│                              │
     │                              │                              │
     │                              │ HIGHLIGHT_COMPONENT          │
     │                              │ { instanceId: 'btn-123' }   │
     │                              ├─────────────────────────────>│
     │                              │                              │
     │                              │                              │ AuditWrapper receives
     │                              │                              │
     │                              │                              │ Set isHighlighted=true
     │                              │                              │
     │ Visual highlight appears     │                              │
     │<────────────────────────────────────────────────────────────┤
     │                              │                              │
```

**Sequence:**
1. User selects component from tool UI list
2. Tool UI sends `HIGHLIGHT_COMPONENT` message
3. All `AuditWrapper` components receive message
4. Matching component (by `instanceId`) sets `isHighlighted = true`
5. Component renders with blue border and background

---

### 4. Error Handling Flow

**Scenario:** Runtime error occurs in preview iframe.

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  User   │                    │  Tool   │                    │ Iframe  │
│         │                    │  UI     │                    │         │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │ Trigger error                │                              │
     ├────────────────────────────────────────────────────────────>│
     │                              │                              │
     │                              │                              │ Error caught
     │                              │                              │
     │                              │ ERROR { error: '...' }      │
     │                              │<─────────────────────────────┤
     │                              │                              │
     │                              │ Log error / Show toast       │
     │                              │                              │
     │ Error notification shown     │                              │
     │<─────────────────────────────┤                              │
     │                              │                              │
```

**Sequence:**
1. Error occurs in preview (e.g., component throws)
2. Error boundary or hook catches error
3. `usePostMessage.sendMessage` sends `ERROR` message
4. Parent receives and logs error
5. Tool UI displays error notification

---

## Files Involved

### Core Bridge Files

| File | Purpose | Lines |
|------|---------|-------|
| [`apps/web/src/hooks/useIframeBridge.ts`](../apps/web/src/hooks/useIframeBridge.ts) | Parent-side hook with message queuing | ~120 |
| [`apps/web/src/components/preview/PreviewFrame.tsx`](../apps/web/src/components/preview/PreviewFrame.tsx) | Parent component with iframe | ~150 |
| [`packages/design-system-runtime/src/hooks/usePostMessage.ts`](../packages/design-system-runtime/src/hooks/usePostMessage.ts) | Iframe-side hook | ~80 |

### Wrapper Components

| File | Purpose | Lines |
|------|---------|-------|
| [`packages/design-system-runtime/src/components/SelectionBox.tsx`](../packages/design-system-runtime/src/components/SelectionBox.tsx) | Click-to-select wrapper | ~40 |
| [`packages/design-system-runtime/src/components/AuditWrapper.tsx`](../packages/design-system-runtime/src/components/AuditWrapper.tsx) | Audit mode highlight wrapper | ~50 |
| [`packages/design-system-runtime/src/components/types.ts`](../packages/design-system-runtime/src/components/types.ts) | Shared component prop types | ~15 |

### Preview Infrastructure

| File | Purpose | Lines |
|------|---------|-------|
| [`apps/server/src/preview/preview-manager.ts`](../apps/server/src/preview/preview-manager.ts) | Preview server management | ~250 |
| [`apps/server/src/preview/types.ts`](../apps/server/src/preview/types.ts) | Preview server types | ~20 |
| [`apps/preview/src/main.tsx`](../apps/preview/src/main.tsx) | Preview app entry point | ~10 |

---

## Related Documentation

- [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md) - Overall system architecture
- [STATUS-MESSAGES.md](./STATUS-MESSAGES.md) - WebSocket status message protocol
- [WEBSOCKET_PROTOCOL.md](./WEBSOCKET_PROTOCOL.md) - Server communication protocol

---

## Troubleshooting

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Origin mismatch | Messages not received | Verify `previewOrigin` matches iframe URL origin |
| Queue not flushing | Messages delayed indefinitely | Check iframe is loading and sending `MODE_READY` |
| Sandbox too restrictive | postMessage fails | Ensure `allow-scripts allow-same-origin` in sandbox |
| Type mismatch | TypeScript errors | Import types from `useIframeBridge.ts` on both sides |

### Debug Tips

1. **Enable message logging:**
   ```typescript
   window.addEventListener('message', (event) => {
     console.log('[BRIDGE] Received:', event.origin, event.data);
   });
   ```

2. **Check iframe origin:**
   ```typescript
   console.log('Iframe origin:', new URL(iframeRef.current?.src || '').origin);
   ```

3. **Verify message queue:**
   ```typescript
   console.log('Queue size:', queueSize, 'Ready:', isReady);
   ```

---

## Future Enhancements

1. **Two-way prop binding**: `UPDATE_PROPS` message type for live prop editing
2. **Component tree sync**: Real-time component tree updates
3. **Performance metrics**: Measure bridge latency and throughput
4. **Message retry logic**: Handle transient communication failures
5. **Type-safe message builder**: Fluent API for constructing messages
