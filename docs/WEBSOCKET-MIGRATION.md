# WebSocket Architecture Migration Plan

**Status:** Complete
**Created:** March 9, 2026
**Last Updated:** March 11, 2026

## Migration Status

- [x] Phase 1: Deduplicate Validation - COMPLETE
- [x] Phase 2: Restructure Directories - COMPLETE
- [x] Phase 3: WebSocket Bridge - COMPLETE
- [x] Phase 4: Mock Provider - COMPLETE
- [x] Phase 5: Client Integration - COMPLETE
- [x] Phase 6: E2E Tests - COMPLETE
- [x] Phase 7: Cleanup and Documentation - COMPLETE

## Final Architecture

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

### Responsibility Boundaries

| Layer | Directory | Responsibilities |
|-------|-----------|------------------|
| **Transport** | `transport/ws/` | WebSocket protocol, TCP connections, session tracking, rate limiting, message routing |
| **Application** | `features/status/` | Status message types, pub/sub broadcasting, WebSocket bridge |
| **Domain** | `llm/`, `validation/`, `preview/` | LLM orchestration, tool execution, validation logic, preview management |

### Data Flow

```
User Message (WebSocket)
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │  Transport Layer
│  (receives message)     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  ToolLoopAgent          │  Application Layer
│  (processes prompt)     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  StatusBroadcaster      │  Application Layer
│  (publishes status)     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketBridge        │  Bridge
│  (routes to session)    │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │  Transport Layer
│  (sends to client)      │
└─────────────────────────┘
```

## Executive Summary

This document outlines the migration plan to unify the dual WebSocket implementations in the CycleDesign server, establish clear architectural boundaries between transport and application layers, and enable deterministic E2E testing through a mock LLM provider.

### Current Problems

1. **Dual WebSocket Implementations:** Two competing systems (`src/ws/ws.ts` and `src/websocket/`) with overlapping responsibilities
2. **Unclear Boundaries:** Directory names don't indicate distinct purposes
3. **Duplicate Validation Logic:** `handleValidationAndPreview()` exists in both `agent.ts` and `tool-executor.ts`
4. **Incomplete Client Integration:** Server broadcasts status messages that client doesn't receive
5. **Non-Deterministic E2E Tests:** Tests depend on real LLM responses, making them flaky

### Target Architecture

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
│   ├── tools/                     # Tool implementations
│   └── providers/
│       ├── provider-factory.ts
│       ├── mistral.ts
│       ├── qwen.ts
│       └── mock.ts                # NEW: Mock provider
│
└── validation/
    ├── validation-service.ts      # NEW: Shared validation
    ├── pipeline.ts
    └── ...
```

### Responsibility Boundaries

| Layer | Directory | Responsibilities |
|-------|-----------|------------------|
| **Transport** | `transport/ws/` | WebSocket protocol, TCP connections, session tracking, rate limiting, message routing |
| **Application** | `features/status/` | Status message types, pub/sub broadcasting, WebSocket bridge |
| **Domain** | `llm/`, `validation/` | LLM orchestration, tool execution, validation logic |

**Architectural Principle:**

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

---

## Phase 1: Foundation - Deduplicate Validation Logic

### Step 1.1: Extract Shared Validation Service

**Create:** `apps/server/src/validation/validation-service.ts`

**Purpose:** Consolidate duplicate `handleValidationAndPreview()` logic from `agent.ts` and `tool-executor.ts` into a single reusable service.

**API:**

```typescript
export class ValidationService {
  constructor(
    private previewDir: string,
    private serverDir: string
  );

  async validateAndPreparePreview(messageId: string): Promise<ValidationResult>;
  async checkDependencies(code: string, filename: string): Promise<ValidationError[]>;
  async validateTypeScript(code: string, filename: string): Promise<TSError[]>;
  async validateESLint(code: string, filename: string): Promise<ESLintError[]>;
  async injectIds(code: string, filename: string): Promise<{ code: string }>;
}
```

**Implementation Notes:**
- Extract common logic from both `agent.ts` (lines 77-127) and `tool-executor.ts` (lines 81-135)
- Use `statusBroadcaster` for status updates (dependency injection or import)
- Return structured results for error handling

**Validation:**
- [ ] `npm run build` in `apps/server` compiles without errors
- [ ] `npm run lint` passes with no new ESLint errors
- [ ] `npm run test` passes (existing unit tests)
- [ ] Manual test: Trigger validation in both code paths, verify identical behavior

---

### Step 1.2: Refactor agent.ts to Use ValidationService

**Modify:** `apps/server/src/llm/agent.ts`

**Changes:**
1. Import `ValidationService` from new module
2. Replace inline `handleValidationAndPreview()` function with service call
3. Keep `experimental_onToolCallFinish` callback structure intact
4. Update error handling to use service return values

**Before:**
```typescript
async function handleValidationAndPreview(messageId: string): Promise<...> {
  // 50 lines of inline validation logic
}
```

**After:**
```typescript
const validationService = new ValidationService(previewDir, serverDir);

// In callback:
if (toolName === 'submit_work' && event.success) {
  const result = await validationService.validateAndPreparePreview(messageId);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.errors.map(e => e.message).join(', ')}`);
  }
}
```

**Validation:**
- [ ] TypeScript compilation passes
- [ ] ESLint passes
- [ ] Manual test: Trigger `submit_work` tool, verify validation runs
- [ ] Verify status messages still broadcast correctly

---

### Step 1.3: Refactor tool-executor.ts to Use ValidationService

**Modify:** `apps/server/src/llm/tool-executor.ts`

**Changes:**
1. Import `ValidationService` from new module
2. Replace inline `handleValidationAndPreview()` function with service call
3. Keep existing `statusBroadcaster` calls
4. Update error handling

**Validation:**
- [ ] TypeScript compilation passes
- [ ] ESLint passes
- [ ] `npm run test` passes
- [ ] Manual test: Trigger tool execution via legacy WebSocket, verify validation runs
- [ ] Grep for duplicate function names - should only find imports

---

## Phase 2: Restructure Directories

### Step 2.1: Create New Directory Structure

**Create:**
- `apps/server/src/transport/ws/`
- `apps/server/src/features/status/`

**Validation:**
- [ ] Directories created
- [ ] Update `tsconfig.json` paths if needed (check `baseUrl` and `paths`)

---

### Step 2.2: Move and Rename WebSocketHandler

**Move:** `apps/server/src/ws/ws.ts` → `apps/server/src/transport/ws/WebSocketHandler.ts`

**Changes:**
1. Rename class file to match class name
2. Update import in `apps/server/src/server.ts`:
   ```typescript
   // Before
   import { WebSocketHandler } from './ws/ws.js';
   
   // After
   import { WebSocketHandler } from './transport/ws/WebSocketHandler.js';
   ```
3. Keep all existing functionality intact (connections, sessions, rate limiting)

**Validation:**
- [ ] `npm run build` compiles
- [ ] Server starts successfully
- [ ] WebSocket connections work (manual test with browser DevTools)
- [ ] Rate limiting still functions
- [ ] Session management works (multiple connections per session)

---

### Step 2.3: Move and Rename Status Files

**Move:**
- `apps/server/src/websocket/types.ts` → `apps/server/src/features/status/types.ts`
- `apps/server/src/websocket/status-broadcaster.ts` → `apps/server/src/features/status/StatusBroadcaster.ts`
- `apps/server/src/websocket/handler.ts` → **DELETE** (unused)

**Changes:**
1. Convert `statusBroadcaster` to named export singleton:
   ```typescript
   // StatusBroadcaster.ts
   export class StatusBroadcaster { ... }
   export const statusBroadcaster = new StatusBroadcaster();
   ```
2. Update all imports:
   - `apps/server/src/llm/agent.ts`
   - `apps/server/src/llm/tool-executor.ts`
   - `apps/server/src/websocket/handler.ts` (before deletion)

**Validation:**
- [ ] `npm run build` compiles
- [ ] All imports updated (grep for `from '../websocket/'` - should find nothing)
- [ ] `statusBroadcaster` still works in `agent.ts` and `tool-executor.ts`
- [ ] Manual test: Status messages still broadcast

---

## Phase 3: Create WebSocket Bridge

### Step 3.1: Create WebSocketBridge

**Create:** `apps/server/src/features/status/WebSocketBridge.ts`

**Purpose:** Bridge application-layer status events to WebSocket transport layer.

**Implementation:**

```typescript
import { StatusBroadcaster, StatusMessage } from './StatusBroadcaster.js';
import { WebSocketHandler } from '../../transport/ws/WebSocketHandler.js';

export class WebSocketBridge {
  constructor(
    private broadcaster: StatusBroadcaster,
    private wsHandler: WebSocketHandler
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    // Subscribe to all status events from broadcaster
    // When received, forward to WebSocketHandler.broadcastToSession()
    // Need to extract messageId from status to determine sessionId
  }

  public broadcastStatus(sessionId: string, status: StatusMessage): void {
    this.wsHandler.broadcastToSession(sessionId, {
      type: 'status',
      ...status,
    });
  }
}
```

**Key Design Decisions:**
- Bridge subscribes to `StatusBroadcaster` events
- Bridge calls `WebSocketHandler.broadcastToSession()` to send via WebSocket
- Need mapping from `messageId` to `sessionId` (may need to add to `StatusMessage` or track separately)

**Validation:**
- [ ] TypeScript compilation passes
- [ ] ESLint passes
- [ ] Unit tests for bridge (mock `StatusBroadcaster` + `WebSocketHandler`)
- [ ] Test verifies events flow through bridge

---

### Step 3.2: Wire Up Bridge in Server

**Modify:** `apps/server/src/server.ts`

**Changes:**

```typescript
// Before
import { WebSocketHandler } from './ws/ws.js';
const wsHandler = new WebSocketHandler(server);

// After
import { WebSocketHandler } from './transport/ws/WebSocketHandler.js';
import { statusBroadcaster } from './features/status/StatusBroadcaster.js';
import { WebSocketBridge } from './features/status/WebSocketBridge.js';

const wsHandler = new WebSocketHandler(server);
new WebSocketBridge(statusBroadcaster, wsHandler);
```

**Validation:**
- [ ] Server starts without errors
- [ ] Status events flow through bridge
- [ ] Manual test: Trigger tool execution, verify status sent via WebSocket
- [ ] Use browser DevTools to inspect WebSocket frames

---

### Step 3.3: Add Status Message Type to Protocol

**Modify:** `apps/server/src/features/status/types.ts`

Add WebSocket protocol message type:

```typescript
export interface WebSocketStatusMessage {
  type: 'status';
  status: StatusType;
  messageId: string;
  tool?: string;
  details: string;
  timestamp: number;
}

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
```

**Modify:** `apps/server/src/transport/ws/WebSocketHandler.ts`

Add `broadcastStatus()` method:

```typescript
public broadcastStatus(sessionId: string, status: StatusMessage): void {
  const connections = this.connections.get(sessionId) || [];
  connections.forEach(conn => {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({
        type: 'status',
        ...status,
      }));
    }
  });
}
```

**Validation:**
- [ ] TypeScript compilation passes
- [ ] Manual test: Inspect WebSocket frames, verify `status` messages
- [ ] Verify all status types are sent correctly

---

## Phase 4: Create Mock Provider

### Step 4.1: Create Mock Provider

**Create:** `apps/server/src/llm/providers/mock.ts`

**Purpose:** Deterministic LLM provider for E2E testing.

**Implementation:**

```typescript
import { IProvider, IProviderConfig, Message, CompletionOptions } from '../types.js';

export class MockProvider implements IProvider {
  static name(): string { return 'mock'; }
  static displayName(): string { return 'Mock Provider'; }
  static requiresApiKey(): boolean { return false; }

  private config: IProviderConfig = {};

  async complete(
    messages: Message[],
    options: CompletionOptions
  ): Promise<{ stream: AsyncIterable<string>; toolCalls?: ToolCall[] }> {
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage.content;

    // Deterministic responses based on prompt patterns
    if (prompt.includes('create file') || prompt.includes('create_file')) {
      return {
        stream: this.generateChunks('I will create a file for you.'),
        toolCalls: [{
          toolCallId: 'mock-tool-1',
          toolName: 'create_file',
          args: { filename: 'test.tsx', code: 'export default function Test() { return <div>Hello</div>; }' },
        }],
      };
    }

    // Default response
    return {
      stream: this.generateChunks('This is a mock response from the MockProvider.'),
    };
  }

  async listModels(): Promise<string[]> {
    return ['mock-model'];
  }

  saveConfig(config: IProviderConfig): void {
    this.config = config;
  }

  loadConfig(): IProviderConfig {
    return this.config;
  }

  hasApiKey(): boolean {
    return false;
  }

  private async *generateChunks(text: string): AsyncIterable<string> {
    const words = text.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}
```

**Features:**
- Deterministic text responses for known prompts
- Configurable tool call responses
- No external API calls
- Works offline
- Simulates streaming with delays

**Validation:**
- [ ] TypeScript compilation passes
- [ ] Unit tests for mock responses (create `mock.test.ts`)
- [ ] Test verifies deterministic output
- [ ] Test verifies tool call generation

---

### Step 4.2: Add Mock Provider to Provider Router

**Modify:** `apps/server/src/trpc/routers/providers.ts`

**Changes:**

```typescript
import { MockProvider } from '../../llm/providers/mock.js';

const providers: IProviderClass[] = [QwenProvider, MistralProvider, MockProvider];
```

**Validation:**
- [ ] Provider appears in `/trpc/providers.list` response
- [ ] Can switch to mock provider via `/trpc/providers.updateConfig`
- [ ] Manual test: Select mock provider in UI (if exposed)

---

### Step 4.3: Add Environment Variable for Mock Provider

**Modify:** `apps/server/.env.example`

**Add:**

```bash
# Mock Provider (development only - do not enable in production)
ENABLE_MOCK_PROVIDER=true
```

**Modify:** `apps/server/src/trpc/routers/providers.ts`

Add guard:

```typescript
const providers: IProviderClass[] = [
  QwenProvider,
  MistralProvider,
  ...(process.env.ENABLE_MOCK_PROVIDER === 'true' ? [MockProvider] : []),
];
```

**Validation:**
- [ ] Mock provider only enabled when env var is set
- [ ] Production builds exclude mock provider by default
- [ ] Server starts with and without mock provider

---

## Phase 5: Client-Side Integration

### Step 5.1: Add Status Message Handling to Client WebSocket

**Modify:** `apps/web/src/api/websocket.ts`

**Changes:**

```typescript
// Add to WebSocketMessage interface
export interface WebSocketMessage {
  type: 'message' | 'status' | 'content' | 'done' | 'ack' | 'error' | 'history' | 'pong';
  status?: StatusType;
  tool?: string;
  details?: string;
  timestamp?: number;
  // ... existing fields
}

// Add callback to SessionWebSocket class
export class SessionWebSocket {
  onStatus?: (status: StatusMessage) => void;

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(event.data) as WebSocketMessage;

    switch (data.type) {
      // ... existing cases
      case 'status':
        this.onStatus?.(data as StatusMessage);
        break;
    }
  }
}
```

**Import Status Types:**

```typescript
import type { StatusType } from '@server/features/status/types';
// Or define locally in apps/web/src/types/status.ts
```

**Validation:**
- [ ] `npm run build` in `apps/web` compiles
- [ ] ESLint passes
- [ ] TypeScript types are correct
- [ ] Manual test: Browser console shows status messages received

---

### Step 5.2: Update useMessageListState Hook

**Modify:** `apps/web/src/hooks/useMessageListState.ts`

**Changes:**

```typescript
export interface MessageListState {
  messages: DisplayMessage[];
  currentStatus: StatusMessage | null;  // NEW
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  // ...
}

// In useEffect where WebSocket handlers are set:
instance.ws.onStatus = (status) => {
  instance!.currentStatus = status;
  instance!.subscribers.forEach(fn => fn());
};

// Return in hook:
return {
  messages: state.messages,
  currentStatus: state.currentStatus,  // NEW
  isConnected: state.isConnected,
  isStreaming: state.isStreaming,
  error: state.error,
  sendMessage,
  reconnect,
  clearError,
};
```

**Validation:**
- [ ] TypeScript compilation passes
- [ ] ESLint passes
- [ ] Manual test: Status updates visible in React DevTools
- [ ] Status clears when generation completes

---

### Step 5.3: Integrate StatusMessage Component

**Create:** `apps/web/src/components/status/StatusDisplay.tsx`

```tsx
import { Box, Collapse } from '@mui/material';
import { useMessageListState } from '../../hooks/useMessageListState';
import StatusMessage from './StatusMessage';

interface StatusDisplayProps {
  sessionId: string | null;
}

export function StatusDisplay({ sessionId }: StatusDisplayProps) {
  const { currentStatus } = useMessageListState(sessionId);

  if (!currentStatus) {
    return null;
  }

  return (
    <Box sx={{ p: 1, bgcolor: 'action.hover' }}>
      <StatusMessage
        status={currentStatus.status}
        tool={currentStatus.tool}
        details={currentStatus.details}
        timestamp={currentStatus.timestamp}
      />
    </Box>
  );
}
```

**Integrate:** Add to `apps/web/src/pages/ChatPage.tsx` or `MessageList.tsx`:

```tsx
// ChatPage.tsx
<ChatContainer>
  <SessionSelector />
  <ConnectionStatus />
  <StatusDisplay sessionId={currentSessionId} />  {/* NEW */}
  <MessageList />
  <PromptInput />
</ChatContainer>
```

**Validation:**
- [ ] Component renders during tool execution
- [ ] Status updates in real-time (watch status change)
- [ ] Status clears when generation completes
- [ ] Visual styling matches design system

---

## Phase 6: E2E Testing with Mock Provider

### Step 6.1: Create Mock Provider E2E Fixture

**Modify:** `tests/e2e/fixtures/test-fixtures.ts`

**Add:**

```typescript
type TestFixtures = {
  authenticatedPage: Page;
  createSession: () => Promise<void>;
  useMockProvider: () => Promise<void>;  // NEW
};

export const test = base.extend<TestFixtures>({
  // ... existing fixtures

  useMockProvider: async ({ page }, use) => {
    // Switch to mock provider via tRPC or localStorage
    await page.evaluate(() => {
      localStorage.setItem('cycledesign:provider', 'mock');
    });

    // Reload to apply provider change
    await page.reload();
    await page.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    await use();
  },
});
```

**Validation:**
- [ ] Fixture compiles
- [ ] Manual test: Fixture switches to mock provider
- [ ] Verify provider change in UI or via API

---

### Step 6.2: Write Deterministic Chat Flow E2E Test

**Create:** `tests/e2e/tests/chat-mock.spec.ts`

```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Chat Flow with Mock Provider', () => {
  test('should complete full chat flow with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    await useMockProvider();
    await createSession();

    const testMessage = 'Create a hello world app';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify user message appears
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText(testMessage);

    // Verify input is cleared
    await expect(promptInput).toHaveValue('');

    // Verify mock response appears (deterministic)
    await expect(chatPanel).toContainText('This is a mock response');

    // Verify input is re-enabled after response
    await expect(promptInput).toBeEnabled();
  });

  test('should trigger tool calls with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify tool call status appears
    await expect(authenticatedPage.getByText('create_file')).toBeVisible();

    // Verify file creation status
    await expect(authenticatedPage.getByText('test.tsx')).toBeVisible();
  });
});
```

**Validation:**
- [ ] `npm run test:e2e` passes
- [ ] Test is deterministic (runs multiple times with same result)
- [ ] No flaky timing-dependent assertions
- [ ] Runs in CI environment

---

### Step 6.3: Write Status Message E2E Test

**Create:** `tests/e2e/tests/status-messages.spec.ts`

```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Status Messages', () => {
  test('should broadcast status messages during tool execution', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify status messages appear in expected order
    // Note: May need to add data-testid to StatusMessage component

    // 1. Generation start
    // await expect(page.getByTestId('status-generation_start')).toBeVisible();

    // 2. Tool call start
    // await expect(page.getByTestId('status-tool_call_start')).toContainText('create_file');

    // 3. Tool call complete
    // await expect(page.getByTestId('status-tool_call_complete')).toBeVisible();

    // 4. Validation start
    // await expect(page.getByTestId('status-validation_start')).toBeVisible();

    // 5. Validation complete
    // await expect(page.getByTestId('status-validation_complete')).toBeVisible();

    // 6. Generation complete
    // await expect(page.getByTestId('status-generation_complete')).toBeVisible();
  });

  test('should show error status for failed tool calls', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Test error status display
    // May need to configure mock provider to fail specific tool calls
  });
});
```

**Note:** May need to add `data-testid` attributes to `StatusMessage` component for reliable selectors.

**Validation:**
- [ ] All status messages verified
- [ ] Test passes consistently (no flakiness)
- [ ] Order of status messages is correct
- [ ] Error states are tested

---

## Phase 7: Cleanup and Documentation

### Step 7.1: Remove Old Directories

**Delete:**
- `apps/server/src/ws/` (after successful move to `transport/ws/`)
- `apps/server/src/websocket/` (after successful move to `features/status/`)

**Validation:**
- [ ] No remaining imports from old paths:
  ```bash
  grep -r "from './ws'" apps/server/src/
  grep -r "from '../websocket'" apps/server/src/
  ```
- [ ] `npm run build` compiles
- [ ] `npm run lint` passes
- [ ] Manual test: Full flow works end-to-end

---

### Step 7.2: Update Documentation

**Modify:** `docs/TOOL_CALLING.md`

**Add Sections:**

1. **Architecture Overview**
   - Directory structure diagram
   - Responsibility boundaries
   - Data flow diagram

2. **Status Message Protocol**
   - All status types and when they're sent
   - WebSocket message format
   - Client-side handling

3. **Mock Provider Usage**
   - How to enable for development
   - Configuring mock responses
   - Writing tests with mock provider

4. **Testing Guide**
   - Running E2E tests
   - Writing deterministic tests
   - Debugging test failures

**Validation:**
- [ ] All referenced files exist
- [ ] Code examples compile
- [ ] Architecture diagram updated
- [ ] Links are correct

---

## Implementation Order

```
Phase 1: Deduplicate Validation (Steps 1.1-1.3)
├─ 1.1 Extract ValidationService
├─ 1.2 Refactor agent.ts
└─ 1.3 Refactor tool-executor.ts

Phase 2: Restructure Directories (Steps 2.1-2.3)
├─ 2.1 Create new directories
├─ 2.2 Move WebSocketHandler
└─ 2.3 Move status files + delete handler.ts

Phase 3: Create WebSocket Bridge (Steps 3.1-3.3)
├─ 3.1 Create WebSocketBridge
├─ 3.2 Wire up in server.ts
└─ 3.3 Add status message type

Phase 4: Create Mock Provider (Steps 4.1-4.3)
├─ 4.1 Create MockProvider class
├─ 4.2 Register in provider router
└─ 4.3 Add environment variable

Phase 5: Client-Side Integration (Steps 5.1-5.3)
├─ 5.1 Add status handling to client WebSocket
├─ 5.2 Update useMessageListState hook
└─ 5.3 Integrate StatusMessage component

Phase 6: E2E Testing (Steps 6.1-6.3)
├─ 6.1 Create mock provider fixture
├─ 6.2 Write deterministic chat flow test
└─ 6.3 Write status message tests

Phase 7: Cleanup (Steps 7.1-7.2)
├─ 7.1 Remove old directories
└─ 7.2 Update documentation
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking changes to WebSocket protocol | Keep legacy handler functional during migration; add new status type alongside existing types |
| Regression in tool execution | Run full E2E suite after each phase; keep old `streamLLM()` method commented until Phase 7 |
| Client-server type mismatch | Share types between server/client or duplicate with validation tests |
| Mock provider doesn't match real behavior | Document limitations; use mock only for flow testing, not response validation |
| Bridge loses status messages | Add logging; implement acknowledgment mechanism |

---

## Rollback Plan

If migration encounters critical issues:

1. **Phase 1-3:** Revert directory moves, keep both implementations
2. **Phase 4:** Mock provider is additive - no rollback needed
3. **Phase 5:** Client changes are backward compatible
4. **Phase 6:** Tests are additive - no rollback needed

**Rollback Command:**
```bash
git revert <commit-hash>
# Or restore from backup
```

---

## Success Criteria

- [ ] **Architecture:**
  - Clear separation: `transport/` vs `features/`
  - No duplicate validation logic
  - Single source of truth for status broadcasting

- [ ] **Functionality:**
  - Status messages flow end-to-end (server → client)
  - StatusMessage component displays real-time updates
  - Tool execution works correctly

- [ ] **Testing:**
  - Mock provider enables deterministic E2E tests
  - All existing tests pass
  - New E2E tests pass consistently (>10 runs without flakiness)

- [ ] **Documentation:**
  - Architecture documented in `docs/`
  - Status message protocol documented
  - Mock provider usage guide complete

- [ ] **Code Quality:**
  - `npm run build` passes for all apps
  - `npm run lint` passes with no new errors
  - `npm run test` passes (unit tests)
  - `npm run test:e2e` passes (E2E tests)

---

## Appendix A: Current File Locations

### Before Migration

```
apps/server/src/
├── ws/
│   └── ws.ts                    # WebSocketHandler class
├── websocket/
│   ├── types.ts                 # StatusMessage, StatusType
│   ├── status-broadcaster.ts    # StatusBroadcaster class
│   └── handler.ts               # handleWebSocketConnection (unused)
├── llm/
│   ├── agent.ts                 # ToolLoopAgent + handleValidationAndPreview()
│   └── tool-executor.ts         # executeToolCalls + handleValidationAndPreview()
└── validation/
    └── pipeline.ts              # ValidationPipeline
```

### After Migration

```
apps/server/src/
├── transport/
│   └── ws/
│       └── WebSocketHandler.ts  # WebSocketHandler class
├── features/
│   └── status/
│       ├── types.ts             # StatusMessage, StatusType
│       ├── StatusBroadcaster.ts # StatusBroadcaster class
│       └── WebSocketBridge.ts   # NEW: Bridge class
├── llm/
│   ├── agent.ts                 # ToolLoopAgent (uses ValidationService)
│   ├── tool-executor.ts         # executeToolCalls (uses ValidationService)
│   └── providers/
│       ├── mock.ts              # NEW: MockProvider
│       └── ...
└── validation/
    ├── validation-service.ts    # NEW: ValidationService
    └── pipeline.ts
```

---

## Appendix B: Status Message Types

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
| `validation_error` | Validation failed | `messageId, details` |
| `preview_start` | Starting preview server | `messageId, details` |
| `preview_ready` | Preview server running | `messageId, details, port` |
| `preview_error` | Preview failed to start | `messageId, details` |

---

## Appendix C: WebSocket Message Protocol

### Client → Server

```typescript
{
  type: 'message';
  id: string;      // Client-generated message ID
  content: string; // User prompt
  timestamp: number;
}

{
  type: 'ping';
}
```

### Server → Client

```typescript
{
  type: 'connected';
  sessionId: string;
}

{
  type: 'history';
  messages: Message[];
  timestamp: number;
}

{
  type: 'ack';
  messageId: string;   // Client message ID
  serverId: string;    // Server-generated message ID
  timestamp: number;
}

{
  type: 'content';
  content: string;     // Streaming chunk or full response
  messageId?: string;
}

{
  type: 'status';
  status: StatusType;
  messageId: string;
  tool?: string;
  details: string;
  timestamp: number;
}

{
  type: 'done';
  messageId: string;
  timestamp: number;
}

{
  type: 'error';
  error: string;
}

{
  type: 'pong';
  timestamp: number;
}
```
