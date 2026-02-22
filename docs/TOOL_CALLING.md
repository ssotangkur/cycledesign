# LLM Tool Calling Specification

**Phase 3: Prompt-to-UI Rendering**

This document defines the LLM tool calling system for Phase 3 code generation.

---

## Overview

The LLM uses **7 separate tools** to generate and manage UI designs. All tools are defined in `apps/server/src/llm/tools/` and use Zod schemas for parameter validation.

### Tool List

1. **createFile** - Create new design files
2. **editFile** - Modify existing designs (patch-based)
3. **renameFile** - Rename design files
4. **deleteFile** - Delete design files
5. **addDependency** - Add npm packages to preview environment
6. **submitWork** - Signal completion and trigger validation (REQUIRED when done)
7. **askUser** - Request clarification from user

### Key Points

- All tools enforce file constraints (.tsx only, designs/ directory, kebab-case filenames)
- `submitWork` MUST be called when LLM is completely done (triggers validation + preview start)
- `submitWork` takes empty arguments `{}` - system automatically tracks changes
- Tools are called via WebSocket-triggered LLM completion requests

---

## Tool Definitions

### 1. createFile

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

### 2. editFile

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

### 3. renameFile

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

### 4. deleteFile

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

### 5. addDependency

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

### 6. submitWork

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

### 7. askUser

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

## Error Handling Strategy

### Error Categories

| Category | Source | LLM Resolution |
|----------|--------|----------------|
| **TypeScript** | tsc compiler | Fix type errors, imports, or component usage |
| **ESLint** | ESLint rules | Fix style/syntax issues |
| **Knip** | Unused imports | Remove unused imports/exports |
| **Dependency** | Missing package | Call `addDependency` or change imports |
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
  userQuestion?: {  // If LLM called askUser
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
- **CRITICAL: submitWork requirements** (must call when done, empty arguments)
- File constraints (.tsx only, designs/ directory, kebab-case)
- Code requirements (TypeScript, no id props, complete runnable code)
- Patch-based editing guidelines
- Dependency management instructions
- askUser usage guidelines
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
3. LLM tool calling triggered (`createFile` tool)
4. Backend validates filename constraints (kebab-case, .tsx, designs/)
5. Check dependencies (call `addDependency` if needed)
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

- `create-file.ts` - createFile tool definition
- `edit-file.ts` - editFile tool definition
- `rename-file.ts` - renameFile tool definition
- `delete-file.ts` - deleteFile tool definition
- `add-dependency.ts` - addDependency tool definition
- `submit-work.ts` - submitWork tool definition
- `ask-user.ts` - askUser tool definition
- `index.ts` - Export all tools

Each tool file should export:
- Zod schema for validation
- Tool definition for LLM
- Execution function
- Type definition

---

## Cross-References

- **Preview Server Management**: See `docs/Phase3.md` section "Backend-Managed Preview Server Lifecycle"
- **Validation Pipeline**: See `docs/Phase3.md` section "Validation Pipeline"
- **ID Injection**: See `docs/Phase3.md` section "ID Injection System"
- **WebSocket Protocol**: See `docs/Phase3.md` section "Code Generation Flow (WebSocket-Based)"
- **UI Layout**: See `docs/Phase3.md` section "UI Layout Architecture"
