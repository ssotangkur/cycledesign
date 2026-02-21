# Phase 3: Prompt-to-UI Rendering

**This document extends `docs/TECHNICAL_DESIGN.md` with Phase 3 implementation details.**

**Relationship to TECHNICAL_DESIGN.md:**
- `TECHNICAL_DESIGN.md` - High-level architecture, canonical tool definitions, system prompts
- `Phase3.md` - Implementation details, timelines, checklists, Phase 3-specific flows

**Cross-References:**
- LLM Tool Definitions â†’ See `TECHNICAL_DESIGN.md` section "LLM Tool Calling for Code Generation"
- System Prompt â†’ See `TECHNICAL_DESIGN.md` section "LLM Tool Calling for Code Generation"
- WebSocket Protocol â†’ See `TECHNICAL_DESIGN.md` section "WebSocket Server (Phase 2a)"
- Component Transformer â†’ See `TECHNICAL_DESIGN.md` section "Component Transformer"
- Database Schema â†’ See `TECHNICAL_DESIGN.md` section "Database"
- MCP Server â†’ See `TECHNICAL_DESIGN.md` section "MCP Server"

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
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ web/                    # Tool UI (Vite instance 1)
â”‚   â”‚   â”œâ”€â”€ index.html
â”‚   â”‚   â”œâ”€â”€ vite.config.ts
â”‚   â”‚   â”œâ”€â”€ package.json        # Tool dependencies (MUI, etc.)
â”‚   â”‚   â””â”€â”€ src/
â”‚   â”‚       â””â”€â”€ main.tsx
â”‚   â”‚
â”‚   â””â”€â”€ preview/                # Preview (Vite instance 2, backend-managed)
â”‚       â”œâ”€â”€ index.html
â”‚       â”œâ”€â”€ vite.config.ts
â”‚       â”œâ”€â”€ package.json        # LLM-managed dependencies
â”‚       â””â”€â”€ src/
â”‚           â””â”€â”€ main.tsx
â”‚
â””â”€â”€ workspace/
    â””â”€â”€ designs/                # LLM-generated design code
        â””â”€â”€ *.tsx
```

**Port Configuration:**
- Tool UI: `http://localhost:3000` (always running)
- Backend + WebSocket: `http://localhost:3001` / `ws://localhost:3001/ws`
- Preview: `http://localhost:3002` (started/stopped by backend, dynamic)

**Rationale:**
- âœ… Complete dependency isolation (LLM can add any npm package)
- âœ… CSS/JS isolation (no style leakage)
- âœ… Independent HMR (preview updates don't affect tool UI)
- âœ… Security boundary (LLM code runs in separate context)
- âœ… Different React versions possible (if needed)
- âœ… Backend controls preview lifecycle (start/stop on demand)
- âš ï¸ Two dev servers to manage (minor complexity tradeoff)

---

### 2. Backend-Managed Preview Server Lifecycle

**Decision:** Backend controls preview Vite server (start/stop/restart) with log streaming

**Architecture:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   Tool UI       â”‚      â”‚   Backend       â”‚      â”‚  Preview Vite   â”‚
â”‚   (port 3000)   â”‚â—„â”€â”€â”€â”€â–ºâ”‚   (port 3001)   â”‚â—„â”€â”€â”€â”€â–ºâ”‚  (port 3002)    â”‚
â”‚                 â”‚      â”‚                 â”‚      â”‚                 â”‚
â”‚ - iframe embed  â”‚      â”‚ - spawn Vite    â”‚      â”‚ - serves design â”‚
â”‚ - log display   â”‚      â”‚ - log streaming â”‚      â”‚ - HMR           â”‚
â”‚ - start/stop UI â”‚      â”‚ - API endpoints â”‚      â”‚ - React render  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚                        â”‚                        â”‚
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                          postMessage (3000 â†” 3002)
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
- âœ… Centralized control (backend manages all services)
- âœ… Real-time visibility (logs streamed to UI)
- âœ… Resource efficiency (stop when not needed)
- âœ… MCP-ready (future: expose as MCP tools)
- âœ… Error recovery (auto-restart, status monitoring)

### 3. iframe Sandboxing

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

### 2.5. UI Layout Architecture

**Decision:** Full-width header with two-pane split layout (left: chat/sessions, right: preview) with resizable divider

**Layout Structure:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    Full-Width Header Bar                    â”‚
â”‚                    CycleDesign Logo + Nav                   â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                  â”‚                          â”‚
â”‚         Left Pane                â”‚      Right Pane          â”‚
â”‚      (Chat + Sessions)           â”‚    (Preview iframe)      â”‚
â”‚      (resizable width)           â”‚    (flex remaining)      â”‚
â”‚                                  â”‚                          â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚    Session Selector      â”‚   â”‚  â”‚                    â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤   â”‚  â”‚                    â”‚  â”‚
â”‚  â”‚                          â”‚   â”‚  â”‚                    â”‚  â”‚
â”‚  â”‚     Message List         â”‚   â”‚  â”‚   Preview iframe   â”‚  â”‚
â”‚  â”‚                          â”‚   â”‚  â”‚   (port 3002)      â”‚  â”‚
â”‚  â”‚                          â”‚   â”‚  â”‚                    â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤   â”‚  â”‚                    â”‚  â”‚
â”‚  â”‚     Prompt Input         â”‚   â”‚  â”‚                    â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤   â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚  â”‚    Status Bar            â”‚   â”‚                          â”‚
â”‚  â”‚  (connection status)     â”‚   â”‚                          â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚                          â”‚
â”‚                                  â”‚                          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
          â†• draggable divider â†•
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
- âœ… Clear visual separation between chat and preview
- âœ… Side-by-side workflow (chat with LLM while viewing results)
- âœ… User can adjust pane widths based on task (more chat space vs more preview space)
- âœ… Maximize preview real estate when needed
- âœ… Persistent chat context visible during preview interaction
- âœ… No layout shift when preview starts/stops
- âœ… Header adapts to content (better for future additions)
- âš ï¸ Requires careful handling of divider drag boundaries

---

### 3. Design Code Storage

**Decision:** Store generated code in `workspace/designs/` directory

**File Structure:**
```
workspace/
â””â”€â”€ designs/
    â”œâ”€â”€ landing-page.tsx
    â”œâ”€â”€ dashboard.tsx
    â””â”€â”€ *.tsx
```

**File Naming:**
- User-provided name slugified (e.g., "Landing Page" â†’ `landing-page.tsx`)
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

### 4. Code Generation Flow (WebSocket-Based)

**Decision:** LLM generates complete TSX file with imports using **tool calling** for structured output, triggered via WebSocket

**WebSocket Integration:**
- User sends code generation prompt via WebSocket (Phase 2a protocol)
- Message includes client-generated ID for optimistic updates
- Server acknowledges immediately, then processes generation
- Generated design saved to session messages automatically

**Message Flow:**
```typescript
// Client â†’ Server (via WebSocket)
{
  "type": "message",
  "id": "msg_client_1234567890",
  "content": "Create a landing page with animations",
  "timestamp": 1705312210000
}

// Server â†’ Client (immediate acknowledgment)
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": 1705312211000
}

// Server processes generation (tool calling happens server-side)
// Server sends status updates for each tool call

// Server â†’ Client (tool call status: starting)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_start",
  "tool": "addDependency",
  "details": "Installing framer-motion package..."
}

// Server â†’ Client (tool call status: complete)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_complete",
  "tool": "addDependency",
  "details": "Package installed successfully"
}

// Server â†’ Client (next tool call)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_start",
  "tool": "createFile",
  "details": "Generating landing-page.tsx..."
}

// Server â†’ Client (tool call complete)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_complete",
  "tool": "createFile",
  "details": "File created successfully"
}

// Server â†’ Client (validation starting)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "validation_start",
  "details": "Running TypeScript compilation..."
}

// Server â†’ Client (validation complete)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "validation_complete",
  "details": "All validations passed"
}

// Server â†’ Client (preview starting)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "preview_start",
  "details": "Starting preview server..."
}

// Server â†’ Client (streaming content response)
{
  "type": "content",
  "content": "Created landing page with hero section and animations!"
}

// Server â†’ Client (done)
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": 1705312220000
}
```

**Status Message Types:**

| Status Type | Description | Display in Chat |
|-------------|-------------|-----------------|
| `tool_call_start` | A tool is about to execute | Info badge: "Installing package..." |
| `tool_call_complete` | Tool executed successfully | Success badge: "Package installed" |
| `tool_call_error` | Tool execution failed | Error badge: "Failed to install package" |
| `validation_start` | Validation pipeline starting | Info badge: "Validating code..." |
| `validation_complete` | All validations passed | Success badge: "Validation passed" |
| `validation_error` | Validation failed | Error badge with details |
| `preview_start` | Preview server starting | Info badge: "Starting preview..." |
| `preview_ready` | Preview server ready | Success badge: "Preview ready" |
| `preview_error` | Preview server failed | Error badge: "Preview failed to start" |

**Tool Calling Architecture:**

The LLM uses **7 separate tools** (defined in `apps/server/src/llm/tools/`):

1. **createFile** - Create new design files
2. **editFile** - Modify existing designs (patch-based)
3. **renameFile** - Rename design files
4. **deleteFile** - Delete design files
5. **addDependency** - Add npm packages to preview environment
6. **submitWork** - Signal completion and trigger validation (REQUIRED when done)
7. **askUser** - Request clarification from user

**Why Separate Tools (not single generateCode tool):**
- âœ… Modular workflow (LLM can make multiple changes before validation)
- âœ… Patch-based editing (editFile uses unified diff for efficiency)
- âœ… Clear separation of concerns (create vs edit vs delete)
- âœ… Better error handling (each tool has specific validation)
- âœ… Multi-turn conversations (LLM can fix errors incrementally)
- âœ… User in the loop (askUser for clarification, submitWork for completion)

**Tool Definitions:** See `docs/TECHNICAL_DESIGN.md` section "LLM Tool Calling for Code Generation" for complete tool schemas.

**LLM Instructions:**
- Export default React functional component
- Do NOT add `id` props (system will inject them)
- Use TypeScript with proper types
- May add dependencies to `apps/preview/package.json` if needed
- Use tool calling to return structured output (not markdown blocks)
- **MUST call submitWork when completely done** (triggers validation + preview start)

**Frontend Integration:**
```typescript
// Use Phase 2a's useMessageListState hook
function CodeGenerationInput() {
  const { sendMessage, isConnected } = useMessageListState(sessionId);
  const [prompt, setPrompt] = useState('');
  
  const handleSubmit = () => {
    sendMessage(prompt);  // Sends via WebSocket
    setPrompt('');
  };
  
  return (
    <Box>
      <TextField 
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        disabled={!isConnected}
        placeholder="Describe the UI you want to create..."
      />
      <Button onClick={handleSubmit} disabled={!prompt.trim() || !isConnected}>
        Generate
      </Button>
    </Box>
  );
}
```

---

### 4.1. Server-Side Tool Calling with Status Broadcasting

**Decision:** Broadcast tool execution status to clients via WebSocket in real-time

**Implementation:**
```typescript
// apps/server/src/websocket/status-broadcaster.ts
import { WebSocket } from 'ws';

interface StatusMessage {
  type: 'status';
  messageId: string;  // Original message ID that triggered generation
  status: 
    | 'tool_call_start'
    | 'tool_call_complete'
    | 'tool_call_error'
    | 'validation_start'
    | 'validation_complete'
    | 'validation_error'
    | 'preview_start'
    | 'preview_ready'
    | 'preview_error';
  tool?: string;  // Tool name (for tool_call_* statuses)
  details: string;  // User-friendly description
  timestamp: number;
}

export class StatusBroadcaster {
  private clients: Set<WebSocket>;
  
  constructor() {
    this.clients = new Set();
  }
  
  addClient(ws: WebSocket) {
    this.clients.add(ws);
  }
  
  removeClient(ws: WebSocket) {
    this.clients.delete(ws);
  }
  
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
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    
    // Broadcast start
    statusBroadcaster.sendToolCallStart(
      messageId,
      toolName,
      getToolStartMessage(toolName, toolCall.function.arguments)
    );
    
    try {
      // Execute tool
      const result = await executeTool(toolCall);
      
      // Broadcast success
      statusBroadcaster.sendToolCallComplete(
        messageId,
        toolName,
        getToolCompleteMessage(toolName, result)
      );
    } catch (error) {
      // Broadcast error
      statusBroadcaster.sendToolCallError(
        messageId,
        toolName,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }
}

function getToolStartMessage(tool: string, args: any): string {
  switch (tool) {
    case 'addDependency':
      return `Installing ${args.packageName}...`;
    case 'createFile':
      return `Creating ${args.filename}...`;
    case 'editFile':
      return `Editing ${args.filename}...`;
    default:
      return `Executing ${tool}...`;
  }
}

function getToolCompleteMessage(tool: string, result: any): string {
  switch (tool) {
    case 'addDependency':
      return `Package installed successfully`;
    case 'createFile':
      return `File created: ${result.filename}`;
    case 'editFile':
      return `File updated: ${result.filename}`;
    default:
      return `${tool} completed`;
  }
}
```

**Validation Pipeline Integration:**
```typescript
// apps/server/src/validation/pipeline.ts
import { statusBroadcaster } from '../websocket/status-broadcaster';

export async function validateDesign(
  code: string,
  messageId: string
): Promise<ValidationResult> {
  // Stage 1: Dependency Check
  statusBroadcaster.sendValidationStart(messageId, 'dependency check');
  await checkDependencies(code);
  
  // Stage 2: TypeScript Compilation
  statusBroadcaster.sendValidationStart(messageId, 'TypeScript compilation');
  const tsResult = await compileTypeScript(code);
  if (!tsResult.success) {
    throw new Error(`TypeScript error: ${tsResult.error}`);
  }
  
  // Stage 3: ESLint
  statusBroadcaster.sendValidationStart(messageId, 'ESLint check');
  const eslintResult = await runESLint(code);
  if (!eslintResult.success) {
    throw new Error(`ESLint error: ${eslintResult.error}`);
  }
  
  // Stage 4: ID Injection
  statusBroadcaster.sendValidationStart(messageId, 'ID injection');
  const injectedCode = injectIds(code);
  
  // All validations passed
  statusBroadcaster.sendValidationComplete(messageId);
  
  return {
    success: true,
    code: injectedCode,
  };
}
```

**Preview Server Integration:**
```typescript
// apps/server/src/preview/preview-manager.ts
import { statusBroadcaster } from '../websocket/status-broadcaster';

export class PreviewManager {
  async start(messageId?: string) {
    if (messageId) {
      statusBroadcaster.sendPreviewStart(messageId);
    }
    
    // Spawn Vite process...
    const port = await this.spawnVite();
    
    if (messageId) {
      statusBroadcaster.sendPreviewReady(messageId, port);
    }
    
    return { port, status: 'RUNNING' };
  }
}
```

**WebSocket Handler Integration:**
```typescript
// apps/server/src/websocket/handler.ts
import { statusBroadcaster } from './status-broadcaster';

export function handleWebSocketConnection(ws: WebSocket) {
  // Add client to status broadcaster
  statusBroadcaster.addClient(ws);
  
  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'message') {
      // Process generation request
      await handleGenerationRequest(message);
    }
  });
  
  ws.on('close', () => {
    statusBroadcaster.removeClient(ws);
  });
}
```

**Frontend Status Message Component:**
```typescript
// apps/web/src/components/chat/StatusMessage.tsx
import { Box, Chip, Typography, Collapse } from '@mui/material';
import { useState } from 'react';

interface StatusMessageProps {
  status: 'tool_call_start' | 'tool_call_complete' | 'tool_call_error' |
          'validation_start' | 'validation_complete' | 'validation_error' |
          'preview_start' | 'preview_ready' | 'preview_error';
  tool?: string;
  details: string;
}

export function StatusMessage({ status, tool, details }: StatusMessageProps) {
  const [expanded, setExpanded] = useState(false);
  
  const getColor = () => {
    if (status.includes('_start')) return 'info';
    if (status.includes('_complete') || status.includes('_ready')) return 'success';
    if (status.includes('_error')) return 'error';
    return 'default';
  };
  
  const getIcon = () => {
    if (status.includes('_start')) return <CircularProgress size={16} />;
    if (status.includes('_complete') || status.includes('_ready')) return <CheckCircleIcon />;
    if (status.includes('_error')) return <ErrorIcon />;
    return null;
  };
  
  return (
    <Box 
      sx={{ 
        py: 0.5, 
        px: 1, 
        bgcolor: 'action.hover',
        borderRadius: 1,
        my: 0.5,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <Chip
        icon={getIcon()}
        label={tool ? `${tool}: ${details}` : details}
        color={getColor() as any}
        size="small"
        variant="outlined"
      />
      <Collapse in={expanded}>
        <Typography variant="caption" color="text.secondary">
          {status} at {new Date().toLocaleTimeString()}
        </Typography>
      </Collapse>
    </Box>
  );
}
```

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

### 5. Validation Pipeline

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
      â†“
Check imports vs installed packages
      â†“
Install missing dependencies (apps/preview/package.json)
      â†“
TypeScript compile (tsc)
      â†“
ESLint check (eslint)
      â†“
Knip check (unused imports/exports)
      â†“
ID injection (parser)
      â†“
Write to workspace/designs/
      â†“
Preview Vite HMR picks up change
      â†“
Render in preview iframe
```

**Error Handling:**
- If validation fails: Show error panel with suggestions
- Offer to retry generation with error feedback
- Allow user to see raw generated code for debugging
- Dependency install failures blocked with clear error message

---

### 6. ID Injection System

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

### 6.1. Component Transformer Pipeline

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
â””â”€â”€ designs/
    â”œâ”€â”€ landing-page.tsx      # Transformed code with wrappers
    â””â”€â”€ *.tsx
```

**See `docs/TECHNICAL_DESIGN.md` section "Component Transformer"** for complete implementation details.

---

### 6.2. Database Schema

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

**See `docs/TECHNICAL_DESIGN.md` section "Database"** for complete schema details.

---

### 6.3. MCP Server Integration

**Purpose:** Expose design system to LLM for introspection during code generation

**Location:** `apps/server/src/mcp/`

**MCP Tools Available to LLM:**
- `list_components` - Return all available components with summaries
- `get_component(name)` - Return full component definition (props, variants)
- `get_tokens(type)` - Return design tokens by category
- `check_composition_rules(parent, child)` - Validate component nesting
- `search_components(query)` - Find components by semantic purpose

**Phase 3 Usage:**
In Phase 3 (free-form generation), MCP tools are **not yet enforced**. LLM can use any React components. MCP integration becomes critical in Phase 4 (Design System Mode).

**See `docs/TECHNICAL_DESIGN.md` section "MCP Server"** for complete tool definitions.

---

### 7. Preview Communication Bridge

**Decision:** postMessage API for cross-origin communication (3000 â†” 3002)

**Message Types:**
```typescript
// Parent (tool UI, port 3000) â†’ Iframe (preview, port 3002)
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

// Iframe (preview, port 3002) â†’ Parent (tool UI, port 3000)
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

### 8. Preview Vite Entry Point

**Decision:** Preview loads design dynamically via import alias

**Preview Structure:**
```
apps/preview/
â”œâ”€â”€ index.html
â”œâ”€â”€ vite.config.ts
â”œâ”€â”€ package.json        # Base dependencies (react, react-dom)
â””â”€â”€ src/
    â””â”€â”€ main.tsx        # Dynamic design loader
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

// Dynamic import - changes based on current design
import Design from '@design/current.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Design />
  </React.StrictMode>
);
```

**Design Switching:**
- Backend copies selected design to `workspace/designs/current.tsx`
- Preview Vite HMR auto-reloads on file change
- No page refresh needed

**Log Output:**
- Vite dev server logs captured by backend (stdio)
- Logs streamed to UI via SSE
- Errors visible in real-time for debugging

---

## Unified Task List (Implementation + Verification)

**Total: 48 tasks** (24 implementation + 24 verification)

**Legend:**
- 🔨 = Implementation task
- ✅ = Verification task
- Each verification task depends on its preceding implementation task

---

### Phase 3A: Preview Server Foundation

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **1** | 🔨 | **Create pps/preview/ directory structure**<br>- package.json (react, react-dom, @cycledesign/runtime)<br>- index.html<br>- ite.config.ts (@design alias, port 3002, cors)<br>- src/main.tsx (dynamic design loader) | None | Preview directory exists with all config files |
| **2** | ✅ | **Validate preview Vite config**<br>- Run 
pm install in pps/preview/<br>- Run 
pm run dev manually<br>- Verify Vite starts on port 3002 | Task 1 | Vite dev server starts without errors |
| **3** | 🔨 | **Implement PreviewManager class** (pps/server/src/preview/preview-manager.ts)<br>- start() - spawn Vite child process<br>- stop() - graceful shutdown<br>- getStatus() - return state<br>- 
estart() - stop + start<br>- State: STOPPED, STARTING, RUNNING, ERROR | None | PreviewManager compiles, methods defined |
| **4** | ✅ | **Test PreviewManager start/stop**<br>- Write unit test: start → status=RUNNING → stop → status=STOPPED<br>- Verify port detection from Vite output<br>- Verify graceful shutdown (SIGTERM → SIGKILL after 5s) | Task 3 | Unit tests pass |
| **5** | 🔨 | **Create preview API endpoints** (pps/server/src/routes/preview.ts)<br>- POST /api/preview/start<br>- POST /api/preview/stop<br>- GET /api/preview/status<br>- POST /api/preview/restart | Task 3 | Endpoints registered, return correct responses |
| **6** | ✅ | **Test preview API endpoints**<br>- Use Chrome DevTools MCP to call each endpoint<br>- Verify state transitions<br>- Verify error handling (e.g., stop when already stopped) | Task 5 | All endpoints work via MCP testing |
| **7** | 🔨 | **Implement LogStreamer class** (pps/server/src/preview/log-streamer.ts)<br>- Capture stdout/stderr<br>- Buffer last 1000 logs<br>- Emit events to subscribers<br>- GET /api/preview/logs/stream SSE endpoint | Task 3 | LogStreamer compiles, SSE endpoint registered |
| **8** | ✅ | **Test log streaming**<br>- Start preview server<br>- Connect to SSE endpoint<br>- Verify logs stream in real-time<br>- Verify buffer works for late connections | Task 7 | Logs stream correctly via SSE |

---

### Phase 3B: Validation Pipeline

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **9** | 🔨 | **Create TypeScript validation runner** (pps/server/src/validation/typescript.ts)<br>- Run 	sc on generated code<br>- Return success/failure with line/column errors | None | TypeScript runner compiles and executes |
| **10** | ✅ | **Test TypeScript validation**<br>- Test with valid TSX code → success<br>- Test with type errors → failure with details<br>- Test with syntax errors → failure with details | Task 9 | Validation returns correct results |
| **11** | 🔨 | **Create ESLint validation runner** (pps/server/src/validation/eslint.ts)<br>- Run eslint on generated code<br>- Return success/failure with rule violations | Task 9 | ESLint runner compiles and executes |
| **12** | ✅ | **Test ESLint validation**<br>- Test with clean code → success<br>- Test with lint errors → failure with details | Task 11 | ESLint returns correct results |
| **13** | 🔨 | **Create Knip validation runner** (pps/server/src/validation/knip.ts)<br>- Run knip to detect unused imports/exports<br>- Return success/failure with unused items | Task 9 | Knip runner compiles and executes |
| **14** | ✅ | **Test Knip validation**<br>- Test with clean imports → success<br>- Test with unused imports → failure with details | Task 13 | Knip returns correct results |
| **15** | 🔨 | **Implement ID injector** (pps/server/src/parser/id-injector.ts)<br>- Parse TSX with AST<br>- Generate unique IDs for JSX elements<br>- Preserve existing IDs<br>- Write back to source file | None | ID injector compiles |
| **16** | ✅ | **Test ID injection**<br>- Input: TSX without IDs<br>- Output: TSX with IDs on all elements<br>- Verify IDs are unique<br>- Verify existing IDs preserved | Task 15 | IDs injected correctly |
| **17** | 🔨 | **Create dependency manager** (pps/server/src/preview/dependency-manager.ts)<br>- Parse imports from code<br>- Check against installed packages<br>- Add missing to pps/preview/package.json<br>- Run 
pm install | None | Dependency manager compiles |
| **18** | ✅ | **Test dependency management**<br>- Code imports ramer-motion (not installed)<br>- Verify package added and installed<br>- Verify error on invalid package name | Task 17 | Dependencies managed correctly |

---

### Phase 3C: WebSocket Integration

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **19** | 🔨 | **Implement StatusBroadcaster** (pps/server/src/websocket/status-broadcaster.ts)<br>- Track connected WebSocket clients<br>- Broadcast status messages<br>- Methods: sendToolCallStart/Complete/Error, sendValidation*, sendPreview* | None | StatusBroadcaster compiles |
| **20** | ✅ | **Test status broadcasting**<br>- Connect mock WebSocket client<br>- Broadcast each status type<br>- Verify client receives all messages | Task 19 | Status messages broadcast correctly |
| **21** | 🔨 | **Create LLM tool definitions** (pps/server/src/llm/tools/)<br>- createFile.ts (Zod schema)<br>- editFile.ts (patch-based)<br>- ddDependency.ts<br>- submitWork.ts (empty args)<br>- skUser.ts | None | All 7 tools defined with Zod schemas |
| **22** | ✅ | **Test tool schemas**<br>- Validate each tool with valid params → success<br>- Validate with invalid params → rejection<br>- Verify file constraints (kebab-case, .tsx, designs/) | Task 21 | All schemas validate correctly |
| **23** | 🔨 | **Integrate tool calling with WebSocket** (pps/server/src/ws/handler.ts)<br>- Handle message type for code generation<br>- Trigger LLM tool calling<br>- Broadcast status during execution<br>- Save generated designs to session | Task 19, 21 | WebSocket handler processes generation requests |
| **24** | ✅ | **Test WebSocket code generation flow**<br>- Send generation prompt via WebSocket<br>- Verify ack received<br>- Verify status messages streamed<br>- Verify design saved to session | Task 23 | Full WebSocket flow works |

---

### Phase 3D: Frontend UI

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **25** | 🔨 | **Create two-pane layout** (pps/web/src/layouts/MainLayout.tsx)<br>- Full-width header (auto height)<br>- Resizable split pane (left 30-70%, right flex)<br>- Draggable divider with visual feedback<br>- Left: SessionSelector, MessageList, PromptInput, ConnectionStatus<br>- Right: PreviewFrame placeholder | None | Layout renders, divider drags |
| **26** | ✅ | **Test layout with Chrome DevTools MCP**<br>- Verify divider drags smoothly<br>- Verify min/max width constraints<br>- Verify pane resizing doesn't cause layout shift | Task 25 | Layout works correctly |
| **27** | 🔨 | **Create preview server controls** (pps/web/src/preview/PreviewServerStatus.tsx)<br>- Start/Stop buttons<br>- Display current state<br>- Show current port<br>- Auto-start on first generation | Task 5 | Controls render, buttons work |
| **28** | ✅ | **Test server controls**<br>- Click start → server starts → status=RUNNING<br>- Click stop → server stops → status=STOPPED<br>- Verify port displayed correctly | Task 27 | Controls work end-to-end |
| **29** | 🔨 | **Create log viewer** (pps/web/src/preview/PreviewLogViewer.tsx)<br>- Scrollable log display<br>- Color-code log levels<br>- Auto-scroll to latest<br>- Pause/resume, clear, filter | Task 7 | Log viewer renders, scrolls |
| **30** | ✅ | **Test log viewer**<br>- Start preview server<br>- Verify logs stream in real-time<br>- Verify auto-scroll works<br>- Verify pause/resume works | Task 29 | Logs display correctly |
| **31** | 🔨 | **Create preview iframe** (pps/web/src/preview/PreviewFrame.tsx)<br>- Point to dynamic preview URL<br>- Handle load events<br>- Error boundary<br>- Loading skeleton | Task 5 | Iframe renders, loads preview |
| **32** | ✅ | **Test preview iframe**<br>- Start preview server<br>- Verify iframe loads preview URL<br>- Verify loading state during start<br>- Verify error state on failure | Task 31 | Iframe works correctly |
| **33** | 🔨 | **Create status message component** (pps/web/src/components/chat/StatusMessage.tsx)<br>- Display tool call progress<br>- Support all status types<br>- Color coding (info/success/error)<br>- Expandable details | Task 19 | StatusMessage renders |
| **34** | ✅ | **Test status messages in chat**<br>- Trigger code generation<br>- Verify status messages appear inline<br>- Verify color coding correct<br>- Verify expand/collapse works | Task 33 | Status messages display correctly |

---

### Phase 3E: Runtime Package

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **35** | 🔨 | **Create runtime package** (packages/design-system-runtime/)<br>- package.json<br>- src/index.ts exports<br>- Add to preview package.json as dependency | None | Package exists, exports defined |
| **36** | ✅ | **Validate runtime package**<br>- Import in preview<br>- Verify no import errors<br>- Verify package resolves correctly | Task 35 | Package imports without errors |
| **37** | 🔨 | **Create wrapper components**<br>- AuditWrapper (audit mode highlighting)<br>- SelectionBox (selection bounding box)<br>- Style with MUI sx prop | Task 35 | Wrappers compile |
| **38** | ✅ | **Test wrapper components**<br>- Render in preview with sample design<br>- Verify AuditWrapper applies highlight styles<br>- Verify SelectionBox shows bounding box | Task 37 | Wrappers render correctly |

---

### Phase 3F: Integration & E2E

| # | Type | Task | Dependencies | Done Criteria |
|---|------|------|--------------|---------------|
| **39** | 🔨 | **Implement postMessage bridge** (pps/web/src/hooks/useIframeBridge.ts)<br>- Send: SET_MODE, HIGHLIGHT_COMPONENT<br>- Receive: COMPONENT_SELECTED, MODE_READY<br>- Origin validation | Task 31 | Bridge hook compiles |
| **40** | ✅ | **Test postMessage bridge**<br>- Send mode change to iframe<br>- Verify iframe receives message<br>- Simulate iframe event<br>- Verify parent receives event | Task 39 | Bridge works bidirectionally |
| **41** | 🔨 | **Implement mode switching UI**<br>- Toggle: Select / Preview / Audit<br>- Visual indicator of current mode<br>- Send mode changes via bridge | Task 33, 39 | Mode toggle renders |
| **42** | ✅ | **Test mode switching**<br>- Toggle between modes<br>- Verify visual indicator updates<br>- Verify iframe receives mode change | Task 41 | Mode switching works |
| **43** | 🔨 | **Implement full generation flow**<br>- Wire prompt input to WebSocket<br>- Handle optimistic updates<br>- Display status messages<br>- Auto-start preview on success | Task 23, 33 | Generation flow wired |
| **44** | ✅ | **Test full generation flow**<br>- Submit prompt: " Create landing page\<br>- Verify ack received<br>- Verify status messages displayed<br>- Verify preview starts automatically<br>- Verify design renders in iframe | Task 43 | Full flow works end-to-end |
| **45** | 🔨 | **Implement error handling**<br>- Display validation errors<br>- Show retry button<br>- Handle preview server failures<br>- Handle WebSocket disconnection | Task 43 | Error states handled |
| **46** | ✅ | **Test error scenarios**<br>- Submit invalid prompt → verify error displayed<br>- Stop preview server → verify error state<br>- Disconnect WebSocket → verify reconnection | Task 45 | Errors handled gracefully |
| **47** | 🔨 | **Run full validation suite**<br>- 
pm run validate (ESLint + Knip)<br>- Fix any issues | All previous | Validation passes |
| **48** | ✅ | **Final E2E test with Chrome DevTools MCP**<br>- Complete flow: create session → submit prompt → view design<br>- Verify all exit criteria met<br>- Check console for errors | Task 47 | All exit criteria met, no errors |

---

## Exit Criteria (Outcomes)

Phase 3 is complete when all **48 tasks above** are checked off AND the following outcomes are verified:

### Backend Outcomes (6)
- [ ] Preview server can be started/stopped programmatically
- [ ] Preview status exposed via GET /api/preview/status
- [ ] Real-time log streaming works via SSE
- [ ] Validation pipeline runs (TypeScript, ESLint, Knip)
- [ ] ID injection adds system-managed IDs to components
- [ ] Generated designs saved to session messages

### Frontend Outcomes (6)
- [ ] UI displays preview server controls (start/stop/status)
- [ ] UI displays real-time preview logs
- [ ] UI displays two-pane layout (chat left, preview right)
- [ ] Design renders in isolated iframe
- [ ] Mode switching works (Select / Preview / Audit)
- [ ] Status messages display tool call progress

### Integration Outcomes (5)
- [ ] User can submit text prompts via WebSocket
- [ ] LLM generates valid React/TypeScript code via tool calling
- [ ] Generated code passes TypeScript compilation
- [ ] Error states handled gracefully with suggestions
- [ ] End-to-end flow: prompt → code → validation → preview

---

## Old Implementation Checklist (Deprecated)

*The following checklist has been replaced by the unified task list above. It is kept here for reference.*

<details>
<summary>Click to expand deprecated checklist</summary>

### Backend Setup

- [ ] **1.0** Implement LLM tool calling for code generation
- [ ] **1.1** Create preview server lifecycle management
- [ ] **1.2** Create preview server API endpoints
- [ ] **1.3** Implement log streaming (SSE)
- [ ] **1.4** Integrate code generation with WebSocket
- [ ] **1.4.1** Implement WebSocket status messaging for tool calls
- [ ] **1.5** Implement validation pipeline
- [ ] **1.6** Implement dependency management
- [ ] **1.7** Implement ID injection
- [ ] **1.8** Create design file management

### Preview Vite Setup

- [ ] **2.1** Initialize preview Vite instance
- [ ] **2.2** Configure dynamic port assignment

### Frontend Setup

- [ ] **2.3** Implement two-pane layout architecture
- [ ] **2.4** Create preview server control UI
- [ ] **2.5** Implement tool call status messaging
- [ ] **2.6** Create log viewer component
- [ ] **2.7** Create preview iframe component
- [ ] **2.8** Implement communication bridge
- [ ] **2.9** Build prompt input UI
- [ ] **2.10** Create design generation UI
- [ ] **2.11** Implement mode switching

### Runtime Package

- [ ] **3.1** Create design system runtime package
- [ ] **3.2** Implement wrapper components

### Integration & Testing

- [ ] **4.1** Test code generation flow
- [ ] **4.2** Test error scenarios
- [ ] **4.3** Test performance

</details>

---
## Dependencies

### Backend Additions (`apps/server/package.json`)
```json
{
  "dependencies": {
    "ws": "^8.x",                    // From Phase 2a
    "@types/ws": "^8.x",             // From Phase 2a
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

## LLM Tool Definitions

**See `docs/TECHNICAL_DESIGN.md` section "LLM Tool Calling for Code Generation" (lines 215-508)** for complete tool definitions including:

- `createFile` - Create new design files
- `editFile` - Modify existing designs (patch-based)
- `renameFile` - Rename design files
- `deleteFile` - Delete design files
- `addDependency` - Add npm packages to preview environment
- `submitWork` - Signal completion and trigger validation (REQUIRED when done)
- `askUser` - Request clarification from user

**Key Points:**
- All tools enforce file constraints (.tsx only, designs/ directory, kebab-case filenames)
- `submitWork` MUST be called when LLM is completely done (triggers validation + preview start)
- `submitWork` takes empty arguments `{}` - system automatically tracks changes
- See "Multi-Turn Tool Calling Workflow" below for complete flow example

---

## Multi-Turn Tool Calling Workflow

**Phase 1: LLM Staging Changes**
```
User: "Create a landing page with animations"
         â”‚
         â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LLM Tool Calls         â”‚
â”‚  (multiple, staged)     â”‚
â”‚                         â”‚
â”‚  1. addDependency       â”‚
â”‚     {packageName:       â”‚
â”‚      "framer-motion"}   â”‚
â”‚                         â”‚
â”‚  2. createFile          â”‚
â”‚     {filename:          â”‚
â”‚      "landing-page.tsx",â”‚
â”‚      code: "..."}       â”‚
â”‚                         â”‚
â”‚  3. submitWork          â”‚
â”‚     {}  â† EMPTY!        â”‚
â”‚         System tracks:  â”‚
â”‚         - filesCreated  â”‚
â”‚         - dependencies  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         â”‚ Triggers validation + preview start
         â–¼
```

**Phase 2: Validation Pipeline**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Validation Pipeline    â”‚
â”‚                         â”‚
â”‚  1. Check dependencies  â”‚
â”‚     âœ… framer-motion    â”‚
â”‚        installed        â”‚
â”‚                         â”‚
â”‚  2. TypeScript compile  â”‚
â”‚     âŒ Error: Line 42   â”‚
â”‚        "Property 'x'    â”‚
â”‚        does not exist"  â”‚
â”‚                         â”‚
â”‚  3. ESLint              â”‚
â”‚     (skipped - TS fail) â”‚
â”‚                         â”‚
â”‚  4. ID Injection        â”‚
â”‚     (skipped - TS fail) â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         â”‚ Validation failed
         â–¼
```

**Phase 3: Error Feedback to LLM**
```
Backend â†’ LLM:
{
  "status": "validation_failed",
  "errors": [
    {
      "type": "typescript",
      "file": "landing-page.tsx",
      "line": 42,
      "column": 12,
      "message": "Property 'x' does not exist on type 'BoxProps'",
      "code": "TS2322"
    }
  ],
  "instruction": "Please fix these errors and call submitWork again"
}
         â”‚
         â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LLM Fixes Errors       â”‚
â”‚                         â”‚
â”‚  1. editFile            â”‚
â”‚     {filename:          â”‚
â”‚      "landing-page.tsx",â”‚
â”‚      patch: "@@ -42..."}â”‚
â”‚                         â”‚
â”‚  2. submitWork          â”‚
â”‚     {}  â† EMPTY again!  â”‚
â”‚         (triggers       â”‚
â”‚          validation)    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         â”‚ Triggers validation again
         â–¼
```

**Phase 4: Success**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Validation Pipeline    â”‚
â”‚                         â”‚
â”‚  1. Check dependencies  â”‚
â”‚     âœ…                  â”‚
â”‚  2. TypeScript compile  â”‚
â”‚     âœ…                  â”‚
â”‚  3. ESLint              â”‚
â”‚     âœ…                  â”‚
â”‚  4. ID Injection        â”‚
â”‚     âœ… (15 IDs added)   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         âœ… Success!
         â”‚
         â–¼
Preview server reloads with new design
```

---

## Error Handling Strategy

**Error Categories:**

| Category | Source | LLM Resolution |
|----------|--------|----------------|
| **TypeScript** | tsc compiler | Fix type errors, imports, or component usage |
| **ESLint** | ESLint rules | Fix style/syntax issues |
| **Knip** | Unused imports | Remove unused imports/exports |
| **Dependency** | Missing package | Call `addDependency` or change imports |
| **Composition** | Design system rules (Phase 4+) | Use valid component nesting |
| **Semantic** | Invalid prop values | Use design system tokens |

**Error Response Format:**
```typescript
interface ValidationError {
  type: 'typescript' | 'eslint' | 'knip' | 'dependency';
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;  // Error code (e.g., "TS2322")
  suggestion?: string;  // Optional fix suggestion
}

interface SubmitWorkResponse {
  status: 'success' | 'validation_failed' | 'user_input_required';
  errors?: ValidationError[];
  warnings?: ValidationError[];
  message?: string;
  userQuestion?: {  // If LLM called askUser
    question: string;
    context: string;
    suggestions?: string[];
  };
}
```

---

## askUser Flow Example

```
User: "Create a dashboard for my SaaS"
         â”‚
         â–¼
LLM: "What metrics should the dashboard display?"
         â”‚
         â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  UI displays question to user:  â”‚
â”‚                                 â”‚
â”‚  ðŸ¤– AI has a question:          â”‚
â”‚  "What metrics should the       â”‚
â”‚   dashboard display?"           â”‚
â”‚                                 â”‚
â”‚  Context: Need to know what     â”‚
â”‚  data to show in the dashboard  â”‚
â”‚                                 â”‚
â”‚  Suggestions:                   â”‚
â”‚  [Revenue] [Users] [Activity]   â”‚
â”‚  [Custom...]                    â”‚
â”‚                                 â”‚
â”‚  [Text input] _______________   â”‚
â”‚  [Submit]                       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚
         â–¼
User: "Monthly recurring revenue, active users, and conversion rate"
         â”‚
         â–¼
Backend sends to LLM:
{
  "toolResponse": {
    "toolCallId": "call_askUser_123",
    "result": {
      "answer": "Monthly recurring revenue, active users, and conversion rate"
    }
  }
}
         â”‚
         â–¼
LLM continues with dashboard design
```

---

## Security Constraints

**All file tools enforce:**

| Constraint | Validation | Rationale |
|------------|------------|-----------|
| **File extension** | `.tsx` only | Prevents config/system file modification |
| **Directory** | `designs/` only | LLM can't touch design system or source code |
| **Filename format** | `^[a-z0-9-]+\.tsx$` | Kebab-case, no special chars, no path traversal |
| **No absolute paths** | Relative paths only | Prevents writing outside workspace |
| **No path traversal** | Reject `..` in paths | Prevents escaping designs/ directory |

**Example blocked requests:**
```typescript
// âŒ Blocked: Wrong extension
{ filename: "config.json" }

// âŒ Blocked: Path traversal
{ filename: "../server/src/malicious.tsx" }

// âŒ Blocked: Absolute path
{ filename: "/etc/passwd.tsx" }

// âŒ Blocked: Wrong directory
{ filename: "components/Button.tsx" }

// âœ… Allowed: Valid design file
{ filename: "landing-page.tsx", location: "designs" }
```

### Code Generation System Prompt

**See `docs/TECHNICAL_DESIGN.md` section "LLM Tool Calling for Code Generation"** for the complete `CODE_GENERATION_SYSTEM_PROMPT` including:

- Tool availability and usage instructions
- **CRITICAL: submitWork requirements** (must call when done, empty arguments)
- File constraints (.tsx only, designs/ directory, kebab-case)
- Code requirements (TypeScript, no id props, complete runnable code)
- Patch-based editing guidelines
- Dependency management instructions
- askUser usage guidelines
- Good/bad filename examples

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

**Client â†’ Server:**
```typescript
// User sends generation prompt via WebSocket
ws.send(JSON.stringify({
  type: 'message',
  id: 'msg_client_1234567890',
  content: 'Create a landing page with hero and features',
  timestamp: Date.now()
}));
```

**Server â†’ Client:**
```typescript
// Immediate acknowledgment
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": Date.now()
}

// Streaming progress updates
{
  "type": "content",
  "content": "Generating landing page..."
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
3. LLM tool calling triggered (`createFile` tool)
4. Backend validates filename constraints (kebab-case, .tsx, designs/)
5. Check dependencies (call `addDependency` if needed)
6. Validate code (TypeScript, ESLint, Knip)
7. Inject IDs
8. Write to filesystem
9. Save to session messages
10. Send `done` message to client

**Frontend Usage:**
```typescript
// Use Phase 2a's useMessageListState hook
const { sendMessage } = useMessageListState(sessionId);

// Send generation prompt
sendMessage('Create a landing page with hero section and features');
```

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
- [ ] Backend can start/stop preview Vite server programmatically
- [ ] Preview server status exposed via API
- [ ] Real-time log streaming works (SSE)
- [ ] UI displays preview server controls (start/stop)
- [ ] UI displays real-time preview logs
- [ ] User can submit text prompts describing UI designs **via WebSocket**
- [ ] LLM generates valid React/TypeScript code
- [ ] Generated code passes TypeScript compilation
- [ ] Component IDs are auto-injected
- [ ] Design renders in isolated iframe preview
- [ ] Mode switching works (Select / Preview)
- [ ] Component selection highlights instances
- [ ] Error states handled gracefully with suggestions
- [ ] **Generated designs saved to session messages**
- [ ] **WebSocket integration with Phase 2a working**
- [ ] Documentation complete
- [ ] Code reviewed and merged to main

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
- âœ… Real-time generation progress streaming
- âœ… Automatic session persistence
- âœ… No duplicate API calls
- âœ… Consistent with chat messaging
- âœ… Lower latency than REST

---

## Notes for Phase 4

Phase 4 will add:
- Design System Mode (tokens, components, rules as code)
- MCP server for LLM introspection of design system
- **MCP tools for preview server control** (start/stop/status/logs)
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
          Â© 2024 SaaS Product. All rights reserved.
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
          Â© 2024 SaaS Product. All rights reserved.
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
