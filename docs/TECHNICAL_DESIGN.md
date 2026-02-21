# CycleDesign Technical Design

**Related Documents:**
- `docs/PRD.md` - Product requirements and user flows
- `docs/Phase3.md` - Phase 3 implementation details, timelines, checklists
  - Implementation checklist (40+ tasks)
  - Timeline estimates (10-12.5 days)
  - Exit criteria (17 items)
  - API endpoint specifications
  - Environment variable configurations

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Design Sys  │  │   Design    │  │   Component Preview     │ │
│  │    Mode     │  │    Mode     │  │      & Audit Mode       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                              │                                  │
│                    ┌─────────▼─────────┐                        │
│                    │   Property Editor │                        │
│                    └─────────┬─────────┘                        │
│                              │                                  │
│  ┌───────────────────────────▼─────────────────────────────┐   │
│  │              useMessageListState Hook                   │   │
│  │  - WebSocket connection management                      │   │
│  │  - Optimistic updates + server reconciliation           │   │
│  │  - Message queueing + reconnection                      │   │
│  └───────────────────────────┬─────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    WebSocket (port 3001)
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                         Backend Services                        │
│  ┌─────────────┐  ┌─────────▼─────────┐  ┌─────────────────┐   │
│  │   MCP       │◄─┤  Validation       │  │  Code Parser    │   │
│  │   Server    │  │  Engine           │  │  & Transformer  │   │
│  └─────────────┘  └───────────────────┘  └─────────────────┘   │
│         │                    │                      │           │
│         │              ┌─────▼─────┐          ┌────▼────┐       │
│         │              │ TypeScript│          │  Build  │       │
│         │              │  ESLint   │          │ Folder  │       │
│         │              │   Knip    │          │  (.tsx) │       │
│         │              └───────────┘          └─────────┘       │
│         │                                                    │
│  ┌──────▼────────────────────────────────────────────────┐   │
│  │         WebSocket Server (Phase 2a)                   │   │
│  │  - Persistent connections per session                 │   │
│  │  - Immediate message acknowledgment                   │   │
│  │  - History sync on connect                            │   │
│  │  - Streaming responses                                │   │
│  └───────────────────────────────────────────────────────┘   │
│         │                                                    │
│  ┌──────▼────────────────────────────────────────────────┐   │
│  │           Preview Server Manager                      │   │
│  │  - Spawn Vite child process                           │   │
│  │  - Log streaming (SSE)                                │   │
│  │  - Start/Stop/Restart control                         │   │
│  │  - Port management                                    │   │
│  └───────────────────────────────────────────────────────┘   │
│         │                                                    │
│  ┌──────▼────────────────────────────────────────────────┐   │
│  │              SQLite Database                          │   │
│  │  - Component usage index                              │   │
│  │  - Audit data                                         │   │
│  │  - (Regenerated from source on startup)               │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                      Filesystem (Git-tracked)                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ design-system/  │  │ designs/        │  │ rules/          │ │
│  │ *.ts, *.tsx     │  │ *.tsx           │  │ *.md            │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  .cycledesign/sessions/ (Phase 2a)                      │   │
│  │  - session-*/meta.json                                  │   │
│  │  - session-*/messages.jsonl                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Layer | Technology | Rationale |
|-------|------------|-----------|
| UI Library | React 18+ | Component model aligns with design system concept |
| UI Components | MUI v7+ (latest stable) | Comprehensive component library, no CSS styling needed |
| Styling | MUI `sx` prop + Theme | Programmatic theming, aligns with no-CSS philosophy |
| State | Native React (`useState`, `useReducer`, Context) | Avoid external dependencies until proven necessary |
| **WebSocket Client** | **Native WebSocket API** | **Phase 2a real-time messaging** |
| **State Abstraction** | **useMessageListState hook** | **Phase 2a messaging logic encapsulation** |
| Routing | React Router | Simple, well-understood |
| Prompt Input | MUI TextField + file upload | Text prompts and image upload for design generation |
| Property Editor | MUI components (dynamic forms) | Edit component instance data props |
| Design Rendering | Isolated iframe | Complete CSS/JS isolation from tool UI |

### Backend
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Node.js 20+ | JavaScript/TypeScript ecosystem |
| Framework | Express or Fastify | Minimal, flexible (prod only, dev uses Vite) |
| **WebSocket Server** | **ws + @types/ws** | **Phase 2a real-time messaging** |
| MCP Server | @modelcontextprotocol/sdk | Official MCP implementation |
| TypeScript | tsc + ts-node | Type checking and runtime compilation |
| ESLint | eslint | Linting with custom design system rules |
| Knip | knip | Detect unused exports/imports |
| AST Parsing | @typescript-eslint/parser | Parse TSX for ID injection |
| Code Transformation | Babel or TS Compiler | Wrap components with helpers |

### Database
| Purpose | Technology | Rationale |
|---------|------------|-----------|
| Component Index | SQLite (better-sqlite3) | Fast reads, file-based, no server |
| ORM | None (raw SQL) | Simple schema, no overhead |

### Version Control
| Purpose | Technology | Rationale |
|---------|------------|-----------|
| Git Operations | isomorphic-git | Pure JS git, works in browser or Node |
| Diff Viewing | diff or similar | Display changes between commits |

---

## Project Structure

```
cycledesign/
├── apps/
│   ├── web/                    # React frontend (tool UI, Vite on 3000)
│   │   ├── src/
│   │   │   ├── components/     # UI components for the tool
│   │   │   ├── modes/          # Design System Mode, Design Mode
│   │   │   ├── editors/        # Property editor, prompt input
│   │   │   ├── preview/        # iframe component, log viewer, server controls
│   │   │   ├── hooks/          # React hooks for state/data
│   │   │   │   └── useMessageListState.ts  # WebSocket messaging (Phase 2a)
│   │   │   └── api/
│   │   │       └── websocket.ts            # WebSocket client (Phase 2a)
│   │   ├── index.html          # Main app entry point
│   │   ├── vite.config.ts      # Vite config
│   │   └── package.json
│   │
│   ├── preview/                # Preview Vite instance (backend-managed, port 3002)
│   │   ├── src/
│   │   │   └── main.tsx        # Dynamic design loader
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json        # LLM-managed dependencies
│   │
│   └── server/                 # Node.js backend
│       ├── src/
│       │   ├── mcp/            # MCP server implementation
│       │   ├── validation/     # TypeScript, ESLint, Knip runners
│       │   ├── parser/         # AST parsing, ID injection
│       │   ├── transformer/    # Component wrapping (writes to /build)
│       │   ├── database/       # SQLite schema and queries
│       │   ├── ws/             # WebSocket server (Phase 2a)
│       │   │   ├── index.ts            # WebSocket server setup
│       │   │   └── SessionManager.ts   # Connection tracking
│       │   ├── preview/        # Preview server lifecycle management
│       │   │   ├── preview-manager.ts    # Start/stop/restart Vite
│       │   │   └── log-streamer.ts       # SSE log streaming
│       │   └── git/            # Git operations (Phase 3)
│       └── package.json
│
├── packages/
│   ├── design-system-runtime/  # Runtime helpers for wrapped components
│   │   ├── src/
│   │   │   ├── wrappers/       # AuditHighlight, SelectionBox, etc.
│   │   │   └── context/        # Design system context provider
│   │   └── package.json
│   │
│   └── shared-types/           # Shared TypeScript types
│       ├── src/
│       │   ├── component.ts    # Component schema types
│       │   ├── design.ts       # Design document types
│       │   └── audit.ts        # Audit index types
│       └── package.json
│
├── workspace/                  # User's design system and designs (git-tracked)
│   ├── design-system/
│   │   ├── tokens/
│   │   │   ├── colors.ts
│   │   │   ├── spacing.ts
│   │   │   └── typography.ts
│   │   ├── components/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   └── ...
│   │   └── index.ts
│   │
│   ├── designs/
│   │   ├── landing-page.tsx
│   │   ├── dashboard.tsx
│   │   └── current.tsx         # Currently loaded design (symlink/copy)
│   │
│   └── rules/
│       ├── composition.md
│       └── accessibility.md
│
├── build/                      # Generated output (gitignored)
│   └── designs/                # Transformed .tsx files with wrappers
│
├── .cycledesign/
│   ├── index.db                # SQLite database (gitignored)
│   └── sessions/               # LLM conversation logs (JSONL)
│       ├── design-system-session.jsonl
│       └── *.jsonl
│
├── package.json                # Root workspace config
└── turbo.json                  # Turborepo config (if using monorepo)
```

---

### LLM Tool Calling for Code Generation (Phase 3)

**Location:** `apps/server/src/llm/tools/`

**Decision:** Use Vercel AI SDK tool calling with Zod validation for structured code output, triggered via WebSocket messages (Phase 2a)

**WebSocket Integration:**
- User sends code generation prompt via WebSocket `message` type
- Server acknowledges immediately with `ack` message
- LLM tool calling triggered server-side
- Generated design saved to session messages automatically
- Progress streamed via `content` messages
- Completion signaled via `done` message

**Why Tool Calling:**
- ✅ Guaranteed structured output (no parsing markdown blocks)
- ✅ Zod schema validation before code reaches pipeline
- ✅ Type-safe in TypeScript
- ✅ LLM can't forget required fields (filename, code, etc.)
- ✅ Error handling when LLM returns invalid structure
- ✅ **WebSocket integration** enables real-time progress streaming

**Tool Definitions:**

```typescript
// apps/server/src/llm/tools/create-file.ts
import { tool } from 'ai';
import { z } from 'zod';

// File validation schema (reused across all file tools)
const fileSchema = z.object({
  filename: z.string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Must be kebab-case with .tsx extension'),
  location: z.enum(['designs']),
});

export const createFileTool = tool({
  description: 'Create a new React/TypeScript design file',
  parameters: z.object({
    ...fileSchema.shape,
    code: z.string().describe('Complete TypeScript React code'),
    description: z.string().describe('Brief description of the design'),
  }),
});

// apps/server/src/llm/tools/edit-file.ts
export const editFileTool = tool({
  description: 'Modify existing design using patch-based editing',
  parameters: z.object({
    ...fileSchema.shape,
    patch: z.string().describe('Unified diff patch to apply'),
    description: z.string().describe('Summary of changes'),
  }),
});

// apps/server/src/llm/tools/rename-file.ts
export const renameFileTool = tool({
  description: 'Rename or move a design file',
  parameters: z.object({
    oldPath: z.string()
      .regex(/^designs\/[a-z0-9-]+\.tsx$/, 'Must be in designs/ directory'),
    newPath: z.string()
      .regex(/^designs\/[a-z0-9-]+\.tsx$/, 'Must be in designs/ directory'),
  }),
});

// apps/server/src/llm/tools/delete-file.ts
export const deleteFileTool = tool({
  description: 'Delete a design file',
  parameters: z.object({
    ...fileSchema.shape,
    confirm: z.boolean().describe('Must be true to confirm deletion'),
  }),
});

// apps/server/src/llm/tools/add-dependency.ts
export const addDependencyTool = tool({
  description: 'Add npm package to preview environment',
  parameters: z.object({
    packageName: z.string(),
    version: z.string().optional().default('latest'),
    reason: z.string().describe('Why this package is needed'),
  }),
});

// apps/server/src/llm/tools/submit-work.ts
export const submitWorkTool = tool({
  description: 'Signal completion of work and trigger validation pipeline. MUST be called when LLM is done making changes. Arguments are empty - system automatically tracks files created/modified and dependencies added.',
  parameters: z.object({
    // Empty - system tracks changes automatically during tool execution
  }),
});

// apps/server/src/llm/tools/ask-user.ts
export const askUserTool = tool({
  description: 'Request clarification or input from user when stuck',
  parameters: z.object({
    question: z.string().describe('Question to ask the user'),
    context: z.string().describe('Why this information is needed'),
    suggestions: z.array(z.string()).optional().describe('Suggested answers'),
  }),
});
```

**LLM Configuration for Code Generation:**

```typescript
// apps/server/src/llm/code-generator.ts
export async function generateCodeFromPrompt(
  prompt: string,
  options?: { imageUrl?: string }
) {
  const result = await generateText({
    model: qwenModel,
    messages: [
      { role: 'system', content: CODE_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    tools: {
      createFile: createFileTool,
      editFile: editFileTool,
      renameFile: renameFileTool,
      deleteFile: deleteFileTool,
      addDependency: addDependencyTool,
      submitWork: submitWorkTool,  // MUST be called when done
      askUser: askUserTool,
    },
    toolChoice: 'auto',  // Let LLM choose which tool to call
    temperature: 0.1,     // Deterministic output
    maxTokens: 8192,      // Enough for full files
    topP: 0.95,
  });
  
  // Process tool calls in a loop until submitWork or askUser
  // System automatically tracks: filesCreated, filesModified, dependenciesAdded
  return result;
}
```

**WebSocket Message Flow:**
```typescript
// Client → Server (via WebSocket)
ws.send(JSON.stringify({
  type: 'message',
  id: 'msg_client_1234567890',
  content: 'Create a landing page with animations',
  timestamp: Date.now()
}));

// Server → Client (immediate acknowledgment)
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": Date.now()
}

// Server processes generation (tool calling happens server-side)
// ... LLM generates code ...
// ... Validation pipeline runs ...
// ... Design saved to session ...

// Server → Client (streaming response)
{
  "type": "content",
  "content": "Creating landing page with animations..."
}

// Server → Client (done)
{
  "type": "done",
  "messageId": "msg_003",
  "timestamp": Date.now()
}
```

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

**System Prompt:**

```typescript
// apps/server/src/llm/prompts/code-generation.ts
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
- submitWork: Signal completion and trigger validation (REQUIRED when done)
- askUser: Request clarification from user when stuck or need input

**CRITICAL: submitWork Tool**

You MUST call the submitWork tool when you are COMPLETELY DONE making changes.
This is REQUIRED - validation will NOT run until you call submitWork.

- Call submitWork AFTER all createFile, editFile, addDependency calls
- Call submitWork with EMPTY arguments {} - the system automatically tracks:
  - Which files you created
  - Which files you modified  
  - Which dependencies you added
- After submitWork, the system will:
  1. Run validation pipeline (TypeScript, ESLint, Knip)
  2. If validation passes: start/restart preview server automatically
  3. If validation fails: return errors for you to fix
- If validation fails, fix the errors and call submitWork again

NEVER forget to call submitWork - your changes will not be validated or rendered without it!

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

**Benefits:**
- Structured output guaranteed by tool schema
- Validation happens at LLM boundary (before file I/O)
- Easy to extend with new tools (editFile, renameFile, deleteFile, submitWork, askUser)
- Tool calls logged for debugging/auditing
- **Security:** All file tools enforce same constraints (.tsx only, designs/ directory, kebab-case)
- **Patch-based editing:** editFile uses unified diff for efficient small changes
- **Multi-turn workflow:** LLM can stage multiple changes before validation
- **User in the loop:** askUser tool lets LLM request clarification when stuck
- **Clear completion signal:** submitWork triggers validation only when LLM is done

---

### WebSocket Server (Phase 2a)

**Location:** `apps/server/src/ws/`

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                  WebSocket Server (port 3001)               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Connection Manager                                   │  │
│  │  - Map: sessionId → SessionConnection                 │  │
│  │  - Track streaming state per connection               │  │
│  │  - Handle connection/close events                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Message Handlers                                     │  │
│  │  - message: Process user message, call LLM            │  │
│  │  - ping: Keep-alive response                          │  │
│  │  - Error handling + rate limiting                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Response Types                                       │  │
│  │  - connected: Initial connection acknowledgment       │  │
│  │  - history: Send conversation history on connect      │  │
│  │  - ack: Immediate message acknowledgment              │  │
│  │  - content: Streaming LLM response chunks             │  │
│  │  - done: Stream complete                              │  │
│  │  - error: Error messages                              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Message Protocol:**

**Client → Server:**
```typescript
// Send user message (client generates ID)
{
  "type": "message",
  "id": "msg_client_1234567890",
  "content": "Create a landing page",
  "timestamp": 1705312210000
}

// Ping (keep-alive)
{
  "type": "ping"
}
```

**Server → Client:**
```typescript
// Connection acknowledgment
{
  "type": "connected",
  "sessionId": "session-abc123"
}

// History (sent after connected)
{
  "type": "history",
  "messages": [
    { "id": "msg_001", "role": "user", "content": "...", "timestamp": 1705312210000 },
    { "id": "msg_002", "role": "assistant", "content": "...", "timestamp": 1705312215000 }
  ],
  "timestamp": 1705312210000
}

// Immediate acknowledgment (sent right after receiving message)
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": 1705312211000
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
  "timestamp": 1705312220000
}

// Error
{
  "type": "error",
  "error": "Rate limit exceeded"
}

// Status update (Phase 3: Tool calling progress)
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_start" | "tool_call_complete" | "tool_call_error" |
           "validation_start" | "validation_complete" | "validation_error" |
           "preview_start" | "preview_ready" | "preview_error",
  "tool"?: string,  // Tool name (for tool_call_* statuses)
  "details": string,  // User-friendly description
  "timestamp": number
}
```

**Status Message Types (Phase 3):**

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

**Connection Lifecycle:**
```
1. User creates/loads session
2. Client creates WebSocket: ws://localhost:3001/ws?sessionId=abc123
3. Server sends: { type: "connected", sessionId: "abc123" }
4. Server sends: { type: "history", messages: [...] }
5. Client displays messages
6. User sends message → WebSocket → Server
7. Server immediately sends: { type: "ack", messageId: "client_id", serverId: "server_id" }
8. Client converts optimistic → confirmed
9. Server saves message, calls LLM, streams response
10. Connection persists for session lifetime
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
sendMessage(content) {
  const clientMsgId = `msg_${Date.now()}`;
  
  // Add optimistic message
  addMessage({
    id: clientMsgId,
    role: 'user',
    content,
    status: 'pending'
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
```

**Integration with Code Generation (Phase 3):**
- Code generation prompts sent via WebSocket `message` type
- LLM tool calling triggered server-side after message received
- Generated designs automatically saved to session messages
- Progress streamed via `content` messages
- Completion signaled via `done` message

---

### Preview Server Management

**Location:** `apps/server/src/preview/`

**Requirements:**

- Spawn Vite preview server as child process
- Capture stdout/stderr for log streaming
- Graceful shutdown (SIGTERM → SIGKILL timeout)
- Dynamic port assignment (handle conflicts)
- Process state tracking (STOPPED, STARTING, RUNNING, ERROR)
- Auto-restart on crash (configurable)

**Preview Manager API:**

```typescript
// apps/server/src/preview/preview-manager.ts
interface PreviewServerState {
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';
  port?: number;
  pid?: number;
  uptime?: number;
  error?: string;
}

export class PreviewManager {
  private process: ChildProcess | null = null;
  private state: PreviewServerState = { status: 'STOPPED' };
  private logBuffer: LogEntry[] = [];

  async start(options?: { designName?: string }): Promise<PreviewServerState>;
  async stop(): Promise<void>;
  async restart(options?: { installDependencies?: boolean }): Promise<PreviewServerState>;
  getStatus(): PreviewServerState;
  getLogs(): LogEntry[];
  onLog(callback: (log: LogEntry) => void): () => void;
}
```

**Log Streaming:**

```typescript
// apps/server/src/preview/log-streamer.ts
interface LogEntry {
  type: 'stdout' | 'stderr' | 'ready' | 'exit' | 'error';
  message: string;
  timestamp: number;
  port?: number;  // For 'ready' events
  code?: number;  // For 'exit' events
}

export class LogStreamer extends EventEmitter {
  private buffer: LogEntry[] = [];
  private readonly MAX_BUFFER_SIZE = 1000;

  // Add log entry and emit to subscribers
  emitLog(entry: LogEntry): void;

  // Get recent logs for new connections
  getRecentLogs(count?: number): LogEntry[];
}
```

**API Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/preview/start` | Start preview server |
| `POST` | `/api/preview/stop` | Stop preview server |
| `GET` | `/api/preview/status` | Get server state |
| `POST` | `/api/preview/restart` | Restart with options |
| `GET` | `/api/preview/logs/stream` | Stream logs (SSE) |

**SSE Log Stream Format:**

```
GET /api/preview/logs/stream

HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"stdout","message":"VITE v5.0.0 ready in 500ms","timestamp":1234567890}

data: {"type":"ready","port":3002,"timestamp":1234567891}

data: {"type":"stderr","message":"Failed to resolve import...","timestamp":1234567892}
```

**Process Lifecycle:**

```
1. User clicks "Start Preview" in UI
         │
2. Frontend calls POST /api/preview/start
         │
3. Backend spawns Vite child process
   - cwd: apps/preview/
   - stdio: ['pipe', 'pipe', 'pipe']
   - env: { PORT: 3002, ... }
         │
4. Capture stdout/stderr → LogStreamer
         │
5. Parse Vite ready message → extract port
         │
6. Update state → RUNNING
         │
7. Frontend polls status / subscribes to logs
         │
8. Frontend updates iframe src → http://localhost:3002
```

**Graceful Shutdown:**

```
1. User clicks "Stop Preview"
         │
2. Frontend calls POST /api/preview/stop
         │
3. Backend sends SIGTERM to Vite process
         │
4. Wait 5 seconds for graceful shutdown
         │
5. If still running → SIGKILL
         │
6. Update state → STOPPED
         │
7. Frontend clears iframe src
```

---

### Design Rendering Isolation

**Approach: Sandboxed iframe with backend-managed Vite server**

The LLM-generated design code renders in an isolated iframe to prevent:
- CSS style leakage between tool UI and user designs
- JavaScript errors in user code from crashing the tool
- Conflicts between design system runtime and tool runtime
- Dependency conflicts (LLM can install any npm package)

**Separate Vite Instances:**

```
┌─────────────────────────────────────────────────────────────┐
│              Vite Dev Server 1 (Tool UI)                    │
│              Port: 3000 (always running)                    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │   Tool Frontend (React + MUI)                         │  │
│  │   - Preview server controls                           │  │
│  │   - Log viewer                                        │  │
│  │   - iframe embed                                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
                    Backend manages lifecycle
                               │
┌──────────────────────────────▼───────────────────────────────┐
│              Vite Dev Server 2 (Preview)                     │
│              Port: 3002 (started/stopped on demand)          │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │   Preview (Design rendering)                          │  │
│  │   - Loads design from workspace/designs/current.tsx   │  │
│  │   - LLM-managed dependencies                          │  │
│  │   - postMessage bridge to parent                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Preview Vite Config:**

```typescript
// apps/preview/vite.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': resolve(__dirname, '../../workspace/designs'),
    },
  },
  server: {
    port: 3002,
    strictPort: false,  // Allow dynamic port assignment
    cors: true,         // Allow cross-origin from tool UI
  },
});
```

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Frontend (React + MUI)              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   iframe (sandboxed)                  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │   Preview Vite (port 3002)                      │  │  │
│  │  │   - Loads @design/current.tsx                   │  │  │
│  │  │   - Wrappers (AuditWrapper, SelectionBox)       │  │  │
│  │  │   - Design system components                    │  │  │
│  │  │   - postMessage bridge to parent                │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    postMessage API
                              │
                    ┌─────────▼─────────┐
                    │  Communication    │
                    │  Bridge Hook      │
                    └───────────────────┘
```

**iframe Attributes:**
```html
<iframe
  sandbox="allow-scripts allow-same-origin"
  src="http://localhost:3002"  // Dynamic port from backend
  title="Design Preview"
/>
```

**Server Discovery:**
- Frontend queries `GET /api/preview/status` to get current preview URL
- Backend returns `{ status: 'RUNNING', port: 3002, url: 'http://localhost:3002' }`
- Frontend updates iframe src when server starts/restarts

**Communication Bridge:**

- Parent (tool) sends commands to iframe: `SET_MODE` (select/preview/audit), `HIGHLIGHT_COMPONENT`
- Iframe sends events to parent: `COMPONENT_SELECTED`, `MODE_READY`
- Use `postMessage` API with proper origin validation
- Include instance ID for component selection events

**Hot Reload Flow:**

```
1. LLM generates design code
        │
2. Post-LLM pipeline (validate, inject IDs)
        │
3. Write to workspace/designs/*.tsx
        │
4. Backend copies to workspace/designs/current.tsx
        │
5. Preview Vite HMR detects file change
        │
6. Preview iframe auto-refreshes
        │
7. User sees updated design instantly
```

**Benefits:**
- Complete dependency isolation (LLM can add any npm package)
- Vite's fast HMR for instant preview updates
- Complete CSS/JS isolation via iframe + separate server
- Backend controls lifecycle (start/stop on demand)
- Resource efficiency (stop preview when not needed)
- Security boundary (LLM code runs in isolated process)

---

## Conversation/Session Persistence (Phase 2a)

**Location:** `workspace/.cycledesign/sessions/`

**Structure:**
```
workspace/
└── .cycledesign/
    └── sessions/
        ├── session-abc123/
        │   ├── meta.json           # Session metadata
        │   └── messages.jsonl      # One JSON message per line
        ├── session-def456/
        └── session-*
```

**Session Management Requirements:**

- Create new sessions with user-provided or auto-generated names
- Persist conversation messages (user prompts, LLM responses, system events)
- Load session messages for restoration
- List all available sessions with metadata (name, created/updated timestamps)
- Restore session context for LLM continuity (conversation history, current code, last validation state)
- Sessions must be mode-agnostic (support both Design and Design System modes)
- Sessions can span multiple design files
- Format should be human-readable and debuggable

**WebSocket Integration (Phase 2a):**
- WebSocket connection established on session load
- History sent once on connect (not per message)
- Subsequent messages only send new content
- Automatic reconnection with exponential backoff
- Message queueing during disconnection
- Connection status indicator in UI

**Benefits:**
- ✅ Standard format used by LLM tooling
- ✅ Easy to replay/debug conversations
- ✅ Session can be restored for continuity
- ✅ Sessions are mode-agnostic (work in both Design and Design System modes)
- ✅ Users can create multiple sessions for different tasks/contexts
- ✅ Git-tracked for version history (optional)
- ✅ Human-readable for debugging
- ✅ **99% reduction in data transfer** (history sent once vs per message)
- ✅ **4x faster latency** (no HTTP handshake overhead)
- ✅ **Simpler state management** (useMessageListState hook abstracts complexity)

---

### Frontend: useMessageListState Hook (Phase 2a)

**Location:** `apps/web/src/hooks/useMessageListState.ts`

**Purpose:** Abstract WebSocket messaging, optimistic updates, and state reconciliation

**Interface:**
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

## Core Systems

### 0. LLM Provider Integration

**Location:** `apps/server/src/llm/`

**Requirements:**

- Support multiple LLM providers via pluggable adapter interface
- Initial implementation: Qwen via OpenCode-Qwen-Proxy plugin
- Provider configuration via environment variables or config file (no UI for switching)
- Abstract provider-specific details behind common interface
- Session/conversation history passed with each request
- Handle provider-specific rate limits, errors, and retries

**Provider Adapter Interface:**

- Each provider implements a common adapter interface
- Adapters handle authentication, request formatting, response parsing
- Easy to add new providers (Claude, GPT-4, local models, etc.)

**Initial Provider: Qwen via Qwen-Proxy**

- Use OpenCode-Qwen-Proxy plugin approach
- Proxy handles Qwen API communication
- Backend calls proxy endpoint for LLM requests

---

### 1. MCP Server

**Location:** `apps/server/src/mcp/`

**Tools:**

- `list_components` - Return all available components with summaries (name, description, available props/variants)
- `get_component(name)` - Return full component definition (props, variants, states, composition rules)
- `get_tokens(type)` - Return design tokens by category (color, spacing, typography)
- `check_composition_rules(parent, child)` - Validate if a component can contain another
- `search_components(query)` - Find components by semantic purpose or description

**LLM Instructions (system prompt):**
- Never modify or generate `id` props on components
- Use only components returned by MCP tools
- Props must use semantic values from design system tokens
- Reference component names exactly as returned by `list_components`

---

### 2. Validation Engine

**Location:** `apps/server/src/validation/`

**Invariant:** The current design system must always be compatible with all designs using it.

**Three Validation Modes:**

**Design System Mode Validation** (creating components):
- TypeScript compilation check
- ESLint rules:
  - `semantic-props-only`: Component props must be semantic (e.g., `size`, `intent`) not CSS (e.g., `width`, `bg`)
  - `semantic-variants-only`: Variant values must be semantic tokens
- Knip check for unused imports/exports
- CSS-like styling allowed internally (MUI `sx`, styled-components), but not in exposed props

**Design Mode Validation** (using components):
- TypeScript compilation check
- ESLint rules:
  - `no-unknown-components`: Only imported design system components allowed
  - `valid-variant-values`: Variant props must match defined variant names
  - `composition-rules`: Enforce parent/child component nesting rules
- No CSS validation needed (components don't expose `sx` or similar)

**Design System Change Validation** (backward compatibility):
- Triggered on any design system component modification
- Query database for all designs using the modified component
- For each affected design:
  - Verify TypeScript compilation with new component definition
  - Detect breaking changes (removed props, renamed variants, etc.)
- Return compatibility result with list of breaking changes per design
- If incompatible, request LLM suggestions for resolution
- Block save until compatibility is restored

---

### 2b. Background Compatibility Validation

**Location:** `apps/server/src/validation/compatibility.ts`

**Trigger:** Any change to design system component files

**Process Requirements:**

1. Identify the changed component from the modified file
2. Query database for all designs using this component
3. Skip validation if no designs are affected
4. Run compatibility validation for each affected design:
   - Verify TypeScript compilation with new component definition
   - Detect breaking changes (removed props, renamed variants, type changes)
5. If incompatible, request LLM suggestions for resolution
6. Notify user with:
   - Component name being modified
   - Count of affected designs
   - List of specific breaking changes
   - LLM-generated resolution suggestions
7. Block save action until compatibility is restored

**LLM Suggestion Categories:**

1. **Make component more flexible:**
   - Make prop optional with default value
   - Support both old and new variant values (temporarily)
   - Widen prop type to accept both formats

2. **Update affected designs (preferred):**
   - List specific file/line changes needed
   - Generate migration code snippets
   - Offer to auto-fix all affected designs (update usages to new API)

**User Notification Requirements:**

- Display component name being modified
- Show count of affected designs
- List specific breaking changes detected
- Present LLM-generated suggestions:
  - Option to make component backward compatible
  - Option to auto-update all affected designs (preferred)
- Block save action until compatibility is restored

**Invariant Enforcement:**
- Design system changes that break existing designs cannot be saved
- User must resolve incompatibility before proceeding
- Resolution options:
  1. Accept suggestion to make component backward compatible
  2. Accept auto-fix to update all affected designs to new API
  3. Revert the design system change

---

### 3. Code Parser & ID Injector

**Location:** `apps/server/src/parser/`

**Requirements:**

- Query database for existing IDs before parsing
- Parse code using AST (Babel or TypeScript compiler)
- For each component instance:
  - Preserve existing valid IDs (not duplicated)
  - Inject new IDs for instances missing them
  - Detect and fix duplicate IDs (generate new unique ID)
- Calculate diff: added, removed, duplicated, unchanged IDs
- Update database index based on diff
- Write updated code (with IDs) back to source file
- Return diff summary to LLM with hint about system-managed IDs

**LLM Feedback:**

- Notify LLM when code has been modified with ID changes
- Include counts: IDs injected, removed, duplicates fixed
- Include reminder hint: "Do not modify or generate id props"
- LLM can reference specific instances by ID in subsequent prompts

---

### 4. Component Transformer

**Location:** `apps/server/src/transformer/`

**Wraps components with helper HOCs:**

```typescript
// Input (from user/LLM)
<Button variant="primary" size="large">Click me</Button>

// Output (in build folder)
<AuditWrapper 
  id="id_123456_0" 
  componentName="Button"
  highlight={auditMode && selectedComponentId === 'id_123456_0'}
>
  <SelectionBox>
    <Button variant="primary" size="large">Click me</Button>
  </SelectionBox>
</AuditWrapper>
```

**Wrapper Components:** `packages/design-system-runtime/src/wrappers/`

- `AuditWrapper`: Handles highlighting in audit mode
- `SelectionBox`: Shows selection bounding box in Select mode
- `MetadataProvider`: Attaches instance metadata for property editor

---

### 5. Database

**Location:** `apps/server/src/database/`

**Requirements:**

- SQLite database for component usage index and audit data
- Database is a generated artifact (not versioned, stored in `.gitignore`)
- Rebuilt from source code on app startup or when git HEAD changes
- Parse time acceptable for MVP; optimization in later phases

**Data to Store:**

- Component usage index: maps component names to design files and instance IDs
- Instance metadata: ID, file path, component type, location in file
- Design system version tracking (optional, for Phase 6)

**Rebuild Process (pseudo code):**

```
FOR each design file in workspace/designs/:
  READ file contents
  PARSE code to extract component instances
  FOR each component instance:
    EXTRACT component name, instance ID, file location
    STORE in component_usage index

COMMIT all entries in single transaction
```

**Query Requirements:**

- Get all designs using a specific component (for compatibility validation)
- Get all instances of a component with their file locations (for audit mode)
- Get instance metadata by ID (for property editor)

---

### 6. UI ↔ Code Synchronization

**Location:** `apps/web/src/hooks/`

**Property Editor Flow:**

1. User selects component instance in Select Mode
2. Property editor loads instance metadata (component type, current prop values)
3. User modifies property value (locked to semantic options from design system)
4. Code file updated directly with new prop value
5. Build transformation triggered
6. Preview iframe refreshes via Vite HMR

**File Watching:**

- Watch source files for changes (chokidar or Vite HMR)
- Trigger rebuild and preview refresh on change
- Debounce rapid changes to avoid excessive rebuilds

---

## Data Flow

### Design Generation Flow (Phase 3 with Phase 2a WebSocket)

1. **User submits prompt via WebSocket**
   - Client generates message ID: `msg_client_123`
   - Sends via WebSocket: `{ type: 'message', id: 'msg_client_123', content: '...' }`

2. **Server immediately acknowledges**
   - Sends: `{ type: 'ack', messageId: 'msg_client_123', serverId: 'msg_003' }`
   - Client converts optimistic message: `msg_client_123` → `msg_003`

3. **Backend queries design system via MCP** (components, tokens, rules)

4. **LLM generates structured JSON design spec** (tool calling)

5. **Code generator converts JSON to TSX**

6. **Validation pipeline runs** (TypeScript, ESLint, Knip)

7. **If validation fails:** Stream error via WebSocket `{ type: 'error', error: '...' }`

8. **If validation passes:**
   - Inject IDs into component instances
   - Write updated code to source file
   - Save to session messages
   - Wrap components for build folder
   - Update database index
   - Stream progress via `{ type: 'content', content: '...' }`
   - Send completion via `{ type: 'done', messageId: 'msg_003' }`
   - Refresh preview iframe

---

## Performance Considerations

| Operation | Expected Time | Optimization Strategy |
|-----------|---------------|----------------------|
| Database rebuild (100 designs) | < 5 seconds | Incremental parsing, cache AST |
| ID injection | < 500ms | Only parse changed files |
| Build transformation | < 1 second | Parallel processing |
| Validation (TS + ESLint + Knip) | < 2 seconds | Incremental checks, caching |
| Audit query | < 50ms | Indexed SQLite queries |

---

## Security Considerations

1. **LLM Code Injection**: All LLM-generated code must pass validation before execution
2. **Sandboxed Execution**: Run validation in isolated context (vm2 or similar)
3. **File Access**: Restrict file operations to `workspace/` directory only
4. **XSS Prevention**: Sanitize any user-provided content before rendering

---

## Open Technical Decisions

1. **Monorepo vs Single Repo**: Turborepo for monorepo management?
2. **LLM Provider**: Which model(s) to support? (Claude, GPT-4, local?)
3. **Hot Reload**: File watching strategy (chokidar vs polling)?
4. **Build Folder Sync**: Auto-trigger on file change or manual?
5. **iframe Communication**: Custom postMessage or library like `postmate`?
