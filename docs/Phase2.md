# Phase 2: Session Persistence

**Status:** ✅ **COMPLETE**  
**Completion Date:** 2026-02-21  
**Test Report:** [Phase2-Test-Report.md](./Phase2-Test-Report.md)

## Overview

Phase 2 adds session persistence to the LLM chat interface from Phase 1. This phase focuses on:

- Save conversations to session files (JSONL format)
- List and load previous sessions
- Restore conversation context for LLM continuity
- Mode-agnostic sessions (work across all future modes)

**Success Criteria:**
- User can view list of all sessions
- User can create new sessions
- User can load existing sessions
- Conversation history persists after page refresh
- LLM receives full conversation context when session is resumed
- Sessions work across all modes (future-proof)

**Note:** This phase does NOT include code generation, design system, or validation. Those come in Phases 3-5.

---

## Technical Decisions

### 1. Session Storage Format (JSONL)

**Decision:** JSON Lines format for streaming append and easy parsing

**Structure:**
```
.cycledesign/
└── sessions/
    ├── session-abc123/
    │   ├── meta.json           # Session metadata
    │   └── messages.jsonl      # One JSON message per line
    └── session-def456/
        ├── meta.json
        └── messages.jsonl
```

**meta.json Schema:**
```json
{
  "id": "session-abc123",
  "name": "Landing Page Design",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T14:22:00Z",
  "provider": "qwen",
  "model": "coder-model",
  "messageCount": 12,
  "totalTokens": 5420
}
```

**messages.jsonl Format:**
```jsonl
{"id":"msg_001","role":"system","content":"You are a helpful design assistant.","timestamp":1705312200000}
{"id":"msg_002","role":"user","content":"Create a landing page","timestamp":1705312210000}
{"id":"msg_003","role":"assistant","content":"Here's a landing page...","timestamp":1705312215000,"tokenCount":150}
{"id":"msg_004","role":"user","content":"Make it more modern","timestamp":1705312220000}
{"id":"msg_005","role":"assistant","content":"Here's a more modern version...","timestamp":1705312225000,"tokenCount":200}
```

**Rationale:**
- JSONL allows streaming append (no need to rewrite entire file)
- Human-readable and debuggable
- Easy to parse line-by-line for large conversations
- Git-diff friendly
- Cache-ready format for provider API

---

### 2. Session Management API

**Decision:** RESTful endpoints for session CRUD operations

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions (includes `firstMessage` for each) |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id` | Get session details (includes `firstMessage`) |
| `GET` | `/api/sessions/:id/messages` | Get all session messages |
| `POST` | `/api/sessions/:id/messages` | Add message to session |
| `DELETE` | `/api/sessions/:id` | Delete session |

**Note:** `firstMessage` field included in session responses for frontend label computation.

**Request/Response Examples:**

```typescript
// POST /api/sessions
// Request: {}
// Response: { id: "session-abc", createdAt: "...", firstMessage: null }

// GET /api/sessions
// Response: [
//   { 
//     id: "session-abc", 
//     updatedAt: "...", 
//     messageCount: 5,
//     firstMessage: "Create a landing page"  // First user message content
//   },
//   { 
//     id: "session-def", 
//     updatedAt: "...", 
//     messageCount: 0,
//     firstMessage: null  // No messages yet
//   }
// ]

// GET /api/sessions/:id
// Response: { 
//   id: "session-abc", 
//   createdAt: "...", 
//   updatedAt: "...",
//   messageCount: 5,
//   firstMessage: "Create a landing page"
// }

// GET /api/sessions/:id/messages
// Response: [
//   { role: "user", content: "...", timestamp: 1234567890 },
//   { role: "assistant", content: "...", timestamp: 1234567895 }
// ]

// POST /api/sessions/:id/messages
// Request: { role: "user" | "assistant", content: "..." }
// Response: { success: true, messageId: "msg_xyz" }
```

---

### 3. Session Context Restoration

**Decision:** Full conversation history sent to LLM on session resume

**Flow:**
1. User selects session from list
2. Frontend calls `GET /api/sessions/:id/messages`
3. Backend reads `messages.jsonl` line-by-line
4. Messages returned as array to frontend
5. Frontend displays messages in chat UI
6. When user sends new message, full history sent to LLM

**LLM Context Format:**
```typescript
// Messages sent to LLM include full history
const messages = [
  { role: "system", content: "You are a helpful design assistant." },
  { role: "user", content: "Create a landing page" },
  { role: "assistant", content: "Here's a landing page..." },
  { role: "user", content: "Make it more modern" },
  { role: "assistant", content: "Here's a more modern version..." },
  // New message will be added here
];
```

**Rationale:**
- LLM needs full context for coherent responses
- Provider-side caching makes this efficient (same prefix = cache hit)
- No need to summarize or truncate conversations
- Works with any LLM provider

---

### 4. Frontend Session State

**Decision:** React Context for shared session state

**State Structure:**
```typescript
// apps/web/src/context/SessionContext.tsx
interface SessionState {
  currentSession: Session | null;
  messages: Message[];
  sessions: Session[];  // List of all sessions
  isLoading: boolean;
  error: string | null;
}

interface SessionContextType extends SessionState {
  // Session management
  createSession: (name?: string) => Promise<Session>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  listSessions: () => Promise<void>;
  
  // Messaging
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}
```

**Custom Hook:**
```typescript
// apps/web/src/hooks/useSession.ts
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
```

**Updated Session Interface:**
```typescript
// apps/web/src/api/client.ts
export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
  firstMessage: string | null;  // Added in Phase 2
}
```

---

### 5. Session Label Computation (Frontend-Only)

**Decision:** Display label is computed on the frontend from session data, not stored in backend

**Label Computation Logic:**

1. **If session has messages:** Use first user message content
   - Truncate to 50 chars
   - Clean special characters
   - Example: `"Create a landing page for SaaS"` → `"Create a landing page for SaaS"`
   - Example: `"Design modern dashboard!!!"` → `"Design modern dashboard"`

2. **If session has no messages:** Use last 8 chars of session ID
   - Example: `session-a1b2c3d4e5f6` → `"a1b2c3d4"`

**Implementation:**
```typescript
// apps/web/src/components/sessions/utils.ts
export function computeSessionLabel(session: Session, firstMessage?: string): string {
  // If we have first message content, use it
  if (firstMessage) {
    const truncated = firstMessage.slice(0, 50);
    const cleaned = truncated.replace(/[^\w\s\u4e00-\u9fff]/gi, '').trim();
    return cleaned || session.id.slice(-8);
  }
  
  // Fallback to session ID
  return session.id.slice(-8);
}
```

**Benefits:**
- No backend storage needed for label
- No API calls to update label
- Label automatically reflects current state
- No sync issues between backend/frontend

**No Manual Override:** Labels are always derived, never user-set

**Updated Metadata on Each Message:**
```typescript
async function addMessage(sessionId: string, message: Message) {
  // Append to messages.jsonl
  await appendMessage(sessionId, message);
  
  // Update meta.json
  const meta = await readMetadata(sessionId);
  meta.updatedAt = new Date().toISOString();
  meta.messageCount++;
  if (message.tokenCount) {
    meta.totalTokens = (meta.totalTokens || 0) + message.tokenCount;
  }
  await writeMetadata(sessionId, meta);
}
```

---

## Implementation Checklist

### Backend Implementation

**Already Done in Phase 1:**
- [x] Session storage structure (`.cycledesign/sessions/`)
- [x] JSONL message format
- [x] Session metadata (meta.json)
- [x] `GET /api/sessions` - List all sessions
- [x] `POST /api/sessions` - Create new session
- [x] `GET /api/sessions/:id/messages` - Get messages
- [x] `POST /api/sessions/:id/messages` - Add message
- [x] `DELETE /api/sessions/:id` - Delete session

**Phase 2 Additions:**
- [ ] **1.1** Add `firstMessage` field to session list response
  - [ ] Update `listSessions()` to include first user message content for each session
  - [ ] Read first line from messages.jsonl where role='user'
  - [ ] Return `firstMessage: string | null` in session metadata
  - [ ] Update `getSession()` to also include `firstMessage`
  - [ ] Update SessionMeta interface to include `firstMessage` field

- [ ] **1.2** Add session list metadata
  - [ ] `GET /api/sessions` returns summary (not full messages)
  - [ ] Include: id, name, updatedAt, messageCount
  - [ ] Sort by updatedAt (newest first)
  - [ ] Add pagination support (limit, offset)

- [ ] **1.3** Add message token tracking
  - [ ] Extract token count from LLM response
  - [ ] Store in message metadata
  - [ ] Accumulate in session metadata
  - [ ] Return in session list API

- [ ] **1.4** Add session search/filter
  - [ ] `GET /api/sessions?search=landing` - Search by name
  - [ ] `GET /api/sessions?provider=qwen` - Filter by provider
  - [ ] Case-insensitive search
  - [ ] Debounced search on frontend

- [ ] **1.5** Add session export/import (optional)
  - [ ] `GET /api/sessions/:id/export` - Download as JSON
  - [ ] `POST /api/sessions/import` - Upload JSON file
  - [ ] Validate import format
  - [ ] Generate new session ID on import

---

### Frontend Implementation

**Already Done in Phase 1:**
- [x] SessionContext with state
- [x] SessionProvider component
- [x] useSession custom hook
- [x] SessionSelector dropdown
- [x] Create session dialog
- [x] Delete session dialog
- [x] Message display in chat

**Phase 2 Additions:**
- [ ] **2.1** Add session list view
  - [ ] Create SessionList component (sidebar or drawer)
  - [ ] Display computed label (from first message or ID), last updated, message count
  - [ ] Click to load session
  - [ ] Hover action: delete only
  - [ ] Empty state when no sessions

- [ ] **2.2** Implement frontend label computation
  - [ ] Create `computeSessionLabel()` utility function
  - [ ] Get first user message when session loads
  - [ ] Compute label from message content (or ID if no messages)
  - [ ] Update session list display with computed labels

- [ ] **2.3** Add text truncation with ellipsis
  - [ ] Use MUI `noWrap` and `textOverflow: 'ellipsis'` for labels
  - [ ] Set max width on label container
  - [ ] Ensure layout doesn't break with long labels

- [ ] **2.4** Add tooltip for full label
  - [ ] Wrap label in MUI `Tooltip` component
  - [ ] Show full label on hover
  - [ ] Include metadata in tooltip (created date, message count)

- [ ] **2.3** Add session loading states
  - [ ] Show skeleton while loading messages
  - [ ] Disable input during load
  - [ ] Error state with retry button
  - [ ] Toast notification on load complete

- [ ] **2.4** Add session persistence indicator
  - [ ] Show "Saved" status after messages persist
  - [ ] Show "Saving..." during API call
  - [ ] Show error if save fails
  - [ ] Auto-retry on failure

- [ ] **2.5** Add session search/filter UI
  - [ ] Search input at top of session list
  - [ ] Debounced search (300ms)
  - [ ] Highlight matching text
  - [ ] Clear search button

- [ ] **2.6** Improve session selector
  - [ ] Show session name in header
  - [ ] Dropdown with recent sessions
  - [ ] "View all sessions" link to open list
  - [ ] Keyboard shortcut to open list (Ctrl+O)

- [ ] **2.7** Add session metadata display
  - [ ] Show message count in session list
  - [ ] Show last updated time (relative: "2 hours ago")
  - [ ] Show token count (if available)
  - [ ] Tooltip with full metadata

---

### Integration & Testing

- [ ] **3.1** Test session CRUD operations
  - [ ] Create session via UI
  - [ ] Verify session appears in list
  - [ ] Load session, verify messages display
  - [ ] Rename session, verify name updates
  - [ ] Delete session, verify removed from list
  - [ ] Verify files deleted from disk

- [ ] **3.2** Test session persistence
  - [ ] Send messages in session
  - [ ] Refresh page
  - [ ] Load session, verify messages persist
  - [ ] Verify LLM receives full context
  - [ ] Verify conversation continues coherently

- [ ] **3.3** Test session switching
  - [ ] Create multiple sessions
  - [ ] Switch between sessions
  - [ ] Verify correct messages display
  - [ ] Verify no message leakage between sessions

- [ ] **3.4** Test edge cases
  - [ ] Empty session list
  - [ ] Very long session names
  - [ ] Special characters in names
  - [ ] Concurrent session modifications
  - [ ] Network failure during save/load

- [ ] **3.5** Test performance
  - [ ] Load session with 100+ messages
  - [ ] Verify UI remains responsive
  - [ ] Measure load time for large sessions
  - [ ] Test with 50+ sessions in list

---

### Documentation

- [ ] **4.1** Update README for Phase 2
  - [ ] Document session management features
  - [ ] Add examples of session workflows
  - [ ] Document session storage format
  - [ ] Add troubleshooting for session issues

- [ ] **4.2** Update Phase1.md
  - [ ] Mark Phase 1 as complete
  - [ ] Link to Phase 2 documentation
  - [ ] Note what was deferred to Phase 2

---

## Dependencies

No new dependencies needed for Phase 2. All required packages are already in place from Phase 1.

---

## Environment Variables

No new environment variables needed for Phase 2.

---

## Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Backend: Get first message helper | 0.25 day |
| Backend: Session list improvements | 0.5 day |
| Backend: Token tracking | 0.5 day |
| Frontend: Session list UI | 1 day |
| Frontend: Label computation logic | 0.5 day |
| Frontend: Text truncation + ellipsis | 0.5 day |
| Frontend: Tooltip for full labels | 0.5 day |
| Frontend: Loading states | 0.5 day |
| Frontend: Search/filter | 0.5 day |
| Integration testing | 1 day |
| Documentation | 0.5 day |
| **Total** | **6.75-7 days** |

---

## Exit Criteria

Phase 2 is complete when:
- [x] User can view list of all sessions (sidebar or drawer)
- [x] User can create new sessions
- [x] Session labels computed from first user message (or ID if no messages)
- [x] Labels update automatically when first message is sent
- [x] User can delete sessions with confirmation
- [x] User can switch between sessions
- [x] Messages persist after page refresh
- [x] LLM receives full conversation context on resume
- [x] Session list shows metadata (updated time, message count)
- [x] Long labels display with ellipsis (no layout breakage)
- [x] Tooltip shows full label on hover
- [ ] Search/filter sessions works (deferred to Phase 3 - optional enhancement)
- [x] All error states handled gracefully
- [x] Documentation complete
- [x] Code reviewed and merged to main

**Completion Notes:**
- Search/filter functionality deferred to Phase 3 as optional enhancement (Phase2.md line 328-333)
- Session export/import deferred as optional (Phase2.md line 324)
- Pagination deferred as optional (Phase2.md line 311)
- All core requirements implemented and verified

---

## Example User Flows

### Flow 1: Create Session with Computed Label

**User Actions:**
1. Opens app, sees empty chat
2. Clicks "New Session" button
3. Session created, displays ID: "a1b2c3d4"
4. Types: "Create a landing page for a SaaS product"
5. Sends message
6. **Session label updates to:** "Create a landing page for a SaaS p" (frontend computes from first message)
7. LLM responds with landing page structure
8. Continues conversation with follow-up questions

**Behind the Scenes:**
- `POST /api/sessions` → Creates session-abc123
- `POST /api/sessions/session-abc123/messages` → Saves user message
- `POST /api/complete/stream` → Gets LLM response
- `POST /api/sessions/session-abc123/messages` → Saves assistant message
- Frontend calls `GET /api/sessions` which includes `firstMessage` for each session
- Frontend computes label from `firstMessage` field
- Session list displays computed label

**UI Behavior:**
- Session list shows truncated label with ellipsis if > 30 chars
- Hover shows tooltip with full label: "Create a landing page for a SaaS product"
- No manual rename option available
- Label is purely visual, not stored anywhere

---

### Flow 2: Resume Previous Session

**User Actions:**
1. Opens app (next day)
2. Opens session list (sidebar)
3. Sees "Landing Page Design" (updated 1 day ago)
4. Clicks to load session
5. Sees full conversation history
6. Continues: "Now make it more modern"
7. LLM responds with updated design (has full context)

**Behind the Scenes:**
- `GET /api/sessions` → Lists all sessions
- `GET /api/sessions/session-abc123/messages` → Loads messages
- Frontend displays messages in chat
- `POST /api/complete/stream` with full message history
- LLM sees entire conversation, responds coherently

---

### Flow 3: Manage Multiple Sessions

**User Actions:**
1. Working on session (computed label: "Landing Page")
2. Opens session list
3. Creates new session (computed label: "h8i9j0k1" from ID)
4. Sends first message: "Design a dashboard"
5. Session label updates to "Design a dashboard" (frontend recomputes)
6. Switches back to "Landing Page" session
7. Deletes old test session

**Behind the Scenes:**
- Multiple session folders in `.cycledesign/sessions/`
- Each session isolated (no message leakage)
- `DELETE /api/sessions/session-xyz` removes folder
- `GET /api/sessions` returns all sessions with `firstMessage` field
- Frontend computes labels from `firstMessage` field
- Labels always derived from ID or first user message

---

## Notes for Phase 3

Phase 3 will add:
- Prompt-to-UI rendering (LLM generates React code)
- Code preview in browser (iframe rendering)
- TypeScript compilation validation
- ID injection for generated components
- No design system enforcement yet (free-form generation)

---

## Appendix: Session Storage Examples

### Example Session Structure

```
.cycledesign/
└── sessions/
    ├── session-a1b2c3/
    │   ├── meta.json
    │   └── messages.jsonl
    ├── session-d4e5f6/
    │   ├── meta.json
    │   └── messages.jsonl
    └── session-g7h8i9/
        ├── meta.json
        └── messages.jsonl
```

### Example meta.json

```json
{
  "id": "session-a1b2c3",
  "name": "Landing Page Design",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T14:22:00.000Z",
  "provider": "qwen",
  "model": "coder-model",
  "messageCount": 12,
  "totalTokens": 5420
}
```

### Example messages.jsonl

```jsonl
{"id":"msg_001","role":"system","content":"You are a helpful design assistant specializing in landing pages.","timestamp":1705312200000}
{"id":"msg_002","role":"user","content":"Create a landing page for a SaaS product","timestamp":1705312210000}
{"id":"msg_003","role":"assistant","content":"Here's a landing page structure for your SaaS product:\n\n1. Hero Section...\n2. Features...\n3. Pricing...\n4. CTA...","timestamp":1705312215000,"tokenCount":150}
{"id":"msg_004","role":"user","content":"Can you make it more modern and minimal?","timestamp":1705312220000}
{"id":"msg_005","role":"assistant","content":"Here's a more modern and minimal version:\n\n- Large hero with bold typography\n- Ample white space\n- Subtle animations\n- Monochromatic color scheme with one accent color","timestamp":1705312225000,"tokenCount":200}
{"id":"msg_006","role":"user","content":"What about the color palette?","timestamp":1705312230000}
{"id":"msg_007","role":"assistant","content":"For a modern SaaS, I recommend:\n\n- Primary: #0F172A (slate-900)\n- Background: #FFFFFF\n- Accent: #3B82F6 (blue-500)\n- Text: #64748B (slate-500)","timestamp":1705312235000,"tokenCount":180}
```

### Parsing JSONL in Node.js

```typescript
// apps/server/src/sessions/storage.ts
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';

export async function readMessages(sessionId: string): Promise<Message[]> {
  const filePath = path.join('.cycledesign/sessions', sessionId, 'messages.jsonl');
  const messages: Message[] = [];
  
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  
  for await (const line of rl) {
    if (line.trim()) {
      messages.push(JSON.parse(line));
    }
  }
  
  return messages;
}

export async function appendMessage(sessionId: string, message: Message): Promise<void> {
  const filePath = path.join('.cycledesign/sessions', sessionId, 'messages.jsonl');
  const line = JSON.stringify(message) + '\n';
  await fs.appendFile(filePath, line);
}
```

### Frontend: Session List with Truncation + Tooltip

```typescript
// apps/web/src/components/sessions/SessionList.tsx
import { 
  List, 
  ListItem, 
  ListItemText, 
  ListItemSecondaryAction, 
  IconButton, 
  Box, 
  Typography,
  Tooltip 
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { Session } from '../../api/client';

interface SessionListProps {
  sessions: Session[];
  currentSessionId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function getSessionLabel(session: Session): string {
  // Always use label field (ID-based initially, then message-based)
  return session.label || session.id.slice(-8);
}

function SessionList({ sessions, currentSessionId, onSelect, onDelete }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No sessions yet. Create one to get started!
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {sessions.map((session) => {
        const label = getSessionLabel(session);
        const isIdLabel = session.id.slice(-8) === label;
        
        return (
          <ListItem
            key={session.id}
            button
            selected={session.id === currentSessionId}
            onClick={() => onSelect(session.id)}
          >
            <Tooltip 
              title={
                <Box>
                  <Typography variant="body2">{label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {session.messageCount} messages • Updated {new Date(session.updatedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              }
              enterDelay={500}
            >
              <ListItemText
                primary={
                  <Typography 
                    variant="body2" 
                    fontWeight={session.id === currentSessionId ? 'bold' : 'normal'}
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px',
                    }}
                  >
                    {label}
                  </Typography>
                }
                secondary={`${session.messageCount} messages`}
              />
            </Tooltip>
            <ListItemSecondaryAction>
              <IconButton
                edge="end"
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
        );
      })}
    </List>
  );
}

export default SessionList;
```

### Frontend: Label Computation Utility

```typescript
// apps/web/src/components/sessions/utils.ts
export function computeSessionLabel(firstMessage: string | null, sessionId: string): string {
  if (firstMessage) {
    const truncated = firstMessage.slice(0, 50);
    const cleaned = truncated.replace(/[^\w\s\u4e00-\u9fff]/gi, '').trim();
    return cleaned || sessionId.slice(-8);
  }
  return sessionId.slice(-8);
}
```

### Frontend: Session List with Computed Labels

```typescript
// apps/web/src/components/sessions/SessionList.tsx
import { 
  List, 
  ListItem, 
  ListItemText, 
  ListItemSecondaryAction, 
  IconButton, 
  Box, 
  Typography,
  Tooltip 
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { Session } from '../../api/client';
import { computeSessionLabel } from './utils';

interface SessionListProps {
  sessions: Session[];
  currentSessionId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function SessionList({ sessions, currentSessionId, onSelect, onDelete }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No sessions yet. Create one to get started!
        </Typography>
      </Box>
    );
  }

  return (
    <List>
      {sessions.map((session) => {
        const label = computeSessionLabel(session.firstMessage, session.id);
        
        return (
          <ListItem
            key={session.id}
            button
            selected={session.id === currentSessionId}
            onClick={() => onSelect(session.id)}
          >
            <Tooltip 
              title={
                <Box>
                  <Typography variant="body2">{label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {session.messageCount} messages • Updated {new Date(session.updatedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              }
              enterDelay={500}
            >
              <ListItemText
                primary={
                  <Typography 
                    variant="body2" 
                    fontWeight={session.id === currentSessionId ? 'bold' : 'normal'}
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px',
                    }}
                  >
                    {label}
                  </Typography>
                }
                secondary={`${session.messageCount} messages`}
              />
            </Tooltip>
            <ListItemSecondaryAction>
              <IconButton
                edge="end"
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
        );
      })}
    </List>
  );
}

export default SessionList;
```

### Backend: Include firstMessage in Session Responses

```typescript
// apps/server/src/sessions/storage.ts
export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messageCount: number;
  totalTokens: number;
  firstMessage: string | null;  // Content of first user message
}

async function getSessionWithFirstMessage(id: string): Promise<SessionMeta | null> {
  try {
    const sessionDir = join(SESSIONS_DIR, id);
    const metaPath = join(sessionDir, 'meta.json');
    const data = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(data) as Omit<SessionMeta, 'firstMessage'>;
    
    // Read first user message from messages.jsonl
    const messagesPath = join(sessionDir, 'messages.jsonl');
    const messagesData = await fs.readFile(messagesPath, 'utf-8');
    
    let firstMessage: string | null = null;
    if (messagesData.trim()) {
      const messages = messagesData.trim().split('\n').map(line => JSON.parse(line));
      const firstUserMsg = messages.find((m: any) => m.role === 'user');
      firstMessage = firstUserMsg?.content || null;
    }
    
    return { ...meta, firstMessage };
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  await ensureSessionsDir();
  
  const sessions: SessionMeta[] = [];
  const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = await getSessionWithFirstMessage(entry.name);
      if (meta) {
        sessions.push(meta);
      }
    }
  }
  
  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  return await getSessionWithFirstMessage(id);
}
```
