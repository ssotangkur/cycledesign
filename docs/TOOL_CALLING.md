# LLM Tool Calling Specification

**Phase 3: Prompt-to-UI Rendering**

This document defines the LLM tool calling system for Phase 3 code generation.

---

## Overview

The LLM uses **7 separate tools** to generate and manage UI designs. All tools are defined in `apps/server/src/llm/tools/` and use Zod schemas for parameter validation.

### Tool List

1. **create_file** - Create new design files
2. **edit_file** - Modify existing designs (patch-based)
3. **rename_file** - Rename design files
4. **delete_file** - Delete design files
5. **add_dependency** - Add npm packages to preview environment
6. **submit_work** - Signal completion and trigger validation (REQUIRED when done)
7. **ask_user** - Request clarification from user

### Key Points

- All tools enforce file constraints (.tsx only, designs/ directory, kebab-case filenames)
- `submit_work` MUST be called when LLM is completely done (triggers validation + preview start)
- `submit_work` takes empty arguments `{}` - system automatically tracks changes
- Tools are called via WebSocket-triggered LLM completion requests

---

## Tool Definitions

### 1. create_file

Create a new design file with the provided code.

```typescript
import { z } from 'zod';

export const createFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs')
    .describe('Files can only be created in the designs/ directory'),
  code: z
    .string()
    .describe('Complete TypeScript React code to write to the file'),
});

export type CreateFileArgs = z.infer<typeof createFileSchema>;
```

**Example:**
```typescript
{
  filename: "landing-page.tsx",
  location: "designs",
  code: `import React from 'react';\nexport default function LandingPage() { ... }`
}
```

---

### 2. edit_file

Modify an existing design file using unified diff patch.

```typescript
import { z } from 'zod';

export const editFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs'),
  patch: z
    .string()
    .describe('Unified diff patch to apply to the file'),
});

export type EditFileArgs = z.infer<typeof editFileSchema>;
```

**Example Patch:**
```diff
@@ -10,7 +10,7 @@ export default function LandingPage() {
     <Box sx={{ bgcolor: 'primary.main', color: 'white', py: 8 }}>
       <Container maxWidth="md">
-        <Typography variant="h3">Welcome</Typography>
+        <Typography variant="h2">Welcome to Our Platform</Typography>
       </Container>
     </Box>
   );
```

---

### 3. rename_file

Rename an existing design file.

```typescript
import { z } from 'zod';

export const renameFileSchema = z.object({
  oldFilename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  newFilename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs'),
});

export type RenameFileArgs = z.infer<typeof renameFileSchema>;
```

**Example:**
```typescript
{
  oldFilename: "old-design.tsx",
  newFilename: "new-design.tsx",
  location: "designs"
}
```

---

### 4. delete_file

Delete an existing design file.

```typescript
import { z } from 'zod';

export const deleteFileSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-z0-9-]+\.tsx$/, 'Filename must be kebab-case with .tsx extension'),
  location: z
    .literal('designs'),
});

export type DeleteFileArgs = z.infer<typeof deleteFileSchema>;
```

**Example:**
```typescript
{
  filename: "old-landing-page.tsx",
  location: "designs"
}
```

---

### 5. add_dependency

Add an npm package to the preview environment.

```typescript
import { z } from 'zod';

export const addDependencySchema = z.object({
  packageName: z
    .string()
    .regex(/^[a-z0-9@/._-]+$/, 'Invalid package name'),
  version: z
    .string()
    .optional()
    .describe('Version range (e.g., "^5.0.0"). If omitted, latest stable is used'),
});

export type AddDependencyArgs = z.infer<typeof addDependencySchema>;
```

**Example:**
```typescript
{
  packageName: "framer-motion",
  version: "^10.16.0"
}
```

---

### 6. submit_work

Signal that all work is complete and trigger the validation pipeline.

```typescript
import { z } from 'zod';

export const submitWorkSchema = z.object({});

export type SubmitWorkArgs = z.infer<typeof submitWorkSchema>;
```

**Important:**
- Takes **empty arguments** `{}`
- System automatically tracks:
  - Files created/modified during this turn
  - Dependencies added during this turn
- Triggers validation pipeline:
  1. Dependency check
  2. TypeScript compilation
  3. ESLint validation
  4. Knip check
  5. ID injection
  6. Preview server reload
- **LLM MUST call this when completely done**

**Example:**
```typescript
{}
```

---

### 7. ask_user

Request clarification from the user before continuing.

```typescript
import { z } from 'zod';

export const askUserSchema = z.object({
  question: z
    .string()
    .describe('The question to ask the user'),
  context: z
    .string()
    .describe('Why this question is needed'),
  suggestions: z
    .array(z.string())
    .optional()
    .describe('Suggested answers the user can click'),
});

export type AskUserArgs = z.infer<typeof askUserSchema>;
```

**Example:**
```typescript
{
  question: "What metrics should the dashboard display?",
  context: "Need to know what data to show in the dashboard",
  suggestions: ["Revenue", "Users", "Activity", "Custom..."]
}
```

---

## Multi-Turn Tool Calling Workflow

### Phase 1: LLM Staging Changes

```
User: "Create a landing page with animations"
         │
         ▼
┌─────────────────────────┐
│  LLM Tool Calls         │
│  (multiple, staged)     │
│                         │
│  1. add_dependency      │
│     {packageName:       │
│      "framer-motion"}   │
│                         │
│  2. create_file         │
│     {filename:          │
│      "landing-page.tsx",│
│      code: "..."}       │
│                         │
│  3. submit_work         │
│     {}  ← EMPTY!        │
│         System tracks:  │
│         - filesCreated  │
│         - dependencies  │
└─────────────────────────┘
         │
         │ Triggers validation + preview start
         ▼
```

### Phase 2: Validation Pipeline

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

### Phase 3: Error Feedback to LLM

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
  "instruction": "Please fix these errors and call submit_work again"
}
         │
         ▼
┌─────────────────────────┐
│  LLM Fixes Errors       │
│                         │
│  1. edit_file           │
│     {filename:          │
│      "landing-page.tsx",│
│      patch: "@@ -42..."}│
│                         │
│  2. submit_work         │
│     {}  ← EMPTY again!  │
│         (triggers       │
│          validation)    │
└─────────────────────────┘
         │
         │ Triggers validation again
         ▼
```

### Phase 4: Success

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

## ask_user Flow Example

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

## Error Handling Strategy

### Error Categories

| Category | Source | LLM Resolution |
|----------|--------|----------------|
| **TypeScript** | tsc compiler | Fix type errors, imports, or component usage |
| **ESLint** | ESLint rules | Fix style/syntax issues |
| **Knip** | Unused imports | Remove unused imports/exports |
| **Dependency** | Missing package | Call `add_dependency` or change imports |
| **Composition** | Design system rules (Phase 4+) | Use valid component nesting |
| **Semantic** | Invalid prop values | Use design system tokens |

### Error Response Format

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
  userQuestion?: {  // If LLM called ask_user
    question: string;
    context: string;
    suggestions?: string[];
  };
}
```

---

## Security Constraints

All file tools enforce:

| Constraint | Validation | Rationale |
|------------|------------|-----------|
| **File extension** | `.tsx` only | Prevents config/system file modification |
| **Directory** | `designs/` only | LLM can't touch design system or source code |
| **Filename format** | `^[a-z0-9-]+\.tsx$` | Kebab-case, no special chars, no path traversal |
| **No absolute paths** | Relative paths only | Prevents writing outside workspace |
| **No path traversal** | Reject `..` in paths | Prevents escaping designs/ directory |

### Example Blocked Requests

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

---

## Code Generation System Prompt

The system prompt for code generation includes:

- Tool availability and usage instructions
- **CRITICAL: submit_work requirements** (must call when done, empty arguments)
- File constraints (.tsx only, designs/ directory, kebab-case)
- Code requirements (TypeScript, no id props, complete runnable code)
- Patch-based editing guidelines
- Dependency management instructions
- ask_user usage guidelines
- Good/bad filename examples

---

## WebSocket Integration

Code generation is triggered via WebSocket messages (Phase 2a protocol), not REST endpoints.

### Client → Server

```typescript
// User sends generation prompt via WebSocket
ws.send(JSON.stringify({
  type: 'message',
  id: 'msg_client_1234567890',
  content: 'Create a landing page with hero and features',
  timestamp: Date.now()
}));
```

### Server → Client

```typescript
// Immediate acknowledgment
{
  "type": "ack",
  "messageId": "msg_client_1234567890",
  "serverId": "msg_003",
  "timestamp": Date.now()
}

// Tool call status updates
{
  "type": "status",
  "messageId": "msg_003",
  "status": "tool_call_start",
  "tool": "addDependency",
  "details": "Installing framer-motion..."
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

### Server-Side Process

1. WebSocket message received
2. Immediate acknowledgment sent (Phase 2a protocol)
3. LLM tool calling triggered (`create_file` tool)
4. Backend validates filename constraints (kebab-case, .tsx, designs/)
5. Check dependencies (call `add_dependency` if needed)
6. Validate code (TypeScript, ESLint, Knip)
7. Inject IDs
8. Write to filesystem
9. Save to session messages
10. Send `done` message to client

### Frontend Usage

```typescript
// Use Phase 2a's useMessageListState hook
const { sendMessage } = useMessageListState(sessionId);

// Send generation prompt
sendMessage('Create a landing page with hero section and features');
```

---

## Status Broadcasting

### Status Message Types

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

### Status Broadcaster Implementation

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

### Tool Calling Integration

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
    case 'add_dependency':
      return `Installing ${args.packageName}...`;
    case 'create_file':
      return `Creating ${args.filename}...`;
    case 'edit_file':
      return `Editing ${args.filename}...`;
    default:
      return `Executing ${tool}...`;
  }
}

function getToolCompleteMessage(tool: string, result: any): string {
  switch (tool) {
    case 'add_dependency':
      return `Package installed successfully`;
    case 'create_file':
      return `File created: ${result.filename}`;
    case 'edit_file':
      return `File updated: ${result.filename}`;
    default:
      return `${tool} completed`;
  }
}
```

### Validation Pipeline Integration

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

### Preview Server Integration

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

### WebSocket Handler Integration

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

### Frontend Status Message Component

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

### Message List Integration

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

## Implementation Files

Create the following files in `apps/server/src/llm/tools/`:

- `create-file.ts` - create_file tool definition
- `edit-file.ts` - edit_file tool definition
- `rename-file.ts` - rename_file tool definition
- `delete-file.ts` - delete_file tool definition
- `add-dependency.ts` - add_dependency tool definition
- `submit-work.ts` - submit_work tool definition
- `ask-user.ts` - ask_user tool definition
- `index.ts` - Export all tools

Each tool file should export:
- Zod schema for validation
- Tool definition for LLM
- Execution function
- Type definition

---

## Architecture Overview

### Directory Structure

```
apps/server/src/
├── transport/
│   └── ws/
│       └── WebSocketHandler.ts    # Connection, session, rate limiting
│
├── features/
│   └── status/
│       ├── types.ts               # StatusMessage, StatusType
│       ├── StatusBroadcaster.ts   # Pub/sub core
│       └── WebSocketBridge.ts     # Bridge status→WebSocket
│
├── llm/
│   ├── agent.ts                   # ToolLoopAgent
│   ├── tool-executor.ts           # Manual tool execution
│   └── providers/
│       ├── mock.ts                # Mock provider for testing
│       ├── mistral.ts
│       └── qwen.ts
│
└── validation/
    └── validation-service.ts      # Shared validation logic
```

### Responsibility Boundaries

| Layer | Directory | Responsibilities |
|-------|-----------|------------------|
| Transport | `transport/ws/` | WebSocket protocol, connections, sessions |
| Application | `features/status/` | Status broadcasting, WebSocket bridge |
| Domain | `llm/`, `validation/` | LLM orchestration, validation |

## Status Message Protocol

### Status Types

| Status Type | When Sent | Payload |
|-------------|-----------|---------|
| `generation_start` | Agent begins processing | `messageId, details` |
| `generation_thinking` | LLM step starts | `messageId, details` |
| `generation_complete` | All steps complete | `messageId, details, text` |
| `tool_call_start` | Before tool execute | `messageId, tool, details` |
| `tool_call_complete` | After tool success | `messageId, tool, details` |
| `tool_call_error` | After tool failure | `messageId, tool, details` |
| `validation_start` | Validation stage begins | `messageId, details` |
| `validation_complete` | All validations passed | `messageId, details` |
| `preview_start` | Starting preview server | `messageId, details` |
| `preview_ready` | Preview server running | `messageId, details, port` |

### WebSocket Message Format

```typescript
interface StatusMessage {
  type: 'status';
  messageId: string;
  status: StatusType;
  tool?: string;
  details: string;
  timestamp: number;
}
```

### Client-Side Handling

Status messages are received via the WebSocket connection and handled by the `SessionWebSocket.onStatus` callback:

```typescript
instance.ws.onStatus = (status) => {
  // Update UI state with status message
  instance!.currentStatus = status;
  instance!.subscribers.forEach(fn => fn());
};
```

## Mock Provider

### Enabling Mock Provider

Set environment variable:

```bash
ENABLE_MOCK_PROVIDER=true
```

### Using in Tests

```typescript
import { useMockProvider } from '../fixtures/test-fixtures';

test('should work with mock provider', async ({ useMockProvider }) => {
  await useMockProvider();
  // ... test code
});
```

### Mock Provider Behavior

The MockProvider provides deterministic responses for testing:

- **File creation prompts** (`create file`, `create_file`): Returns a `create_file` tool call with test.tsx
- **Edit prompts** (`edit`, `update`): Returns an `edit_file` tool call
- **Default**: Returns a text response with no tool calls

### Writing Deterministic Tests

When writing E2E tests with the MockProvider:

1. Enable the mock provider via environment variable or fixture
2. Use specific prompt patterns to trigger known tool calls
3. Assert on deterministic outcomes (no flaky timing)
4. Verify status messages are broadcast correctly

Example:

```typescript
test('should create file with mock provider', async ({
  authenticatedPage,
  useMockProvider,
}) => {
  await useMockProvider();
  
  await promptInput.fill('Create file test.tsx');
  await promptInput.press('Enter');
  
  // Verify tool call status appears
  await expect(page.getByText('create_file')).toBeVisible();
  
  // Verify file creation status
  await expect(page.getByText('test.tsx')).toBeVisible();
});
```

---

## Architecture Overview

### Complete Directory Structure

```
apps/server/src/
├── transport/
│   └── ws/
│       └── WebSocketHandler.ts    # WebSocket connections, sessions, rate limiting
│
├── features/
│   └── status/
│       ├── types.ts               # StatusMessage, StatusType, WebSocketStatusMessage
│       ├── StatusBroadcaster.ts   # Pub/sub core for status events
│       └── WebSocketBridge.ts     # Bridge: application status → WebSocket transport
│
├── llm/
│   ├── agent.ts                   # ToolLoopAgent with streaming
│   ├── tool-executor.ts           # Manual tool execution (legacy)
│   ├── tools/                     # Tool definitions (create_file, edit_file, etc.)
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

### Responsibility Boundaries

| Layer | Directory | Responsibilities | Should Not |
|-------|-----------|------------------|------------|
| **Transport** | `transport/ws/` | WebSocket protocol, TCP connections, session tracking, rate limiting, message routing | Know about LLM, tools, or validation |
| **Application** | `features/status/` | Status message types, pub/sub broadcasting, WebSocket bridge | Implement business logic |
| **Domain** | `llm/`, `validation/`, `preview/` | LLM orchestration, tool execution, validation logic, preview management | Directly manage WebSocket connections |

### Architectural Principle

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (ToolLoopAgent, Validation, Preview)   │
│              ↓ uses                     │
│     StatusBroadcaster (pub/sub)         │
└─────────────────────────────────────────┘
              ↓ broadcasts to
┌─────────────────────────────────────────┐
│        Transport Layer                  │
│  WebSocketBridge → WebSocketHandler     │
│         (sends via WS connection)       │
└─────────────────────────────────────────┘
```

### Data Flow Diagram

```
User Message (WebSocket)
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │
│  - Receives message     │
│  - Creates session      │
│  - Registers in Bridge  │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  ToolLoopAgent          │
│  - Processes prompt     │
│  - Calls tools          │
│  - Streams response     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  StatusBroadcaster      │
│  - Publishes status     │
│  - Notifies subscribers │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketBridge        │
│  - Maps messageId→sessId│
│  - Forwards to WS       │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │
│  - Sends to client      │
└─────────────────────────┘
```

---

## Status Message Protocol

For a complete reference of all status message types, see [Status Messages Reference](./STATUS-MESSAGES.md).

### Quick Reference

| Category | Status Types |
|----------|--------------|
| **Generation** | `generation_start`, `generation_thinking`, `generation_complete` |
| **Tool Calls** | `tool_call_start`, `tool_call_complete`, `tool_call_error` |
| **Validation** | `validation_start`, `validation_complete`, `validation_error` |
| **Preview** | `preview_start`, `preview_ready`, `preview_error` |

### WebSocket Message Format

```typescript
interface StatusMessage {
  type: 'status';
  messageId: string;         // Links status to original user message
  status: StatusType;        // One of the status types above
  tool?: string;             // Tool name (for tool_call_* statuses)
  details: string;           // Human-readable description
  timestamp: number;         // Unix timestamp (ms)
}
```

### Client-Side Handling

Status messages are received via the WebSocket connection:

```typescript
// apps/web/src/api/websocket.ts
export class SessionWebSocket {
  onStatus?: (status: StatusMessage) => void;

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(event.data) as WebSocketMessage;

    switch (data.type) {
      case 'status':
        this.onStatus?.(data as StatusMessage);
        break;
      // ... other cases
    }
  }
}
```

### React Integration

```typescript
// apps/web/src/hooks/useMessageListState.ts
const { currentStatus } = useMessageListState(sessionId);

// In component:
{currentStatus && (
  <StatusDisplay
    status={currentStatus.status}
    tool={currentStatus.tool}
    details={currentStatus.details}
  />
)}
```

---

## WebSocketBridge Usage

### Overview

`WebSocketBridge` connects the application-layer status broadcasting system to the WebSocket transport layer. It maintains a mapping of `messageId` to `sessionId` for routing status messages.

### Registration

Register a session when message processing starts:

```typescript
import { webSocketBridge } from './features/status/WebSocketBridge.js';

// When a new message arrives
webSocketBridge.registerSession(messageId, sessionId);
```

### Broadcasting Status

Broadcast status to a specific session:

```typescript
// Method 1: Using sessionId directly
webSocketBridge.broadcastStatus(sessionId, messageId, {
  status: 'generation_start',
  details: 'Starting generation...',
  timestamp: Date.now(),
});

// Method 2: Using messageId (bridge looks up sessionId)
const sent = webSocketBridge.broadcastStatusByMessageId(messageId, {
  status: 'tool_call_start',
  tool: 'create_file',
  details: 'Creating file...',
  timestamp: Date.now(),
});

if (!sent) {
  console.warn('Failed to send status - sessionId not found');
}
```

### Unregistration

Clean up when message processing completes:

```typescript
webSocketBridge.unregisterSession(messageId);
```

### Complete Example

```typescript
// In server.ts or route handler
import { webSocketBridge } from './features/status/WebSocketBridge.js';

async function handleUserMessage(messageId: string, sessionId: string, content: string) {
  // Register session
  webSocketBridge.registerSession(messageId, sessionId);

  try {
    // Send generation start
    webSocketBridge.broadcastStatus(sessionId, messageId, {
      status: 'generation_start',
      details: 'Processing your request...',
      timestamp: Date.now(),
    });

    // Process with LLM
    const result = await toolLoopAgent.process(content);

    // Send generation complete
    webSocketBridge.broadcastStatus(sessionId, messageId, {
      status: 'generation_complete',
      details: 'Generation complete',
      timestamp: Date.now(),
    });

  } catch (error) {
    // Send error status
    webSocketBridge.broadcastStatus(sessionId, messageId, {
      status: 'generation_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    });
  } finally {
    // Clean up
    webSocketBridge.unregisterSession(messageId);
  }
}
```

---

## Mock Provider Usage

### Enabling Mock Provider

**Development:**
```bash
# In apps/server/.env or .env.local
ENABLE_MOCK_PROVIDER=true
```

**Testing:**
```typescript
// In E2E test fixture
await page.evaluate(() => {
  localStorage.setItem('cycledesign:provider', 'mock');
});
await page.reload();
```

### When to Use

| Scenario | Use Mock Provider? | Reason |
|----------|-------------------|--------|
| **Unit Tests** | ✅ Yes | Fast, deterministic, no API costs |
| **E2E Flow Tests** | ✅ Yes | Test UI flow without LLM variability |
| **Integration Tests** | ⚠️ Sometimes | Depends on what you're testing |
| **Manual Development** | ⚠️ Sometimes | Good for UI development, not for testing real LLM behavior |
| **Production** | ❌ No | Mock provider is for testing only |

### Known Limitations

1. **Deterministic Responses:** Mock provider returns the same responses for the same prompts. This is good for testing but doesn't reflect real LLM behavior.

2. **Limited Tool Calls:** Only responds to specific prompt patterns:
   - `create file` / `create_file` → `create_file` tool call
   - `edit` / `update` → `edit_file` tool call
   - Everything else → plain text response

3. **No Streaming Delays:** Simulates streaming with fixed 50ms delays, not real token generation timing.

4. **No Context Awareness:** Doesn't maintain conversation context or remember previous messages.

5. **Simplified Errors:** Doesn't simulate complex error scenarios like rate limiting or API failures.

### Configuring Mock Responses

```typescript
// apps/server/src/llm/providers/mock.ts
export class MockProvider {
  async complete(messages: Message[], options: CompletionOptions) {
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage.content;

    // Customize responses based on prompt patterns
    if (prompt.includes('dashboard')) {
      return {
        stream: this.generateChunks('Creating a dashboard...'),
        toolCalls: [{
          toolCallId: 'mock-1',
          toolName: 'create_file',
          args: {
            filename: 'dashboard.tsx',
            code: 'export default function Dashboard() { ... }',
          },
        }],
      };
    }

    // Default response
    return {
      stream: this.generateChunks('Mock response'),
    };
  }
}
```

### Writing Tests with Mock Provider

```typescript
// tests/e2e/tests/chat-mock.spec.ts
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Chat Flow with Mock Provider', () => {
  test('should complete full chat flow', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    await useMockProvider();
    await createSession();

    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill('Create file test.tsx');
    await promptInput.press('Enter');

    // Verify deterministic outcomes
    await expect(authenticatedPage.getByText('create_file')).toBeVisible();
    await expect(authenticatedPage.getByText('test.tsx')).toBeVisible();
  });

  test('should show status messages', async ({
    authenticatedPage,
    useMockProvider,
  }) => {
    await useMockProvider();

    // ... trigger generation

    // Verify status messages appear
    await expect(authenticatedPage.getByTestId('status-tool_call_start')).toBeVisible();
    await expect(authenticatedPage.getByTestId('status-tool_call_complete')).toBeVisible();
  });
});
```

---

## Testing Guide

### Running E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (headed mode)
npm run test:e2e:ui

# Run in debug mode (Playwright Inspector)
npm run test:e2e:debug

# Run specific test file
npx playwright test tests/e2e/tests/chat.spec.ts

# Run tests matching a pattern
npx playwright test -g "Chat Flow"
```

### Writing Deterministic Tests

**Do:**
- Use the MockProvider for flow testing
- Assert on visible UI states, not internal timing
- Use `data-testid` attributes for reliable selectors
- Test one behavior per test case

**Don't:**
- Rely on `setTimeout()` or fixed delays
- Test LLM response quality (use mock for flow, not content)
- Make assumptions about message order beyond what's guaranteed
- Skip cleanup (close sessions, unregister bridges)

### Debugging Test Failures

1. **Run in UI mode:** `npm run test:e2e:ui` to see what's happening
2. **Check console logs:** Browser console shows WebSocket messages
3. **Use Playwright Inspector:** `npm run test:e2e:debug` for step-through
4. **Enable verbose logging:** Set `DEBUG=pw:webchat` for WebSocket logs
5. **Check network tab:** Verify WebSocket connection and messages

### Common Test Patterns

```typescript
// Pattern 1: Basic chat flow
test('should send and receive messages', async ({ authenticatedPage }) => {
  const promptInput = authenticatedPage.getByTestId('prompt-input');
  await promptInput.fill('Hello');
  await promptInput.press('Enter');
  
  // Verify user message appears
  await expect(authenticatedPage.getByText('Hello')).toBeVisible();
  
  // Verify response appears
  await expect(authenticatedPage.getByText('Response')).toBeVisible();
});

// Pattern 2: Tool execution flow
test('should execute tools', async ({ authenticatedPage, useMockProvider }) => {
  await useMockProvider();
  
  await promptInput.fill('Create file test.tsx');
  await promptInput.press('Enter');
  
  // Verify tool call status
  await expect(authenticatedPage.getByText('create_file')).toBeVisible();
});

// Pattern 3: Error handling
test('should handle errors gracefully', async ({ authenticatedPage }) => {
  // Trigger an error condition
  await promptInput.fill('');
  await promptInput.press('Enter');
  
  // Verify error message
  await expect(authenticatedPage.getByText('Message cannot be empty')).toBeVisible();
});
```

---

## Cross-References

- **Preview Server Management**: See `docs/Phase3.md` section "Backend-Managed Preview Server Lifecycle"
- **Validation Pipeline**: See `docs/Phase3.md` section "Validation Pipeline"
- **Status Messages Reference**: See `docs/STATUS-MESSAGES.md` for complete status type documentation
- **WebSocket Migration Plan**: See `docs/WEBSOCKET-MIGRATION.md` for architecture details
- **ID Injection**: See `docs/Phase3.md` section "ID Injection System"
- **WebSocket Protocol**: See `docs/Phase3.md` section "Code Generation Flow (WebSocket-Based)"
- **UI Layout**: See `docs/Phase3.md` section "UI Layout Architecture"
- **WebSocket Migration**: See `docs/WEBSOCKET-MIGRATION.md` for the complete migration plan
