# Phase 3: Prompt-to-UI Rendering

## Overview

Phase 3 builds on Phase 1 (LLM Provider Integration) and Phase 2 (Session Persistence) to enable LLM-generated React/TypeScript code rendering. This phase introduces:
- LLM generates React/TypeScript code from prompts
- Code rendered in isolated iframe with **backend-managed Vite instance**
- Backend starts/stops preview Vite server on demand
- Preview Vite has its own `package.json` (LLM can add dependencies)
- Real-time log streaming from preview server to UI
- Basic validation (TypeScript compilation)
- ID injection for generated components
- No design system enforcement yet (free-form generation)

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
- Preview: `http://localhost:3001` (started/stopped by backend)

**Rationale:**
- ✅ Complete dependency isolation (LLM can add any npm package)
- ✅ CSS/JS isolation (no style leakage)
- ✅ Independent HMR (preview updates don't affect tool UI)
- ✅ Security boundary (LLM code runs in separate context)
- ✅ Different React versions possible (if needed)
- ✅ Backend controls preview lifecycle (start/stop on demand)
- ⚠️ Two dev servers to manage (minor complexity tradeoff)

---

### 2. Backend-Managed Preview Server Lifecycle

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
- ✅ MCP-ready (future: expose as MCP tools)
- ✅ Error recovery (auto-restart, status monitoring)

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
- Frontend queries `/api/preview/status` to get current preview URL
- Backend returns `{ status: 'RUNNING', port: 3002, url: 'http://localhost:3002' }`
- Frontend updates iframe src when server starts/restarts

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

### 4. Code Generation Flow

**Decision:** LLM generates complete TSX file with imports using **tool calling** for structured output

**Tool Calling Architecture:**
```typescript
// apps/server/src/llm/tools/generate-code.ts
import { tool } from 'ai';
import { z } from 'zod';

export const generateCodeTool = tool({
  description: 'Generate React/TypeScript code for a design',
  parameters: z.object({
    filename: z.string()
      .regex(/^[a-z0-9-]+\.tsx$/)
      .describe('Kebab-case filename, e.g., "landing-page.tsx"'),
    location: z.enum(['designs'])
      .describe('File location in workspace'),
    code: z.string().describe('Complete TypeScript React code'),
    description: z.string().describe('Brief description of the design'),
  }),
});
```

**LLM Instructions:**
- Export default React functional component
- Do NOT add `id` props (system will inject them)
- Use TypeScript with proper types
- May add dependencies to `apps/preview/package.json` if needed
- Use tool calling to return structured output (not markdown blocks)

**Example Tool Call:**
```typescript
// LLM response
{
  "toolCalls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "generateCode",
      "arguments": {
        "filename": "landing-page.tsx",
        "location": "designs",
        "code": "import React from 'react';\n...",
        "description": "A landing page with hero and features"
      }
    }
  }]
}
```

**Example Output (code argument):**
```tsx
import React from 'react';
import { Button, Typography, Box } from '@mui/material';

export default function LandingPage() {
  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h1">Welcome</Typography>
      <Button variant="contained" color="primary">
        Get Started
      </Button>
    </Box>
  );
}
```

**LLM Settings for Code Generation:**
```typescript
const result = await generateText({
  model: qwenModel,
  messages: [...],
  tools: { generateCode: generateCodeTool },
  toolChoice: 'required',  // Force tool use
  temperature: 0.1,         // Deterministic output
  maxTokens: 8192,          // Enough for full files
  topP: 0.95,
});
```

**Dependency Management:**
- LLM can add packages to `apps/preview/package.json`
- Backend runs `npm install` in preview directory before rendering
- Validation includes checking imports match installed packages

---

### 5. Validation Pipeline

**Decision:** Four-stage validation before rendering

**Stages:**
1. **Dependency Check** - Verify imported packages are installed
2. **TypeScript Compilation** - Verify code compiles
3. **ESLint Validation** - Check for common errors
4. **ID Injection** - Add system-managed IDs to components

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

### 7. Preview Communication Bridge

**Decision:** postMessage API for cross-origin communication (3000 ↔ 3001)

**Message Types:**
```typescript
// Parent (tool UI, port 3000) → Iframe (preview, port 3001)
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

// Iframe (preview, port 3001) → Parent (tool UI, port 3000)
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
    'http://localhost:3001'  // Preview origin
  );
}

// Iframe (preview, port 3001)
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

**Implementation:**
```typescript
// Parent (tool UI)
const iframeRef = useRef<HTMLIFrameElement>(null);

function sendMessageToIframe(message: ParentMessage) {
  iframeRef.current?.contentWindow?.postMessage(
    message,
    'http://localhost:3000'
  );
}

// Iframe (preview)
window.addEventListener('message', (event) => {
  if (event.origin !== 'http://localhost:3000') return;
  
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

---

### 9. Preview Vite Entry Point

**Decision:** Preview loads design dynamically via import alias

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

## Implementation Checklist

### Backend Setup

- [ ] **1.0** Implement LLM tool calling for code generation
  - [ ] Create `src/llm/tools/generate-code.ts` (Zod schema + tool definition)
  - [ ] Create `src/llm/tools/edit-code.ts` (for editing existing designs)
  - [ ] Create `src/llm/tools/add-dependency.ts` (for preview package.json)
  - [ ] Update LLM provider to support tool calling
  - [ ] Set temperature: 0.1, maxTokens: 8192, toolChoice: 'required'
  - [ ] **Validate:** LLM returns structured tool calls consistently

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

- [ ] **1.4** Create code generation endpoint
  - [ ] `POST /api/generate` - Generate code from prompt
  - [ ] Accept text prompt and optional image URL
  - [ ] Return generated code with metadata
  - [ ] Stream response with SSE for long generations
  - [ ] **Validate:** Use Chrome DevTools MCP to test endpoint

- [ ] **1.5** Implement validation pipeline
  - [ ] Create `src/validation/typescript.ts` (tsc runner)
  - [ ] Create `src/validation/eslint.ts` (eslint runner)
  - [ ] Create `src/validation/knip.ts` (knip runner)
  - [ ] Run validations in sequence
  - [ ] Return detailed error messages
  - [ ] **Validate:** Test with valid and invalid code samples

- [ ] **1.6** Implement dependency management
  - [ ] Create `src/preview/dependency-manager.ts`
  - [ ] Parse imports from generated code
  - [ ] Check against installed packages
  - [ ] Add missing packages to `apps/preview/package.json`
  - [ ] Run `npm install` in preview directory
  - [ ] Return install progress and errors
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
  - [ ] Create `vite.config.ts` with dynamic port and @design alias
  - [ ] Create `index.html` entry point
  - [ ] Create `src/main.tsx` with dynamic design loader
  - [ ] **Validate:** Backend can start preview server

- [ ] **2.2** Configure dynamic port assignment
  - [ ] Allow Vite to find available port (strictPort: false)
  - [ ] Backend detects actual port from Vite output
  - [ ] Report port to frontend via status endpoint
  - [ ] **Validate:** Port changes when 3002 is occupied

### Frontend Setup

- [ ] **2.3** Create preview server control UI
  - [ ] `PreviewServerStatus` component (start/stop buttons)
  - [ ] Display current server state (STOPPED/STARTING/RUNNING/ERROR)
  - [ ] Show current preview port
  - [ ] Auto-start on first design generation
  - [ ] Confirm before stopping active preview
  - [ ] **Validate:** Control preview server from UI

- [ ] **2.4** Create log viewer component
  - [ ] `PreviewLogViewer` component with scrollable log display
  - [ ] Color-code log levels (info, warn, error)
  - [ ] Auto-scroll to latest log
  - [ ] Pause/resume auto-scroll
  - [ ] Clear logs button
  - [ ] Filter by log type
  - [ ] **Validate:** Logs stream in real-time from backend

- [ ] **2.5** Create preview iframe component
  - [ ] `PreviewFrame` component pointing to dynamic preview URL
  - [ ] Handle iframe load events
  - [ ] Error boundary for iframe crashes
  - [ ] Loading state during server start
  - [ ] Update src on server restart
  - [ ] **Validate:** Use Chrome DevTools MCP to verify iframe renders

- [ ] **2.6** Implement communication bridge
  - [ ] `useIframeBridge` custom hook
  - [ ] Send commands to iframe (SET_MODE, HIGHLIGHT)
  - [ ] Receive events from iframe (COMPONENT_SELECTED)
  - [ ] Origin validation (dynamic preview origin)
  - [ ] Message queue for pre-ready messages
  - [ ] **Validate:** Test bidirectional communication

- [ ] **2.7** Build prompt input UI
  - [ ] `PromptInput` component with text field
  - [ ] Image upload support (drag & drop)
  - [ ] Character count and limits
  - [ ] Submit button with loading state
  - [ ] **Validate:** Test prompt submission flow

- [ ] **2.8** Create design generation UI
  - [ ] `DesignGenerator` component
  - [ ] Display generation progress
  - [ ] Show validation errors with suggestions
  - [ ] Retry button for failed generations
  - [ ] View raw code option (for debugging)
  - [ ] **Validate:** Test full generation flow

- [ ] **2.9** Implement mode switching
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
  - [ ] `AuditWrapper` - Handles audit mode highlighting
  - [ ] `SelectionBox` - Shows selection bounding box
  - [ ] `MetadataProvider` - Attaches instance metadata
  - [ ] Style wrappers with MUI `sx` prop
  - [ ] **Validate:** Verify wrappers render correctly in preview

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

- [ ] **4.3** Test performance
  - [ ] Measure generation time
  - [ ] Measure validation time
  - [ ] Measure iframe load time
  - [ ] Test with large designs (100+ components)
  - [ ] **Validate:** Performance metrics acceptable

---

## Dependencies

### Backend Additions (`apps/server/package.json`)
```json
{
  "dependencies": {
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

# Phase 3 additions
WORKSPACE_DIR=./workspace
PREVIEW_PORT=3001
```

### Tool UI (`apps/web/.env`)
```bash
# Existing Phase 1 vars
VITE_API_URL=http://localhost:3001

# Phase 3 additions
VITE_PREVIEW_URL=http://localhost:3001
```

### Preview (`apps/preview/.env`)
```bash
# Preview has minimal config - runs independently
VITE_TOOL_URL=http://localhost:3000
```

---

---

## LLM Tool Definitions

### createFile Tool

**Purpose:** Create new design file from a text prompt

**Parameters:**
```typescript
{
  filename: z.string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Must be kebab-case with .tsx extension'),
  location: z.enum(['designs']),
  code: z.string(),
  description: z.string(),
}
```

**Example Call:**
```typescript
{
  "name": "createFile",
  "arguments": {
    "filename": "landing-page.tsx",
    "location": "designs",
    "code": "import React from 'react';...",
    "description": "SaaS landing page with hero and features"
  }
}
```

---

### editFile Tool

**Purpose:** Modify existing design using patch-based editing

**Parameters:**
```typescript
{
  filename: z.string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Must be kebab-case with .tsx extension'),
  location: z.enum(['designs']),
  patch: z.string().describe('Unified diff patch to apply'),
  description: z.string().describe('Summary of changes'),
}
```

**Usage:**
```typescript
// User: "Make the button blue"
// LLM returns unified diff patch (not full file rewrite)
{
  "name": "editFile",
  "arguments": {
    "filename": "landing-page.tsx",
    "location": "designs",
    "patch": "--- a/designs/landing-page.tsx\n+++ b/designs/landing-page.tsx\n@@ -5,7 +5,7 @@\n-      <Button variant=\"contained\" color=\"primary\">\n+      <Button variant=\"contained\" sx={{ bgcolor: 'blue' }}>",
    "description": "Changed button color to blue"
  }
}
```

**Benefits of patch-based editing:**
- Smaller token usage (only changed lines)
- Faster execution
- Preserves user edits outside changed areas
- Git-diff friendly

---

### renameFile Tool

**Purpose:** Rename or move design file

**Parameters:**
```typescript
{
  oldPath: z.string()
    .regex(/^designs\/[a-z0-9-]+\.tsx$/, 'Must be in designs/ directory'),
  newPath: z.string()
    .regex(/^designs\/[a-z0-9-]+\.tsx$/, 'Must be in designs/ directory'),
}
```

**Usage:**
```typescript
{
  "name": "renameFile",
  "arguments": {
    "oldPath": "designs/landing-page.tsx",
    "newPath": "designs/homepage.tsx"
  }
}
```

---

### deleteFile Tool

**Purpose:** Delete design file

**Parameters:**
```typescript
{
  filename: z.string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Must be kebab-case with .tsx extension'),
  location: z.enum(['designs']),
  confirm: z.boolean().describe('Must be true to confirm deletion'),
}
```

**Usage:**
```typescript
{
  "name": "deleteFile",
  "arguments": {
    "filename": "landing-page.tsx",
    "location": "designs",
    "confirm": true
  }
}
```

---

### addDependency Tool

**Purpose:** Add npm package to preview environment

**Parameters:**
```typescript
{
  packageName: z.string(),
  version: z.string().optional().default('latest'),
  reason: z.string().describe('Why this package is needed'),
}
```

**Usage:**
```typescript
// LLM generates code importing 'framer-motion'
// LLM calls addDependency tool before or after createFile
// Backend runs npm install in apps/preview/
{
  "name": "addDependency",
  "arguments": {
    "packageName": "framer-motion",
    "version": "^11.0.0",
    "reason": "Needed for animations in the design"
  }
}
```

---

### submitWork Tool

**Purpose:** Signal completion of work and trigger validation pipeline

**Parameters:**
```typescript
{
  summary: z.string().describe('Summary of all changes made'),
  filesCreated: z.array(z.string()).describe('List of files created'),
  filesModified: z.array(z.string()).describe('List of files modified'),
  dependenciesAdded: z.array(z.string()).optional().describe('Packages added'),
}
```

**Usage:**
```typescript
// LLM makes multiple tool calls, then signals completion:
{
  "name": "submitWork",
  "arguments": {
    "summary": "Created landing page with hero and features section",
    "filesCreated": ["landing-page.tsx"],
    "filesModified": [],
    "dependenciesAdded": ["framer-motion"]
  }
}
```

**Workflow:**
1. LLM makes multiple tool calls (createFile, addDependency, etc.)
2. LLM calls `submitWork` to signal completion
3. **Only then** does backend run validation pipeline
4. If validation passes → success response
5. If validation fails → error returned to LLM for fixes
6. LLM fixes issues and calls `submitWork` again

---

### askUser Tool

**Purpose:** Request clarification or input from user when LLM is stuck

**Parameters:**
```typescript
{
  question: z.string().describe('Question to ask the user'),
  context: z.string().describe('Why this information is needed'),
  suggestions: z.array(z.string()).optional().describe('Suggested answers'),
}
```

**Usage:**
```typescript
// LLM needs clarification
{
  "name": "askUser",
  "arguments": {
    "question": "What color scheme should I use?",
    "context": "The design requires a primary color but none was specified",
    "suggestions": ["Blue (default)", "Green", "Purple", "Orange"]
  }
}
```

**Flow:**
1. LLM calls `askUser` tool
2. Backend displays question in UI
3. User provides answer
4. Backend sends answer back to LLM
5. LLM continues with user's input

---

## Multi-Turn Tool Calling Workflow

**Phase 1: LLM Staging Changes**
```
User: "Create a landing page with animations"
         │
         ▼
┌─────────────────────────┐
│  LLM Tool Calls         │
│  (multiple, staged)     │
│                         │
│  1. addDependency       │
│     {packageName:       │
│      "framer-motion"}   │
│                         │
│  2. createFile          │
│     {filename:          │
│      "landing-page.tsx",│
│      code: "..."}       │
│                         │
│  3. submitWork          │
│     {summary: "..."}    │
└─────────────────────────┘
         │
         │ Triggers validation
         ▼
```

**Phase 2: Validation Pipeline**
```
┌─────────────────────────┐
│  Validation Pipeline    │
│                         │
│  1. Check dependencies  │
│     ✅ framer-motion    │
│        installed        │
│                         │
│  2. TypeScript compile  │
│     ❌ Error: Line 42   │
│        "Property 'x'    │
│        does not exist"  │
│                         │
│  3. ESLint              │
│     (skipped - TS fail) │
│                         │
│  4. ID Injection        │
│     (skipped - TS fail) │
└─────────────────────────┘
         │
         │ Validation failed
         ▼
```

**Phase 3: Error Feedback to LLM**
```
Backend → LLM:
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
         │
         ▼
┌─────────────────────────┐
│  LLM Fixes Errors       │
│                         │
│  1. editFile            │
│     {filename:          │
│      "landing-page.tsx",│
│      patch: "@@ -42..."}│
│                         │
│  2. submitWork          │
│     {summary: "Fixed    │
│      TypeScript error"} │
└─────────────────────────┘
         │
         │ Triggers validation again
         ▼
```

**Phase 4: Success**
```
┌─────────────────────────┐
│  Validation Pipeline    │
│                         │
│  1. Check dependencies  │
│     ✅                  │
│  2. TypeScript compile  │
│     ✅                  │
│  3. ESLint              │
│     ✅                  │
│  4. ID Injection        │
│     ✅ (15 IDs added)   │
└─────────────────────────┘
         │
         ✅ Success!
         │
         ▼
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
         │
         ▼
LLM: "What metrics should the dashboard display?"
         │
         ▼
┌─────────────────────────────────┐
│  UI displays question to user:  │
│                                 │
│  🤖 AI has a question:          │
│  "What metrics should the       │
│   dashboard display?"           │
│                                 │
│  Context: Need to know what     │
│  data to show in the dashboard  │
│                                 │
│  Suggestions:                   │
│  [Revenue] [Users] [Activity]   │
│  [Custom...]                    │
│                                 │
│  [Text input] _______________   │
│  [Submit]                       │
└─────────────────────────────────┘
         │
         ▼
User: "Monthly recurring revenue, active users, and conversion rate"
         │
         ▼
Backend sends to LLM:
{
  "toolResponse": {
    "toolCallId": "call_askUser_123",
    "result": {
      "answer": "Monthly recurring revenue, active users, and conversion rate"
    }
  }
}
         │
         ▼
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
// ❌ Blocked: Wrong extension
{ filename: "config.json" }

// ❌ Blocked: Path traversal
{ filename: "../server/src/malicious.tsx" }

// ❌ Blocked: Absolute path
{ filename: "/etc/passwd.tsx" }

// ❌ Blocked: Wrong directory
{ filename: "components/Button.tsx" }

// ✅ Allowed: Valid design file
{ filename: "landing-page.tsx", location: "designs" }
```

### Code Generation System Prompt

```typescript
export const CODE_GENERATION_SYSTEM_PROMPT = `
You are a code generation assistant for CycleDesign.

**Your Task:**
Generate React/TypeScript code for UI designs based on user prompts.

**Available Tools:**
- createFile: Create new design files
- editFile: Modify existing designs (patch-based)
- renameFile: Rename design files
- deleteFile: Delete design files
- addDependency: Add npm packages to preview environment
- submitWork: Signal completion and trigger validation (REQUIRED after making changes)
- askUser: Request clarification from user when stuck or need input

**Workflow:**
1. You can make MULTIPLE tool calls in any order
2. When you're DONE making changes, you MUST call submitWork
3. Validation only runs AFTER you call submitWork
4. If validation fails, fix errors and call submitWork again
5. If you need user input, call askUser and wait for response

**File Constraints:**
- All files must be in the "designs" directory
- All files must have .tsx extension
- Filenames must be kebab-case (e.g., "landing-page.tsx")
- You cannot modify files outside designs/ directory
- You cannot modify config files, source code, or system files

**Output Format:**
Use the createFile tool to return structured output with:
- filename: Kebab-case name ending in .tsx (e.g., "landing-page.tsx")
- location: Always "designs"
- code: Complete, runnable TypeScript React code
- description: One-line description of the design

**Code Requirements:**
1. Export a default React functional component
2. Use TypeScript with proper types (no 'any')
3. DO NOT add 'id' props to components (system will inject them)
4. Use only these packages by default: react, @mui/material, @mui/icons-material
5. Code must be complete and runnable (no placeholders, no comments like "...")
6. Use proper indentation (2 spaces)
7. Import components from '@mui/material' not '@mui/material/Button'

**For Edits:**
Use the editFile tool with a unified diff patch when:
- User requests a small change to existing design
- You want to preserve user modifications outside changed areas
- The change is localized to specific lines

**If you need additional packages:**
Call the addDependency tool BEFORE calling submitWork

**If you need user input:**
Call the askUser tool with:
- question: Clear question to user
- context: Why you need this information
- suggestions: Optional suggested answers

**IMPORTANT:**
- NEVER call submitWork until you're completely done
- You can make multiple tool calls before submitWork
- If validation fails, fix errors and call submitWork again
- Don't keep trying the same fix - if stuck, call askUser

**Examples:**
- Good filename: "user-dashboard.tsx", "login-form.tsx"
- Bad filename: "UserDashboard.tsx", "my design.tsx", "test.txt"
`;
```

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

### Design Generation

**POST /api/generate**

Uses tool calling for structured output.

```typescript
// Request
{
  prompt: string;
  designName?: string;  // Optional suggestion (LLM can override)
  imageUrl?: string;    // Optional image prompt
}

// Response
{
  success: boolean;
  filename: string;
  location: string;
  code: string;
  codeWithIds: string;      // After ID injection
  validationErrors?: Array<{
    type: 'typescript' | 'eslint' | 'knip';
    message: string;
    line?: number;
    column?: number;
  }>;
  idInjection?: {
    added: number;
    duplicates: number;
  };
  dependenciesInstalled?: Array<{
    name: string;
    version: string;
  }>;
}
```

**LLM Tool Call (internal):**
```typescript
{
  "name": "createFile",
  "arguments": {
    "filename": "landing-page.tsx",
    "location": "designs",
    "code": "import React from 'react';...",
    "description": "SaaS landing page"
  }
}
```

**Process:**
1. LLM receives prompt and calls `createFile` tool
2. Backend validates filename constraints (kebab-case, .tsx, designs/)
3. Check dependencies (call `addDependency` if needed)
4. Validate code (TypeScript, ESLint, Knip)
5. Inject IDs
6. Write to filesystem
7. Return structured response

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
- [ ] User can submit text prompts describing UI designs
- [ ] LLM generates valid React/TypeScript code
- [ ] Generated code passes TypeScript compilation
- [ ] Component IDs are auto-injected
- [ ] Design renders in isolated iframe preview
- [ ] Mode switching works (Select / Preview)
- [ ] Component selection highlights instances
- [ ] Error states handled gracefully with suggestions
- [ ] Documentation complete
- [ ] Code reviewed and merged to main

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
