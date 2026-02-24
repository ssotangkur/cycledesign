# Phase 3: Prompt-to-UI Rendering

> **⚠️ Update (2026-02-24):** CycleDesign has migrated from PM2 to npm scripts for development. See [Development Commands](#development-commands) below for the new commands.

**This document extends `docs/TECHNICAL_DESIGN.md` with Phase 3 implementation details.**

**Relationship to Other Docs:**
- `TECHNICAL_DESIGN.md` - High-level architecture, system design
- `TOOL_CALLING.md` - Complete LLM tool calling specification (tools, workflows, error handling)
- `Phase3.md` - Implementation details, timelines, checklists, Phase 3-specific flows

**Cross-References:**
- Tool Calls → See `docs/TOOL_CALLING.md` for complete tool calling specification
- WebSocket Protocol → Phase 2a prerequisite (implemented in Phase 2a)
- Component Transformer → Phase 3 implementation in section "Component Transformer Pipeline" below
- Database Schema → Phase 3 implementation in section "Database Schema" below

---

## Development Commands

### Current (npm scripts - as of 2026-02-24)

```bash
npm run dev              # Start all services with logging
npm run dev:kill         # Kill processes on ports 3000/3001/3002
npm run dev:server       # Start backend only
npm run dev:web          # Start frontend only
```

Log files: `tmp/server.log`, `tmp/web.log`

### Previous (PM2 - deprecated)

```bash
pm2 start ecosystem.config.js
pm2 logs
pm2 restart server
```

---

## Current Status (Updated: 2026-02-22)

### ✅ Completed

**Infrastructure (old approach - see note at top):**
- ~~PM2 process management for all 3 services (`server`, `web`, `preview`)~~
- ~~Ecosystem config at `ecosystem.config.js` with proper Windows npm-cli.js paths~~
- All services run independently via PM2 (no nested spawning)
- Preview server lifecycle managed via API endpoints (`/api/preview/start`, `/stop`, `/status`, `/reset`)
- Backend no longer auto-starts preview on bootstrap (PM2 manages it)

**Preview Architecture:**
- `app.tsx` with named `App` export (not `current.tsx` with default export)
- Preview imports: `import { App } from '@design/app.tsx'`
- System prompt explains `app.tsx` is the root component
- Workspace bootstrapping creates `app.tsx` placeholder on first startup
- Path fixes for `@design` alias in `vite.config.ts` and `tsconfig.json`
- Preview loads correctly with bootstrap template at http://localhost:3002

**Preview Reset API:**
- `POST /api/preview/reset` - Resets preview to bootstrap version
- Deletes all design files in `workspace/designs/` except app.tsx
- Copies bootstrap template from `apps/server/resources/templates/app.tsx`
- Overwrites existing app.tsx with clean bootstrap version
- Fixed `loadDesign()` to use `app.tsx` instead of outdated `current.tsx`

**Port Management Fixes:**
- Installed `kill-port` package (v2.0.1) for cross-platform port killing
- Added `killPortOnEndpoint()` to kill processes on specific ports
- Fixed `stop()` to call killPortOnEndpoint after PM2 stop for proper cleanup
- Fixed `waitForReady()` bug that was overwriting target port with detected port
- Verified stop now properly frees port 3002 on Windows

**WebSocket Integration:**
- Multi-turn tool calling loop in WebSocket handler
- Automatic validation fallback if LLM doesn't call `submit_work`
- Session auto-selection on page load (localStorage persistence)
- Status broadcasting infrastructure ready

**Development Workflow:**
- `npm run dev` - Start all services with logging
- `npm run dev:kill` - Kill ports before starting
- Log files: `tmp/server.log`, `tmp/web.log`
- Services: `server` (3001), `web` (3000), `preview` (3002)

### 🔄 In Progress

- Full LLM tool calling flow (blocked on Qwen OAuth device flow)
- Validation pipeline implementation
- ID injection system
- Component transformer pipeline
- Real-time log streaming via SSE

### ❌ Not Started

- Design system mode (Phase 4)
- Direct tool calls for LLM introspection
- Semantic validation engine

---

## Overview

Phase 3 builds on Phase 1 (LLM Provider Integration) and Phase 2a (WebSocket-Based Real-Time Messaging) to enable LLM-generated React/TypeScript code rendering. This phase introduces:
- LLM generates React/TypeScript code from prompts
- Code rendered in isolated iframe with **backend-managed Vite instance**
- Backend starts/stops preview Vite server on demand
- Preview Vite has its own `package.json` (LLM can add dependencies)
- Real-time log streaming from preview server to UI
- Basic validation (TypeScript compilation)
- ID injection for generated components
- No design system enforcement yet (free-form generation)
- **Code generation prompts sent via WebSocket** (not REST)
- **Generated designs saved to session messages** (Phase 2a persistence)

**Success Criteria:**
- User can submit text prompts describing UI designs
- LLM generates valid React/TypeScript code
- Backend can start/stop preview Vite server programmatically
- Generated code renders in isolated iframe preview
- TypeScript compilation validates generated code
- Component instances receive auto-injected IDs
- User can see preview server logs in real-time
- User can see rendered design immediately after generation

---

## Technical Decisions

### 1. Separate Vite Instances for Tool and Preview

**Decision:** Two independent Vite instances with separate dependency management

**Structure:**
```
cycledesign/
├── apps/
│   ├── web/                    # Tool UI (Vite instance 1)
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── package.json        # Tool dependencies (MUI, etc.)
│   │   └── src/
│   │       └── main.tsx
│   │
│   └── preview/                # Preview (Vite instance 2, backend-managed)
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json        # LLM-managed dependencies
│       └── src/
│           └── main.tsx
│
└── workspace/
    └── designs/                # LLM-generated design code
        └── *.tsx
```

**Port Configuration:**
- Tool UI: `http://localhost:3000` (always running)
- Backend + WebSocket: `http://localhost:3001` / `ws://localhost:3001/ws`
- Preview: `http://localhost:3002` (started/stopped by backend, dynamic)

**Rationale:**
- ✅ Complete dependency isolation (LLM can add any npm package)
- ✅ CSS/JS isolation (no style leakage)
- ✅ Independent HMR (preview updates don't affect tool UI)
- ✅ Security boundary (LLM code runs in separate context)
- ✅ Different React versions possible (if needed)
- ✅ Backend controls preview lifecycle (start/stop on demand)
- ⚠️ Two dev servers to manage (minor complexity tradeoff)

---

### 2. iframe Sandboxing

**Decision:** Sandboxed iframe pointing to backend-managed Vite dev server

**iframe Attributes:**
```html
<iframe
  sandbox="allow-scripts allow-same-origin"
  src="http://localhost:3002"  // Dynamic port from backend
  title="Design Preview"
  style={{ width: '100%', height: '100%', border: 'none' }}
/>
```

**Server Discovery:**
- Frontend queries `GET /api/preview/status` to get current preview URL
- Backend returns `{ status: 'RUNNING', port: 3002, url: 'http://localhost:3002' }`
- Frontend updates iframe src when server starts/restarts

**WebSocket Integration:**
- Code generation prompts sent via WebSocket (Phase 2a protocol)
- Generated designs saved to session messages automatically
- Use `useMessageListState` hook for sending generation requests

**Security Considerations:**
- `allow-scripts`: Required for React to run
- `allow-same-origin`: Required for HMR to work
- No `allow-forms` or `allow-popups` (not needed for preview)
- CSS completely isolated from tool UI
- JavaScript errors in preview don't crash tool UI
- LLM can install any npm package without affecting tool

---

### 3. Design Code Storage

**Decision:** Store generated code in `workspace/designs/` directory

**File Structure:**
```
workspace/
└── designs/
    ├── landing-page.tsx
    ├── dashboard.tsx
    └── *.tsx
```

**File Naming:**
- User-provided name slugified (e.g., "Landing Page" → `landing-page.tsx`)
- Auto-generated UUID if no name provided
- Overwrite on regeneration (with confirmation)

**Preview Vite Integration:**
- Preview Vite configured with alias to `workspace/designs/`
- LLM-generated designs imported directly in preview:
  ```tsx
  // preview/src/main.tsx
  import Design from '../../workspace/designs/landing-page';
  render(<Design />);
  ```
- File watcher triggers preview reload on design changes

---

## Backend Components

### 1. Backend-Managed Preview Server Lifecycle

**Decision:** Backend controls preview Vite server (start/stop/restart) with log streaming

**Architecture:**
```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Tool UI       │      │   Backend       │      │  Preview Vite   │
│   (port 3000)   │◄────►│   (port 3001)   │◄────►│  (port 3002)    │
│                 │      │                 │      │                 │
│ - iframe embed  │      │ - spawn Vite    │      │ - serves design │
│ - log display   │      │ - log streaming │      │ - HMR           │
│ - start/stop UI │      │ - API endpoints │      │ - React render  │
└─────────────────┘      └─────────────────┘      └─────────────────┘
         │                        │                        │
         └────────────────────────┴────────────────────────┘
                          postMessage (3000 ↔ 3002)
```

**Server States:**
- `STOPPED` - Preview server not running
- `STARTING` - Spawning Vite process, waiting for ready
- `RUNNING` - Server ready, accepting connections
- `ERROR` - Failed to start or crashed

**API Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/preview/start` | Start preview server |
| `POST` | `/api/preview/stop` | Stop preview server |
| `GET` | `/api/preview/status` | Get server status and port |
| `GET` | `/api/preview/logs/stream` | Stream logs (SSE) |
| `POST` | `/api/preview/restart` | Restart with new dependencies |
| `POST` | `/api/preview/reset` | Reset to bootstrap template |

**Log Streaming (SSE):**
```typescript
// Backend emits log events
GET /api/preview/logs/stream

// Response (Server-Sent Events)
data: {"type":"stdout","message":"VITE v5.0.0 ready in 500ms","timestamp":1234567890}
data: {"type":"stderr","message":"Failed to resolve import...","timestamp":1234567891}
data: {"type":"ready","port":3002,"timestamp":1234567892}
```

**Process Management:**
- Spawn Vite as child process with stdio pipes
- Capture stdout/stderr for log streaming
- Graceful shutdown on stop (SIGTERM, then SIGKILL)
- Auto-restart on crash (optional, configurable)
- Port conflict detection and resolution

**Rationale:**
- ✅ Centralized control (backend manages all services)
- ✅ Real-time visibility (logs streamed to UI)
- ✅ Resource efficiency (stop when not needed)
- ✅ Tool-ready (future: expose as additional tool calls)
- ✅ Error recovery (auto-restart, status monitoring)

### 2. Code Generation Flow (WebSocket-Based)

**Decision:** LLM generates complete TSX file with imports using **tool calling** for structured output, triggered via WebSocket

**WebSocket Integration:**
- User sends code generation prompt via WebSocket (Phase 2a protocol)
- Message includes client-generated ID for optimistic updates
- Server acknowledges immediately, then processes generation
- Generated design saved to session messages automatically

**Tool Calling:**
- LLM uses 7 separate tools for code generation
- Tools are defined in `apps/server/src/llm/tools/`
- Complete tool specifications in `docs/TOOL_CALLING.md`

**Message Flow:**
```typescript
// Client → Server (via WebSocket)
{
  "type": "message",
  "id": "msg_client_1234567890",
  "content": "Create a landing page with animations",
  "timestamp": 1705312210000
}

// Server → Client (immediate acknowledgment)
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": 1705312211000
}

// Server processes generation (tool calling happens server-side)
// Server sends status updates for each tool call
// ... see TOOL_CALLING.md for complete flow

// Server → Client (done)
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": 1705312220000
}
```

**Status Message Types:**

| Status Type | Description |
|-------------|-------------|
| `tool_call_start` | A tool is about to execute |
| `tool_call_complete` | Tool executed successfully |
| `tool_call_error` | Tool execution failed |
| `validation_start` | Validation pipeline starting |
| `validation_complete` | All validations passed |
| `validation_error` | Validation failed |
| `preview_start` | Preview server starting |
| `preview_ready` | Preview server ready |
| `preview_error` | Preview server failed |

**Frontend Integration:**
```typescript
// Use Phase 2a's useMessageListState hook
const { sendMessage, isConnected } = useMessageListState(sessionId);
sendMessage('Create a landing page with hero section and features');
```

**See Also:**
- Complete tool definitions: `docs/TOOL_CALLING.md`
- Status broadcasting: `docs/TOOL_CALLING.md`
- Multi-turn workflow: `docs/TOOL_CALLING.md`

---

### 2.1. Server-Side Tool Calling with Status Broadcasting

**Decision:** Broadcast tool execution status to clients via WebSocket in real-time

**Implementation:** See `docs/TOOL_CALLING.md` for complete implementation details including:
- StatusBroadcaster class
- Tool calling integration
- Validation pipeline integration
- Preview server integration
- Frontend StatusMessage component
  
  broadcastStatus(status: StatusMessage) {
    const message = JSON.stringify(status);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  sendToolCallStart(messageId: string, tool: string, details: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_start',
      tool,
      details,
      timestamp: Date.now(),
    });
  }
  
  sendToolCallComplete(messageId: string, tool: string, details: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_complete',
      tool,
      details,
      timestamp: Date.now(),
    });
  }
  
  sendToolCallError(messageId: string, tool: string, error: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_error',
      tool,
      details: error,
      timestamp: Date.now(),
    });
  }
  
  sendValidationStart(messageId: string, stage: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'validation_start',
      details: `Running ${stage}...`,
      timestamp: Date.now(),
    });
  }
  
  sendValidationComplete(messageId: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'validation_complete',
      details: 'All validations passed',
      timestamp: Date.now(),
    });
  }
  
  sendPreviewStart(messageId: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'preview_start',
      details: 'Starting preview server...',
      timestamp: Date.now(),
    });
  }
  
  sendPreviewReady(messageId: string, port: number) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'preview_ready',
      details: `Preview ready at http://localhost:${port}`,
      timestamp: Date.now(),
    });
  }
}

// Global instance
export const statusBroadcaster = new StatusBroadcaster();
```

**Tool Calling Integration:**
```typescript
// apps/server/src/llm/tool-executor.ts
import { statusBroadcaster } from '../websocket/status-broadcaster';

export async function executeToolCalls(
  toolCalls: ToolCall[],
  messageId: string
) {
**Implementation:** See `docs/TOOL_CALLING.md` for complete code examples.

**Message List Integration:**
```typescript
// apps/web/src/components/chat/MessageList.tsx
import { StatusMessage } from './StatusMessage';

function MessageList({ messages }) {
  return (
    <Box>
      {messages.map(msg => {
        if (msg.type === 'status') {
          return (
            <StatusMessage
              key={msg.id}
              status={msg.status}
              tool={msg.tool}
              details={msg.details}
            />
          );
        }
        
        return (
          <MessageItem
            key={msg.id}
            message={msg}
          />
        );
      })}
    </Box>
  );
}
```

---

### 3. Validation Pipeline

**Decision:** Five-stage validation before rendering

**Stages:**
1. **Dependency Check** - Verify imported packages are installed
2. **TypeScript Compilation** - Verify code compiles
3. **ESLint Validation** - Check for common errors
4. **Knip Check** - Detect unused imports/exports
5. **ID Injection** - Add system-managed IDs to components

**Validation Flow:**
```
LLM generates code
      ↓
Check imports vs installed packages
      ↓
Install missing dependencies (apps/preview/package.json)
      ↓
TypeScript compile (tsc)
      ↓
ESLint check (eslint)
      ↓
Knip check (unused imports/exports)
      ↓
ID injection (parser)
      ↓
Write to workspace/designs/
      ↓
Preview Vite HMR picks up change
      ↓
Render in preview iframe
```

**Error Handling:**
- If validation fails: Show error panel with suggestions
- Offer to retry generation with error feedback
- Allow user to see raw generated code for debugging
- Dependency install failures blocked with clear error message

---

### 4. ID Injection System

**Decision:** AST-based ID injection post-validation

**Implementation:**
```typescript
// apps/server/src/parser/id-injector.ts
import { parse, transform } from '@typescript-eslint/typescript-estree';
import { generate } from 'ts-morph';

interface InjectionResult {
  added: number;
  removed: number;
  duplicates: number;
  unchanged: number;
}

export function injectIds(code: string, existingIds: Set<string>): {
  code: string;
  result: InjectionResult;
} {
  // Parse AST
  const ast = parse(code, { jsx: true, comment: true });
  
  // Track injected IDs
  const injectedIds = new Set<string>();
  
  // Transform: Add id prop to JSX elements missing them
  transform(ast, {
    visitJSXElement(node) {
      if (!hasIdProp(node)) {
        const id = generateUniqueId(injectedIds, existingIds);
        addIdProp(node, id);
        injectedIds.add(id);
      }
      this.traverse(node);
    },
  });
  
  // Generate updated code
  const updatedCode = generate(ast);
  
  return {
    code: updatedCode,
    result: {
      added: injectedIds.size,
      removed: 0,
      duplicates: 0,
      unchanged: 0,
    },
  };
}
```

**ID Format:**
- Pattern: `id_<design>_<counter>` (e.g., `id_landing_0`, `id_landing_1`)
- UUIDs for uniqueness when needed
- Persisted in source file for user/LLM reference

---

### 4.1. Component Transformer Pipeline

**Decision:** Wrap component instances with helper HOCs for audit/selection functionality

**Location:** `apps/server/src/transformer/`

**Process:**
After ID injection, code is transformed to wrap each component instance:

```typescript
// Input (from LLM, after ID injection)
<Box id="id_landing_0">
  <Typography id="id_landing_1">Welcome</Typography>
  <Button id="id_landing_2">Get Started</Button>
</Box>

// Output (in build folder, wrapped)
<AuditWrapper id="id_landing_0" componentName="Box">
  <SelectionBox>
    <Box>
      <AuditWrapper id="id_landing_1" componentName="Typography">
        <SelectionBox>
          <Typography>Welcome</Typography>
        </SelectionBox>
      </AuditWrapper>
      <AuditWrapper id="id_landing_2" componentName="Button">
        <SelectionBox>
          <Button>Get Started</Button>
        </SelectionBox>
      </AuditWrapper>
    </Box>
  </SelectionBox>
</AuditWrapper>
```

**Wrapper Components:**
- `AuditWrapper` - Handles audit mode highlighting, tracks component usage
- `SelectionBox` - Shows selection bounding box, handles click events
- Both from `@cycledesign/runtime` package

**Build Folder Structure:**
```
build/
└── designs/
    ├── landing-page.tsx      # Transformed code with wrappers
    └── *.tsx
```

---

### 4.2. Database Schema

**Purpose:** Index component usage for audit mode and selection tracking

**Location:** `.cycledesign/index.db` (SQLite, gitignored)

**Schema:**
```sql
-- Component usage index
CREATE TABLE component_usage (
  id INTEGER PRIMARY KEY,
  component_name TEXT NOT NULL,     -- e.g., "Button"
  design_file TEXT NOT NULL,         -- e.g., "landing-page.tsx"
  instance_id TEXT NOT NULL,         -- e.g., "id_landing_2"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Component metadata
CREATE TABLE components (
  name TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,         -- e.g., "design-system/components/Button.tsx"
  prop_schema JSON,                  -- TypeScript prop types as JSON
  variants JSON,                     -- Available variants
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Database Operations:**
- **Rebuilt on startup** from source code (not versioned)
- **Updated during ID injection** when new instances detected
- **Queried by audit mode** to show component usage across designs

---

### 5. Preview Vite Entry Point

**Decision:** Preview loads design dynamically via import alias

**UPDATE (2026-02-22):** Using named `App` export from `app.tsx` instead of default export from `current.tsx`

**Preview Structure:**
```
apps/preview/
├── index.html
├── vite.config.ts
├── package.json        # Base dependencies (react, react-dom)
└── src/
    └── main.tsx        # Dynamic design loader
```

**Vite Config (apps/preview/vite.config.ts):**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': resolve(__dirname, '../../workspace/designs'),
    },
  },
  server: {
    port: 3002,  // Dynamic port assigned by backend
    strictPort: false,  // Allow port change if 3002 is taken
    cors: true,  // Allow cross-origin from tool UI
  },
});
```

**Preview Entry (apps/preview/src/main.tsx):**
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@design/app.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Design Switching:**
- LLM modifies `workspace/designs/app.tsx` directly
- Preview Vite HMR auto-reloads on file change
- No page refresh needed
- **Must always export named `App` component**

**Log Output:**
- Vite dev server logs captured by backend (stdio)
- Logs streamed to UI via SSE
- Errors visible in real-time for debugging

---

## Frontend Components

### 1. UI Layout Architecture

**Decision:** Full-width header with two-pane split layout (left: chat/sessions, right: preview) with resizable divider

**Layout Structure:**
```
┌─────────────────────────────────────────────────────────────┐
│                    Full-Width Header Bar                    │
│                    CycleDesign Logo + Nav                   │
├──────────────────────────────────┬──────────────────────────┤
│                                  │                          │
│         Left Pane                │      Right Pane          │
│      (Chat + Sessions)           │    (Preview iframe)      │
│      (resizable width)           │    (flex remaining)      │
│                                  │                          │
│  ┌──────────────────────────┐   │  ┌────────────────────┐  │
│  │    Session Selector      │   │  │                    │  │
│  ├──────────────────────────┤   │  │                    │  │
│  │                          │   │  │                    │  │
│  │     Message List         │   │  │   Preview iframe   │  │
│  │                          │   │  │   (port 3002)      │  │
│  │                          │   │  │                    │  │
│  ├──────────────────────────┤   │  └────────────────────┘  │
│  │     Prompt Input         │   │                          │
│  ├──────────────────────────┤   │                          │
│  │    Status Bar            │   │                          │
│  │  (connection status)     │   │                          │
│  └──────────────────────────┘   │                          │
│                                  │                          │
└──────────────────────────────────┴──────────────────────────┘
          ↕ draggable divider ↕
```

**Layout Specifications:**

| Section | Width | Height | Description |
|---------|-------|--------|-------------|
| **Header** | 100% | auto | Auto height based on content, full width, contains logo and navigation |
| **Left Pane** | 30-70% (user resizable) | 100% - header height | Contains session selector, messages, prompt input, and status bar |
| **Right Pane** | Remaining (flex) | 100% - header height | Contains preview iframe (backend-managed Vite) |
| **Divider** | 8px | 100% - header height | Draggable resize handle between panes |
| **Status Bar** | 100% of left pane | auto | Shows WebSocket connection status, fixed at bottom of left pane |

**Divider Behavior:**
- User can drag divider left/right to resize panes
- Left pane has minimum width based on content (session selector, message list, prompt input)
- Left pane has maximum width (e.g., 70% to keep preview visible)
- Divider has visual indicator (vertical line with hover state)
- Drag operation uses smooth resizing (no layout shift)
- Optional: Persist divider position in localStorage

**Layout Component Structure:**
```tsx
// apps/web/src/layouts/MainLayout.tsx
function MainLayout() {
  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleDividerDrag = (newWidth: number) => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    const minPercentage = 0.3;  // 30% minimum
    const maxPercentage = 0.7;  // 70% maximum
    const newPercentage = newWidth / containerWidth;
    
    if (newPercentage >= minPercentage && newPercentage <= maxPercentage) {
      setLeftPaneWidth(newWidth);
    }
  };
  
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Full-Width Header (auto height) */}
      <AppBar position="static" sx={{ width: '100%' }}>
        <Toolbar>
          <Typography variant="h6">CycleDesign</Typography>
          {/* Navigation items */}
        </Toolbar>
      </AppBar>
      
      {/* Two-Pane Split Layout with Resizable Divider */}
      <Box 
        ref={containerRef}
        sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}
      >
        {/* Left Pane: Chat + Sessions */}
        <Box
          sx={{
            width: leftPaneWidth ?? '40%',
            minWidth: '350px',  // Based on content requirements
            maxWidth: '70%',
            borderRight: '1px solid divider',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <SessionSelector />
          <MessageList />
          <PromptInput />
          <ConnectionStatus isConnected={isConnected} />
        </Box>
        
        {/* Resizable Divider */}
        <Box
          sx={{
            width: '8px',
            cursor: 'col-resize',
            backgroundColor: 'divider',
            '&:hover': {
              backgroundColor: 'primary.main',
            },
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = leftPaneWidth ?? containerRef.current?.clientWidth! * 0.4;
            
            const handleMouseMove = (moveEvent: MouseEvent) => {
              const newWidth = startWidth + (moveEvent.clientX - startX);
              handleDividerDrag(newWidth);
            };
            
            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        />
        
        {/* Right Pane: Preview iframe */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <PreviewFrame />
        </Box>
      </Box>
    </Box>
  );
}
```

**Preview iframe Behavior:**
- Fills entire right pane (100% width/height of pane)
- No border, seamless integration
- Auto-scrolls to show full design
- Loading skeleton while preview server starts
- Error overlay if preview server fails

**Rationale:**
- ✅ Clear visual separation between chat and preview
- ✅ Side-by-side workflow (chat with LLM while viewing results)
- ✅ User can adjust pane widths based on task (more chat space vs more preview space)
- ✅ Maximize preview real estate when needed
- ✅ Persistent chat context visible during preview interaction
- ✅ No layout shift when preview starts/stops
- ✅ Header adapts to content (better for future additions)
- ⚠️ Requires careful handling of divider drag boundaries

---

### 2. Preview Communication Bridge

**Decision:** postMessage API for cross-origin communication (3000 ↔ 3002)

**Message Types:**
```typescript
// Parent (tool UI, port 3000) → Iframe (preview, port 3002)
interface ParentMessage {
  type: 'SET_MODE';
  payload: { mode: 'select' | 'preview' | 'audit' };
} | {
  type: 'HIGHLIGHT_COMPONENT';
  payload: { instanceId: string };
} | {
  type: 'UPDATE_PROPS';
  payload: { instanceId: string; props: Record<string, any> };
};

// Iframe (preview, port 3002) → Parent (tool UI, port 3000)
interface IframeMessage {
  type: 'MODE_READY';
  payload: { mode: string };
} | {
  type: 'COMPONENT_SELECTED';
  payload: { instanceId: string; componentName: string };
} | {
  type: 'ERROR';
  payload: { error: string };
};
```

**Implementation:**
```typescript
// Parent (tool UI, port 3000)
const iframeRef = useRef<HTMLIFrameElement>(null);

function sendMessageToIframe(message: ParentMessage) {
  iframeRef.current?.contentWindow?.postMessage(
    message,
    'http://localhost:3002'  // Preview origin (dynamic)
  );
}

// Iframe (preview, port 3002)
window.addEventListener('message', (event) => {
  if (event.origin !== 'http://localhost:3000') return;  // Tool origin
  
  const message: ParentMessage = event.data;
  
  switch (message.type) {
    case 'SET_MODE':
      setMode(message.payload.mode);
      break;
    case 'HIGHLIGHT_COMPONENT':
      highlightComponent(message.payload.instanceId);
      break;
  }
});
```

**Cross-Origin Security:**
- Explicit origin validation on both sides
- Only localhost origins allowed in development
- Production would require HTTPS + strict origin checking

---

## Implementation Checklist

### Backend Setup

- [x] **1.0** Implement LLM tool calling for code generation
  - [x] Multi-turn tool calling loop in WebSocket handler
  - [x] Automatic validation fallback if LLM doesn't call `submit_work`
  - [ ] Full tool definitions (create_file, edit_file, etc.) - blocked on OAuth
  - [ ] Tool execution pipeline with error handling
  - [ ] File constraint validation

- [x] **1.1** Create preview server lifecycle management
  - [x] PreviewManager class with start/stop/getStatus
  - [x] Port conflict detection and resolution
  - [x] Process management with proper cleanup
  - [ ] Log streaming integration (SSE)

- [x] **1.2** Create preview server API endpoints
  - [x] `POST /api/preview/start`
  - [x] `POST /api/preview/stop`
  - [x] `GET /api/preview/status`
  - [x] `POST /api/preview/restart`
  - [x] `POST /api/preview/reset` (reset to bootstrap version)
  - [ ] `GET /api/preview/logs/stream` (SSE)

- [x] **1.3** Bootstrap workspace on startup
  - [x] Create workspace/designs directories
  - [x] Create app.tsx placeholder with named App export
  - [x] IN_PREVIEW_SERVER env flag to prevent recursive spawning
  - [x] Removed auto-start preview logic (PM2 manages it)

- [ ] **1.4** Integrate code generation with WebSocket
  - [x] Multi-turn tool calling loop
  - [x] Automatic validation fallback
  - [ ] Status broadcasting during tool execution
  - [ ] Save generated designs to session messages

- [ ] **1.5** Implement validation pipeline
  - [ ] TypeScript compilation check
  - [ ] ESLint validation
  - [ ] Knip check for unused imports
  - [ ] Parallel execution with aggregated errors

- [ ] **1.6** Implement add_dependency tool
  - [ ] npm install as child process
  - [ ] Stream install progress
  - [ ] Handle install failures

- [ ] **1.7** Implement ID injection
  - [ ] AST-based ID injector
  - [ ] Generate unique IDs
  - [ ] Preserve existing valid IDs

- [ ] **1.8** Create design file management
  - [ ] CRUD endpoints for designs
  - [ ] Design switching mechanism

---

### ⚠️ PM2 Process Management (Deprecated - use npm scripts instead)

> **Note:** As of 2026-02-24, CycleDesign uses npm scripts instead of PM2. See "Development Commands" at the top of this document.

- [x] **PM2.1** Ecosystem configuration (deprecated)
  - [x] ecosystem.config.js with all 3 services
  - [x] Windows-compatible npm-cli.js paths
  - [x] Proper log file locations
  - [x] Watch mode for server and web

- [x] **PM2.2** Service management (deprecated)
  - [x] server (port 3001) - backend API + WebSocket
  - [x] web (port 3000) - frontend UI
  - [x] preview (port 3002) - Vite preview server
  - [x] Independent lifecycle (no nested spawning)

- [x] **PM2.3** Logging (deprecated)
  - [x] Separate log files per service
  - [x] pm2 logs command for live viewing
  - [ ] SSE log streaming to frontend

---

### Frontend Setup
  - [ ] Create `src/llm/tools/create-file.ts` (Zod schema + tool definition)
  - [ ] Create `src/llm/tools/edit-file.ts` (patch-based editing with unified diff)
  - [ ] Create `src/llm/tools/rename-file.ts` (rename design files)
  - [ ] Create `src/llm/tools/delete-file.ts` (delete design files)
  - [ ] Create `src/llm/tools/add-dependency.ts` (add npm packages to preview)
  - [ ] Create `src/llm/tools/submit-work.ts` (trigger validation pipeline, empty args)
  - [ ] Create `src/llm/tools/ask-user.ts` (request clarification from user)
  - [ ] Create `src/llm/tools/index.ts` (export all tools)
  - [ ] Update LLM provider to support tool calling with all 7 tools
  - [ ] Configure tool calling parameters (temperature: 0.1, maxTokens: 8192)
  - [ ] Add hardcoded system prompt for code generation (includes tool instructions, submit_work requirement, file constraints)
  - [ ] Implement tool execution pipeline with error handling
  - [ ] Add file constraint validation (kebab-case, .tsx only, designs/ directory)
  - [ ] **Validate:** LLM returns structured tool calls consistently
  - [ ] **Validate:** Each tool executes correctly with proper validation

- [ ] **1.1** Create preview server lifecycle management
  - [ ] Create `src/preview/preview-manager.ts` (process management)
  - [ ] Implement `start()` - spawn Vite child process
  - [ ] Implement `stop()` - graceful shutdown (SIGTERM → SIGKILL)
  - [ ] Implement `getStatus()` - return current state and port
  - [ ] Implement `restart()` - stop + start with new dependencies
  - [ ] Handle port conflicts (find available port)
  - [ ] Capture stdout/stderr streams for logging
  - [ ] Auto-restart on crash (configurable)
  - [ ] **Validate:** Start/stop preview server programmatically

- [ ] **1.2** Create preview server API endpoints
  - [ ] `POST /api/preview/start` - Start preview server
  - [ ] `POST /api/preview/stop` - Stop preview server
  - [ ] `GET /api/preview/status` - Get server status and port
  - [ ] `POST /api/preview/restart` - Restart with new dependencies
  - [ ] Return appropriate status codes and error messages
  - [ ] **Validate:** Test all endpoints with Chrome DevTools MCP

- [ ] **1.3** Implement log streaming (SSE)
  - [ ] Create `GET /api/preview/logs/stream` endpoint
  - [ ] Use Server-Sent Events for real-time streaming
  - [ ] Format logs as `{ type, message, timestamp }`
  - [ ] Handle client disconnects gracefully
  - [ ] Buffer recent logs for new connections
  - [ ] **Validate:** Stream logs to UI in real-time

- [ ] **1.4** Integrate code generation with WebSocket
  - [ ] Handle code generation prompts via WebSocket messages
  - [ ] Trigger LLM tool calling on message receive
  - [ ] **Send status messages via WebSocket during tool execution**
  - [ ] Stream generation progress via WebSocket `content` messages
  - [ ] Save generated designs to session messages
  - [ ] **Validate:** Test with Phase 2a WebSocket client

- [ ] **1.4.1** Implement WebSocket status messaging for tool calls
  - [ ] Create `src/websocket/status-broadcaster.ts` for sending status updates
  - [ ] Define status message types (tool_call_*, validation_*, preview_*)
  - [ ] Hook into tool calling pipeline to emit status events
  - [ ] Send `tool_call_start` before each tool executes
  - [ ] Send `tool_call_complete` after each tool succeeds
  - [ ] Send `tool_call_error` if tool fails
  - [ ] Send validation status messages during validation pipeline
  - [ ] Send preview server status messages during start/restart
  - [ ] Include user-friendly details in each status message
  - [ ] **Validate:** Status messages appear in chat in real-time

- [ ] **1.5** Implement validation pipeline
  - [ ] Create `src/validation/typescript.ts` (tsc runner for preview directory)
  - [ ] Create `src/validation/eslint.ts` (eslint runner, copy apps/server/.eslintrc.js)
  - [ ] Create `src/validation/knip.ts` (knip runner with default config)
  - [ ] Run all validators in parallel (Promise.all)
  - [ ] Aggregate all errors into single array with type, file, line, column, message
  - [ ] Return aggregated errors to LLM for resolution
  - [ ] **Validate:** All validation errors returned in single response
  - [ ] **Validate:** Parallel execution is faster than sequential

- [ ] **1.6** Implement add_dependency tool execution
  - [ ] Run `npm install` as child process in preview directory
  - [ ] Handle install failures (report error back to LLM)
  - [ ] Use latest version if not specified
  - [ ] Stream install progress to status broadcaster
  - [ ] **Validate:** LLM can add new package and it becomes available

- [ ] **1.7** Implement ID injection
  - [ ] Create `src/parser/id-injector.ts` (AST-based injection)
  - [ ] Generate unique IDs for component instances
  - [ ] Preserve existing valid IDs
  - [ ] Detect and fix duplicate IDs
  - [ ] Return injection summary (added, removed, duplicates)
  - [ ] **Validate:** Verify IDs persist in source file

- [ ] **1.8** Create design file management
  - [ ] `GET /api/designs` - List all designs
  - [ ] `GET /api/designs/:name` - Get design code
  - [ ] `PUT /api/designs/:name` - Update design code
  - [ ] `DELETE /api/designs/:name` - Delete design
  - [ ] Copy selected design to `workspace/designs/current.tsx`
  - [ ] Trigger preview HMR on design change
  - [ ] **Validate:** Test CRUD operations

---

### Preview Vite Setup

- [ ] **2.1** Initialize preview Vite instance
  - [ ] Create `apps/preview/` directory
  - [ ] Create `package.json` with base dependencies (react, react-dom)
  - [ ] Create `vite.config.ts` with dynamic port and alias to transformed output directory
  - [ ] Create `index.html` entry point
  - [ ] Create `src/main.tsx` with dynamic design loader
  - [ ] Create component transformer (wraps components with AuditWrapper/SelectionBox)
  - [ ] Transformer outputs to separate directory (e.g., `workspace/build/`)
  - [ ] Transformer invoked by backend after submit_work validation passes
  - [ ] Vite configured to serve transformed output directory
  - [ ] **Validate:** Backend can start preview server with transformed code

- [ ] **2.2** Configure dynamic port assignment
  - [ ] Allow Vite to find available port (strictPort: false)
  - [ ] Backend detects actual port from Vite output
  - [ ] Report port to frontend via status endpoint
  - [ ] **Validate:** Port changes when 3002 is occupied

### Frontend Setup

- [x] **2.3** Implement two-pane layout architecture
  - [x] Full-width header with auto height
  - [x] Resizable split pane (left: 30-70%, right: flex)
  - [x] Draggable divider with visual feedback
  - [x] Session auto-selection on page load (localStorage)
  - [x] WebSocket connection status display

- [ ] **2.4** Create preview server control UI
  - [ ] PreviewServerStatus component
  - [ ] Start/stop buttons
  - [ ] Status display (STOPPED/STARTING/RUNNING/ERROR)
  - [ ] Auto-start on first design generation

- [ ] **2.5** Implement tool call status messaging
  - [ ] StatusMessage component
  - [ ] Support all status types
  - [ ] Real-time display during generation

- [ ] **2.6** Create log viewer component
  - [ ] PreviewLogViewer with scrollable display
  - [ ] Color-code log levels
  - [ ] Auto-scroll with pause/resume
  - [ ] SSE integration

- [ ] **2.7** Create preview iframe component
  - [x] PreviewFrame pointing to dynamic preview URL
  - [ ] Handle load events
  - [ ] Error boundary
  - [ ] Loading state

- [ ] **2.8** Implement communication bridge
  - [ ] useIframeBridge hook
  - [ ] postMessage API
  - [ ] Origin validation
  - [ ] Message queue

- [ ] **2.9** Build prompt input UI
  - [x] PromptInput component
  - [x] Enter key to submit
  - [ ] Image upload support
  - [ ] Character count

- [ ] **2.10** Create design generation UI
  - [ ] DesignGenerator component
  - [ ] Progress display
  - [ ] Error handling with suggestions
  - [ ] Retry button

- [ ] **2.11** Implement mode switching
  - [ ] Mode toggle (Select / Preview / Audit)
  - [ ] Visual indicator
  - [ ] postMessage to iframe

---

### Preview Vite Setup

- [x] **2.1** Initialize preview Vite instance
  - [x] apps/preview/ directory structure
  - [x] package.json with base dependencies
  - [x] vite.config.ts with @design alias
  - [x] index.html entry point
  - [x] src/main.tsx with App import from @design/app.tsx
  - [ ] Component transformer (Phase 4)

- [x] **2.2** Configure dynamic port assignment
  - [x] strictPort: false
  - [x] Backend detects actual port
  - [x] Port reported via status endpoint
  - [ ] Update `MainLayout.tsx` with full-width header (auto height)
  - [ ] Create resizable split pane component (left: 30-70%, right: flex)
  - [ ] Implement draggable divider with visual feedback
  - [ ] Add min/max width constraints for left pane (based on content)
  - [ ] Ensure left pane contains: SessionSelector, MessageList, PromptInput, ConnectionStatus
  - [ ] Ensure right pane contains: PreviewFrame component
  - [ ] Add localStorage persistence for divider position (optional)
  - [ ] **Validate:** Divider drags smoothly, respects boundaries

- [ ] **2.4** Create preview server control UI
  - [ ] `PreviewServerStatus` component (start/stop buttons)
  - [ ] Display current server state (STOPPED/STARTING/RUNNING/ERROR)
  - [ ] Show current preview port
  - [ ] Auto-start on first design generation
  - [ ] Confirm before stopping active preview
  - [ ] **Validate:** Control preview server from UI

- [ ] **2.5** Implement tool call status messaging
  - [ ] Create `StatusMessage` component for displaying tool call progress
  - [ ] Support all status types (tool_call_*, validation_*, preview_*)
  - [ ] Display status messages inline in message list
  - [ ] Use info/success/error color coding based on status
  - [ ] Auto-expand/collapse status details
  - [ ] Show spinner during in-progress operations
  - [ ] **Validate:** Status messages display in real-time during generation

- [ ] **2.6** Create log viewer component
  - [ ] `PreviewLogViewer` component with scrollable log display
  - [ ] Color-code log levels (info, warn, error)
  - [ ] Auto-scroll to latest log
  - [ ] Pause/resume auto-scroll
  - [ ] Clear logs button
  - [ ] Filter by log type
  - [ ] **Validate:** Logs stream in real-time from backend

- [ ] **2.7** Create preview iframe component
  - [ ] `PreviewFrame` component pointing to dynamic preview URL
  - [ ] Handle iframe load events
  - [ ] Error boundary for iframe crashes
  - [ ] Loading state during server start
  - [ ] Update src on server restart
  - [ ] **Validate:** Use Chrome DevTools MCP to verify iframe renders

- [ ] **2.8** Implement communication bridge
  - [ ] `useIframeBridge` custom hook
  - [ ] Send commands to iframe (SET_MODE, HIGHLIGHT)
  - [ ] Receive events from iframe (COMPONENT_SELECTED)
  - [ ] Origin validation (dynamic preview origin)
  - [ ] Message queue for pre-ready messages
  - [ ] **Validate:** Test bidirectional communication

- [ ] **2.9** Build prompt input UI
  - [ ] `PromptInput` component with text field
  - [ ] Image upload support (drag & drop)
  - [ ] Character count and limits
  - [ ] Submit button with loading state
  - [ ] **Validate:** Test prompt submission flow

- [ ] **2.10** Create design generation UI
  - [ ] `DesignGenerator` component
  - [ ] Display generation progress
  - [ ] Show validation errors with suggestions
  - [ ] Retry button for failed generations
  - [ ] View raw code option (for debugging)
  - [ ] **Validate:** Test full generation flow

- [ ] **2.11** Implement mode switching
  - [ ] Mode toggle (Select / Preview / Audit)
  - [ ] Visual indicator of current mode
  - [ ] Send mode changes to iframe (dynamic port)
  - [ ] Handle mode-specific UI changes
  - [ ] **Validate:** Verify mode changes reflect in preview

---

### Runtime Package

- [ ] **3.1** Create design system runtime package
  - [ ] `packages/design-system-runtime/src/index.ts`
  - [ ] Export wrapper components
  - [ ] Add to preview `package.json` as dependency
  - [ ] Configure as workspace dependency

- [ ] **3.2** Implement wrapper components
  - [ ] `AuditWrapper` - Handles audit mode highlighting (border/background)
  - [ ] `SelectionBox` - Shows selection bounding box with click handlers
  - [ ] `MetadataProvider` - Attaches instance metadata (id, componentName)
  - [ ] Implement postMessage communication to parent window
    - Send `COMPONENT_SELECTED` event with instanceId, componentName
    - Send `MODE_READY` event when mode changes
    - Listen for `SET_MODE`, `HIGHLIGHT_COMPONENT` from parent
  - [ ] Origin validation (only accept from http://localhost:3000)
  - [ ] Style wrappers with MUI `sx` prop
  - [ ] **Validate:** Verify wrappers render correctly in preview
  - [ ] **Validate:** postMessage communication works bidirectionally

---

### Integration & Testing

- [ ] **4.1** Test code generation flow
  - [ ] Submit prompt → receive code
  - [ ] Verify TypeScript compilation
  - [ ] Verify ID injection
  - [ ] Verify build transformation
  - [ ] Verify iframe rendering
  - [ ] **Validate:** Full end-to-end flow with Chrome DevTools MCP

- [ ] **4.2** Test error scenarios
  - [ ] Invalid TypeScript code
  - [ ] Missing imports
  - [ ] Component not found errors
  - [ ] iframe communication failures
  - [ ] **Validate:** Error messages display correctly

---

## ⚠️ PM2 Commands Reference (Deprecated)

> **Use npm scripts instead.** See "Development Commands" at the top of this document.

### Old PM2 Commands (deprecated)

**Start all services:**
```bash
pm2 start ecosystem.config.js
```

**View status:**
```bash
pm2 status
pm2 monit  # Interactive dashboard
```

**View logs:**
```bash
pm2 logs              # All services
pm2 logs server       # Backend only
pm2 logs web          # Frontend only
pm2 logs preview      # Preview only
pm2 logs --lines 100  # Last 100 lines
```

**Restart services:**
```bash
pm2 restart server
pm2 restart web
pm2 restart preview
pm2 restart all
```

**Stop services:**
```bash
pm2 stop server
pm2 stop all
```

**Delete services (stop + remove from list):**
```bash
pm2 delete server
pm2 delete all
```

**Log file locations:**
- Server: `apps/server/tmp/pm2-server-out.log`
- Web: `apps/web/tmp/pm2-web-out.log`
- Preview: `apps/preview/tmp/pm2-preview-out.log`

---

## Dependencies

### Backend Additions (`apps/server/package.json`)
```json
{
  "dependencies": {
    "ws": "^8.x",                    // From Phase 2a
    "@types/ws": "^8.x",             // From Phase 2a
    "kill-port": "2.0.1",
    "@types/kill-port": "2.0.0",
    "@typescript-eslint/parser": "^6.13.0",
    "@typescript-eslint/typescript-estree": "^6.13.0",
    "typescript": "^5.3.0",
    "eslint": "^8.55.0",
    "knip": "^3.0.0",
    "ts-morph": "^21.0.0",
    "zod": "^3.22.4"
  }
}
```

**Key Packages:**
- `ws`, `@types/ws` - WebSocket server (Phase 2a requirement)
- `kill-port` (v2.0.1) - Cross-platform port killing for process cleanup
- `@typescript-eslint/parser` - Parse TSX for AST manipulation
- `typescript` - Type checking generated code
- `eslint` - Linting with custom rules
- `knip` - Detect unused imports/exports
- `ts-morph` - TypeScript AST manipulation
- `zod` - Schema validation for tool parameters (required for tool calling)

### Tool UI (`apps/web/package.json`)
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@mui/material": "^5.15.0",
    "@mui/icons-material": "^5.15.0"
  }
}
```

### Preview Vite (`apps/preview/package.json`)
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@cycledesign/runtime": "workspace:*",
    "@mui/material": "^5.15.0",
    "@mui/icons-material": "^5.15.0"
  }
}
```

**Note:** Preview dependencies are LLM-managed. Base packages above are pre-installed, but LLM can add more via `npm install` in preview directory.

### Runtime Package (`packages/design-system-runtime/package.json`)
```json
{
  "name": "@cycledesign/runtime",
  "version": "0.1.0",
  "main": "src/index.ts",
  "dependencies": {
    "react": "^18.2.0",
    "@mui/material": "^5.15.0"
  }
}
```

---

## Environment Variables

### Backend (`.env`)
```bash
# Existing Phase 1 vars
LLM_PROVIDER=qwen
PORT=3001

# Phase 2a (WebSocket)
WS_PORT=3001

# Phase 3 additions
WORKSPACE_DIR=./workspace
PREVIEW_PORT=3002
```

### Tool UI (`apps/web/.env`)
```bash
# Existing Phase 1 vars
VITE_API_URL=http://localhost:3001

# Phase 2a (WebSocket)
VITE_WS_URL=ws://localhost:3001/ws

# Phase 3 additions
VITE_PREVIEW_URL=http://localhost:3002
```

### Preview (`apps/preview/.env`)
```bash
# Preview has minimal config - runs independently
VITE_TOOL_URL=http://localhost:3000
```

---

## Error Handling Strategy

**Error Categories:**

| Category | Source | LLM Resolution |
|----------|--------|----------------|
| **TypeScript** | tsc compiler | Fix type errors, imports, or component usage |
| **ESLint** | ESLint rules | Fix style/syntax issues |
| **Knip** | Unused imports | Remove unused imports/exports |
| **Dependency** | Missing package | Call `add_dependency` or change imports |
| **Composition** | Design system rules (Phase 4+) | Use valid component nesting |
| **Semantic** | Invalid prop values | Use design system tokens |

**See Also:** Complete error handling, security constraints, and system prompt details in `docs/TOOL_CALLING.md`

---

## API Endpoints

### Preview Server Management

**POST /api/preview/start**
```typescript
// Request (optional)
{
  designName?: string;  // Design to load on start
}

// Response
{
  success: boolean;
  port?: number;        // Assigned port
  url?: string;         // Full preview URL
  status: 'STARTING' | 'RUNNING' | 'ERROR';
}
```

**POST /api/preview/stop**
```typescript
// Response
{
  success: boolean;
  message: string;
}
```

**GET /api/preview/status**
```typescript
// Response
{
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  port?: number;
  url?: string;
  pid?: number;         // Process ID
  uptime?: number;      // Milliseconds since start
}
```

**POST /api/preview/restart**
```typescript
// Request
{
  installDependencies?: boolean;  // Run npm install before restart
}

// Response
{
  success: boolean;
  port: number;
  url: string;
}
```

**POST /api/preview/reset**
```typescript
// Response
{
  success: boolean;
  message: string;
  url?: string;  // Preview URL if server is running
}
```

**Notes:**
- `reset()` copies bootstrap template from `apps/server/resources/templates/app.tsx` to `workspace/designs/app.tsx`
- Deletes all other files in `workspace/designs/` directory
- Does not restart the preview server - only resets the design files
- Useful for reverting to clean state after experimentation
```

**GET /api/preview/logs/stream**
```typescript
// Response (Server-Sent Events)
data: {"type":"stdout","message":"VITE v5.0.0 ready in 500ms","timestamp":1234567890}
data: {"type":"stderr","message":"Failed to resolve import...","timestamp":1234567891}
data: {"type":"ready","port":3002,"timestamp":1234567892}
data: {"type":"exit","code":0,"timestamp":1234567893}
```

### Code Generation (WebSocket)

Code generation is triggered via WebSocket messages (Phase 2a protocol), not REST endpoints.

**Client → Server:**
```typescript
ws.send(JSON.stringify({
  type: 'message',
  id: 'msg_client_1234567890',
  content: 'Create a landing page with hero and features',
  timestamp: Date.now()
}));
```

**Server → Client:**
```typescript
// Immediate acknowledgment
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": Date.now()
}

// Generation complete
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": Date.now()
}
```

**Server-Side Process:**
1. WebSocket message received
2. Immediate acknowledgment sent (Phase 2a protocol)
3. LLM tool calling triggered
4. Backend validates filename constraints
5. Check dependencies
6. Validate code (TypeScript, ESLint, Knip)
7. Inject IDs
8. Write to filesystem
9. Save to session messages
10. Send `done` message to client

**Frontend Usage:**
```typescript
const { sendMessage } = useMessageListState(sessionId);
sendMessage('Create a landing page with hero section and features');
```

**See Also:** Complete WebSocket integration and tool calling flow in `docs/TOOL_CALLING.md`

### Design Management

**GET /api/designs**
```typescript
// Response
[
  {
    name: string;
    filename: string;
    createdAt: string;
    updatedAt: string;
    componentCount: number;
  }
]
```

**GET /api/designs/:name**
```typescript
// Response
{
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
}
```

**PUT /api/designs/:name**
```typescript
// Request
{
  code: string;
}

// Response
{
  success: boolean;
  validationErrors?: Array<...>;
}
```

---

## Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Backend (preview server lifecycle + log streaming) | 2 days |
| Backend (generation + validation + dependency management) | 2-3 days |
| Tool UI (preview server control + log viewer) | 1 day |
| Tool UI (iframe + bridge) | 1 day |
| Preview Vite setup (independent server) | 0.5 day |
| Runtime package (wrappers) | 1 day |
| ID injection system | 1 day |
| Integration testing | 1-2 days |
| Documentation | 0.5 day |
| **Total** | **10-12.5 days** |

---

## Exit Criteria

Phase 3 is complete when:
- [x] Backend can start/stop preview Vite server programmatically
- [x] Preview server status exposed via API
- [ ] Real-time log streaming works (SSE)
- [ ] UI displays preview server controls (start/stop)
- [ ] UI displays real-time preview logs
- [x] User can submit text prompts **via WebSocket**
- [ ] LLM generates valid React/TypeScript code (blocked on OAuth)
- [ ] Generated code passes TypeScript compilation
- [ ] Component IDs are auto-injected
- [x] Design renders in isolated iframe preview (placeholder)
- [ ] Mode switching works (Select / Preview)
- [ ] Component selection highlights instances
- [ ] Error states handled gracefully with suggestions
- [ ] **Generated designs saved to session messages**
- [x] **WebSocket integration with Phase 2a working**
- [x] Documentation complete
- [ ] Code reviewed and merged to main

### Completed Infrastructure
- [x] PM2 manages all 3 services independently
- [x] app.tsx with named App export
- [x] System prompt explains app.tsx setup
- [x] Workspace bootstrapping
- [x] Path resolution for @design alias
- [x] Session auto-selection on page load
- [x] Multi-turn tool calling loop
- [x] Automatic validation fallback

---

## Integration with Phase 2a (WebSocket)

Phase 3 relies on Phase 2a's WebSocket infrastructure for messaging:

**WebSocket Message Types Used:**
- `message` - Send code generation prompts
- `ack` - Server acknowledgment (immediate)
- `content` - Stream generation progress
- `done` - Generation complete
- `error` - Generation/validation errors

**State Management:**
- Use `useMessageListState` hook from Phase 2a
- Optimistic updates for generation prompts
- Server reconciliation via acknowledgment
- Generated designs automatically saved to session

**Benefits:**
- ✅ Real-time generation progress streaming
- ✅ Automatic session persistence
- ✅ No duplicate API calls
- ✅ Consistent with chat messaging
- ✅ Lower latency than REST

---

## Notes for Phase 4

Phase 4 will add:
- Design System Mode (tokens, components, rules as code)
- Direct tool calls for LLM introspection (`list_components`, `get_component`, etc.)
- Validation engine (semantic props, design system rules)
- Select/Preview modes with property editors
- Database index for component usage tracking
- Full build folder transformation pipeline

---

## Appendix: Example Generated Code

### Input Prompt
```
Create a landing page for a SaaS product with:
- Hero section with headline and CTA button
- Features section with 3 feature cards
- Footer with copyright
```

### Generated Output (Phase 3 - Free Form)
```tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Container } from '@mui/material';

export default function LandingPage() {
  return (
    <Box>
      {/* Hero Section */}
      <Box sx={{ bgcolor: 'primary.main', color: 'white', py: 8 }}>
        <Container maxWidth="md">
          <Typography variant="h2" gutterBottom>
            Build Better Products Faster
          </Typography>
          <Typography variant="h6" sx={{ mb: 4 }}>
            The all-in-one platform for modern teams
          </Typography>
          <Button variant="contained" size="large" sx={{ bgcolor: 'white', color: 'primary.main' }}>
            Get Started Free
          </Button>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6">Fast</Typography>
              <Typography variant="body2">Lightning-fast performance</Typography>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6">Secure</Typography>
              <Typography variant="body2">Enterprise-grade security</Typography>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6">Scalable</Typography>
              <Typography variant="body2">Grows with your team</Typography>
            </CardContent>
          </Card>
        </Box>
      </Container>

      {/* Footer */}
      <Box sx={{ bgcolor: 'grey.100', py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          © 2024 SaaS Product. All rights reserved.
        </Typography>
      </Box>
    </Box>
  );
}
```

### After ID Injection
```tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Container } from '@mui/material';

export default function LandingPage() {
  return (
    <Box id="id_landing_0">
      {/* Hero Section */}
      <Box id="id_landing_1" sx={{ bgcolor: 'primary.main', color: 'white', py: 8 }}>
        <Container id="id_landing_2" maxWidth="md">
          <Typography id="id_landing_3" variant="h2" gutterBottom>
            Build Better Products Faster
          </Typography>
          <Typography id="id_landing_4" variant="h6" sx={{ mb: 4 }}>
            The all-in-one platform for modern teams
          </Typography>
          <Button id="id_landing_5" variant="contained" size="large" sx={{ bgcolor: 'white', color: 'primary.main' }}>
            Get Started Free
          </Button>
        </Container>
      </Box>

      {/* Features Section */}
      <Container id="id_landing_6" maxWidth="md" sx={{ py: 8 }}>
        <Box id="id_landing_7" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          <Card id="id_landing_8">
            <CardContent id="id_landing_9">
              <Typography id="id_landing_10" variant="h6">Fast</Typography>
              <Typography id="id_landing_11" variant="body2">Lightning-fast performance</Typography>
            </CardContent>
          </Card>
          <Card id="id_landing_12">
            <CardContent id="id_landing_13">
              <Typography id="id_landing_14" variant="h6">Secure</Typography>
              <Typography id="id_landing_15" variant="body2">Enterprise-grade security</Typography>
            </CardContent>
          </Card>
          <Card id="id_landing_16">
            <CardContent id="id_landing_17">
              <Typography id="id_landing_18" variant="h6">Scalable</Typography>
              <Typography id="id_landing_19" variant="body2">Grows with your team</Typography>
            </CardContent>
          </Card>
        </Box>
      </Container>

      {/* Footer */}
      <Box id="id_landing_20" sx={{ bgcolor: 'grey.100', py: 4, textAlign: 'center' }}>
        <Typography id="id_landing_21" variant="body2" color="text.secondary">
          © 2024 SaaS Product. All rights reserved.
        </Typography>
      </Box>
    </Box>
  );
}
```

### Preview Server Control Example (UI)

```typescript
// Tool UI component
function PreviewServerControl() {
  const [status, setStatus] = useState<'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR'>('STOPPED');
  const [port, setPort] = useState<number | null>(null);
  const [logs, setLogs] = useState<Array<{ type: string; message: string }>>([]);

  // Start server
  const handleStart = async () => {
    const response = await fetch('/api/preview/start', { method: 'POST' });
    const data = await response.json();
    setStatus(data.status);
    setPort(data.port);
  };

  // Stop server
  const handleStop = async () => {
    await fetch('/api/preview/stop', { method: 'POST' });
    setStatus('STOPPED');
    setPort(null);
  };

  // Subscribe to logs (SSE)
  useEffect(() => {
    const eventSource = new EventSource('/api/preview/logs/stream');
    eventSource.onmessage = (event) => {
      const log = JSON.parse(event.data);
      setLogs((prev) => [...prev, log]);
      
      if (log.type === 'ready') {
        setStatus('RUNNING');
        setPort(log.port);
      }
    };
    return () => eventSource.close();
  }, []);

  return (
    <Box>
      <Button onClick={handleStart} disabled={status === 'RUNNING'}>
        Start Preview
      </Button>
      <Button onClick={handleStop} disabled={status !== 'RUNNING'}>
        Stop Preview
      </Button>
      <Typography>Status: {status}</Typography>
      {port && <Typography>Port: {port}</Typography>}
      <LogViewer logs={logs} />
    </Box>
  );
}
```

### After ID Injection (workspace/designs/landing-page.tsx)
```tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Container } from '@mui/material';

export default function LandingPage() {
  return (
    <Box id="id_landing_0">
      {/* Hero Section */}
      <Box id="id_landing_1" sx={{ bgcolor: 'primary.main', color: 'white', py: 8 }}>
        <Container id="id_landing_2" maxWidth="md">
          <Typography id="id_landing_3" variant="h2" gutterBottom>
            Build Better Products Faster
          </Typography>
          {/* ... more components with IDs ... */}
        </Container>
      </Box>
      {/* ... rest of design ... */}
    </Box>
  );
}
```
