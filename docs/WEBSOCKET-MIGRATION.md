# Channel Transport Migration Plan

**Status:** In Progress (Q2 2026)
**Created:** March 14, 2026
**Last Updated:** March 15, 2026

**Source of Truth:** See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) for complete channel specification.

---

## Overview

This document describes the migration from the current **WebSocket-based transport** to a **type-safe channel transport** system.

**Current State:** WebSocket transport with raw message handling
**Target State:** Channel-based transport with compile-time type safety
**Timeline:** Q2 2026

---

## Current Architecture Status

The following foundational work is complete:

- [x] Deduplicate validation logic (ValidationService created)
- [x] Restructure directories (transport/, features/, validation/)
- [x] WebSocket Bridge for status messages
- [x] Mock LLM provider for E2E testing
- [x] Client-side status message integration
- [x] E2E test infrastructure

**Next:** Migrate from WebSocket transport to channel-based transport (see phases below).

---

## Channel Migration Phases

### Phase 1: Implement Protocol Layer

**Goal:** Create `ProtocolServer` and `ProtocolClient` classes

**Tasks:**
- [ ] Create `apps/common/protocol/src/types.ts` with `ChannelTypes` interface
- [ ] Implement `ProtocolServer` class with `onChannelSubscribe()` method
- [ ] Implement `ProtocolClient` class with `channel()` method
- [ ] Implement message serialization/deserialization
- [ ] Implement server-side channel instance management
- [ ] Implement client-side auto-connect/disconnect
- [ ] Create mock channel types for E2E testing

**Files to Create:**
- `apps/common/protocol/package.json` (workspace package: `@cycledesign/common-protocol`)
- `apps/common/protocol/src/types.ts`
- `apps/common/protocol/src/server/ProtocolServer.ts`
- `apps/common/protocol/src/client/ProtocolClient.ts`
- `apps/common/protocol/src/utils/serialization.ts`

**Acceptance Criteria:**
- TypeScript compilation passes
- Unit tests for ProtocolServer and ProtocolClient
- No changes to existing WebSocket code

**Reference:** [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) sections:
- "Type Definitions"
- "Server API"
- "Client API"
- "Implementation Details"

---

### Phase 2: Migrate Status Messages to Channels

**Goal:** Move `status` channel to channel transport

**Tasks:**
- [ ] Add `status` to `ChannelTypes` interface (server-to-client only)
- [ ] Migrate `StatusMessage` type to `apps/common/protocol/src/types.ts`
- [ ] Update `StatusBroadcaster` to use `ProtocolServer` (becomes application service)
- [ ] Create `useChannelSubscription()` generic React hook for client-side broadcasting
- [ ] Update client `StatusDisplay` component to use `ProtocolClient` + hook
- [ ] Remove `WebSocketBridge` status routing

**Files to Create:**
- `apps/web/src/hooks/useChannelSubscription.ts` (generic hook for channel subscriptions)

**Files to Modify:**
- `apps/common/protocol/src/types.ts` (add `status` channel type)
- `apps/server/src/features/status/StatusBroadcaster.ts` (convert to application service)
- `apps/web/src/components/status/StatusDisplay.tsx`

**Files to Delete:**
- `apps/server/src/features/status/WebSocketBridge.ts` (no longer needed)

**Acceptance Criteria:**
- Status messages flow through channel transport
- Status is fire-and-forget (no history replay)
- E2E tests pass for status channel
- TypeScript compilation passes with no errors

**Reference:** [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) "Examples: Status Updates"

---

### Phase 3: Migrate Chat Messages to Channels

**Goal:** Move `chat` channel to channel transport

**Tasks:**
- [ ] Add `chat` to `ChannelTypes` interface
- [ ] Migrate chat message types to `apps/common/protocol/src/types.ts`
- [ ] Create `ChatRoom` application service (pure, no transport knowledge)
- [ ] Update server to use `onChannelSubscribe('chat', ...)`
- [ ] Update client to use `client.channel('chat')`
- [ ] Migrate message history loading

**Files to Create:**
- `apps/server/src/features/chat/ChatRoom.ts`

**Files to Modify:**
- `apps/common/protocol/src/types.ts` (add `chat` channel type)
- `apps/server/src/llm/agent.ts`
- `apps/web/src/api/websocket.ts` (or replace entirely)
- `apps/web/src/hooks/useMessageListState.ts`
- `apps/web/src/pages/ChatPage.tsx`

**Acceptance Criteria:**
- Chat messages flow through channel transport
- Type-safe message payloads
- E2E tests pass for chat channel
- Client and server migrated together (end-to-end verification)

**Reference:** [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) "Examples: Chat Channel"

---

### Phase 4: Remove WebSocket Protocol Layer

**Goal:** Remove legacy WebSocket transport

**Tasks:**
- [ ] Remove WebSocket message handling code
- [ ] Remove `SessionWebSocket` class from client
- [ ] Remove WebSocket-specific types
- [ ] Clean up unused dependencies

**Files to Delete:**
- `apps/server/src/transport/ws/WebSocketHandler.ts`
- `apps/web/src/api/websocket.ts` (if fully replaced)

**Acceptance Criteria:**
- All functionality works via channel transport
- No references to legacy WebSocket API
- `npm run build` passes for all apps
- `npm run test:e2e` passes

---

## Migration Benefits

| Benefit | Description |
|---------|-------------|
| **Type Safety** | All events and payloads enforced at compile-time |
| **Per-Session Channels** | Independent channel instances per client subscription |
| **Pure Application Services** | Application logic has no transport knowledge |
| **Closure-Based State** | Handlers capture state via closures |
| **No Race Conditions** | Server-side queuing eliminates subscribe-ack needs |
| **Simpler Client API** | Auto-connect, no manual reconnection logic |
| **Better Developer Experience** | IDE autocomplete, type errors caught early |

---

## Architecture Comparison

### Current (WebSocket)

```
User Message (WebSocket)
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │
│  (raw message parsing)  │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  ToolLoopAgent          │
│  (manual routing)       │
└─────────────────────────┘
```

### Target (Channels)

```
Client channel.publish()
         ↓
┌─────────────────────────┐
│  ProtocolClient         │
│  (type-safe channel)    │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  ProtocolServer         │
│  (route to channel)     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  onChannelSubscribe     │
│  (type-enforced)        │
└─────────────────────────┘
```

---

## Historical Context

For details on the previous WebSocket architecture migration (Phases 1-7, completed March 2026), see [WEBSOCKET_PROTOCOL.md](./WEBSOCKET_PROTOCOL.md) Appendix B: "WebSocket Migration History".

---

## Appendix A: Key Differences

| Aspect | Current (WebSocket) | Target (Channels) |
|--------|---------------------|-------------------|
| **Abstraction** | Raw WebSocket messages | Type-safe channel instances |
| **Type Safety** | Runtime validation | Compile-time enforcement (TODO: add Zod) |
| **Event Direction** | Bidirectional (untyped) | Separated client→server and server→client |
| **Session Management** | sessionId in URL query | Per-channel instances, auto-managed |
| **Message Format** | `{ type, content, ... }` | `TransportEnvelope` with channelId |
| **Handler Registration** | Callback-based | `registerHandlers()` - type-enforced |
| **Reconnection** | Exponential backoff | Not supported (create new client) |

---

## Appendix B: Implementation Order

```
Phase 1: Implement Protocol Layer
├─ Create apps/common/protocol/ package
├─ Create ProtocolServer and ProtocolClient
├─ Implement type-safe channel registry
├─ Create mock channel types for testing
└─ Write unit tests

Phase 2: Migrate Status Messages
├─ Add 'status' channel to ChannelTypes
├─ Migrate StatusMessage types to protocol package
├─ Update StatusBroadcaster to use ProtocolServer
├─ Create useChannelSubscription() React hook
├─ Update client StatusDisplay
└─ Remove WebSocketBridge

Phase 3: Migrate Chat Messages
├─ Add 'chat' channel to ChannelTypes
├─ Migrate chat types to protocol package
├─ Create ChatRoom service
├─ Update server agent
├─ Update client hooks and pages
└─ Verify E2E chat flow

Phase 4: Remove WebSocket Protocol
├─ Remove WebSocket handlers
├─ Remove client SessionWebSocket
└─ Clean up dependencies
```

---

## Migration Strategy

### Key Principles

1. **No Fallback**: Focus on making the new system work. Do not maintain WebSocket fallback during migration.

2. **End-to-End Migration**: Migrate client and server together per channel type. Verify each channel works end-to-end before moving to the next.

3. **Breakage is Expected**: The system may break during transition. Document what is expected to break and when functionality will be restored.

4. **Singleton Pattern is Application-Layer**: The protocol framework does not enforce singleton channels. Application code (e.g., React hooks) manages singleton instances as needed.

5. **Validation Strategy**: Rely on TypeScript compile-time checks for now. Add `// TODO: Add Zod runtime validation` comments for future enhancement.

6. **Error Handling**: 
   - Transport-level errors: handled via try/catch in handlers
   - Application-level errors: defined as channel events (e.g., `tool_call_error` in status channel)

7. **Status Messages**: Fire-and-forget. No history replay on reconnect.

### Testing Strategy

- Migrate tests as channels are implemented
- Remove obsolete tests (e.g., WebSocket-specific tests)
- No backward compatibility tests needed
- No benchmarking required

---

## Success Criteria

- [ ] **Architecture:**
  - Protocol layer implemented in `apps/common/protocol/`
  - Application services have no transport knowledge
  - Clear separation: `common/protocol/` vs `transport/` vs `features/`
  - All channel types defined in protocol package

- [ ] **Functionality:**
  - Status messages flow through channel transport
  - Chat messages flow through channel transport
  - Type-safe payloads enforced at compile-time

- [ ] **Testing:**
  - Unit tests for ProtocolServer and ProtocolClient pass
  - E2E tests pass for all migrated channels
  - No obsolete tests remaining

- [ ] **Documentation:**
  - Channel API documented
  - Migration guide complete (this document)

- [ ] **Code Quality:**
  - `npm run build` passes for all apps
  - `npm run lint` passes with no new errors
  - `npm run test` passes (unit tests)
  - `npm run test:e2e` passes (E2E tests)
