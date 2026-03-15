# Channel Transport Migration Plan

**Status:** Planned (Q2 2026)
**Created:** March 14, 2026
**Last Updated:** March 14, 2026

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
- [ ] Create `packages/protocol/src/types.ts` with `ChannelTypes` interface
- [ ] Implement `ProtocolServer` class with `onChannelSubscribe()` method
- [ ] Implement `ProtocolClient` class with `channel()` method
- [ ] Implement message serialization/deserialization
- [ ] Implement server-side channel instance management
- [ ] Implement client-side auto-connect/disconnect

**Files to Create:**
- `packages/protocol/src/types.ts`
- `packages/protocol/src/server/ProtocolServer.ts`
- `packages/protocol/src/client/ProtocolClient.ts`
- `packages/protocol/src/utils/serialization.ts`

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

**Goal:** Move status:updates channel to channel transport

**Tasks:**
- [ ] Add `status:updates` to `ChannelTypes` interface
- [ ] Update `StatusBroadcaster` to use `ProtocolServer`
- [ ] Update `WebSocketBridge` to work with channels
- [ ] Update client `StatusDisplay` component to use `ProtocolClient`
- [ ] Keep existing WebSocket as fallback

**Files to Modify:**
- `apps/server/src/features/status/types.ts`
- `apps/server/src/features/status/StatusBroadcaster.ts`
- `apps/server/src/features/status/WebSocketBridge.ts`
- `apps/web/src/components/status/StatusDisplay.tsx`

**Acceptance Criteria:**
- Status messages flow through channel transport
- Existing WebSocket clients still work
- E2E tests pass for both protocols

**Reference:** [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) "Examples: Status Updates"

---

### Phase 3: Migrate Chat Messages to Channels

**Goal:** Move chat channel to channel transport

**Tasks:**
- [ ] Add `chat` to `ChannelTypes` interface
- [ ] Create `ChatRoom` application service (pure, no transport knowledge)
- [ ] Update server to use `onChannelSubscribe('chat', ...)`
- [ ] Update client to use `client.channel('chat')`
- [ ] Migrate message history loading

**Files to Create:**
- `apps/server/src/features/chat/ChatRoom.ts`

**Files to Modify:**
- `apps/server/src/llm/agent.ts`
- `apps/web/src/api/websocket.ts`
- `apps/web/src/hooks/useMessageListState.ts`
- `apps/web/src/pages/ChatPage.tsx`

**Acceptance Criteria:**
- Chat messages flow through channel transport
- Type-safe message payloads
- Backward compatible with WebSocket clients

**Reference:** [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) "Examples: Chat Channel"

---

### Phase 4: Deprecate WebSocket API

**Goal:** Mark WebSocket transport as deprecated

**Tasks:**
- [ ] Add deprecation warnings to WebSocket endpoints
- [ ] Update documentation to recommend channel transport
- [ ] Add migration guide for clients
- [ ] Set deprecation timeline

**Files to Modify:**
- `apps/server/src/transport/ws/WebSocketHandler.ts`
- `docs/WEBSOCKET_PROTOCOL.md`

**Acceptance Criteria:**
- Deprecation notices visible in logs
- Documentation updated
- Migration path documented

---

### Phase 5: Remove WebSocket Protocol Layer

**Goal:** Remove legacy WebSocket transport

**Tasks:**
- [ ] Remove WebSocket message handling code
- [ ] Remove SessionWebSocket class from client
- [ ] Remove WebSocket-specific types
- [ ] Clean up unused dependencies

**Files to Delete:**
- `apps/server/src/transport/ws/WebSocketHandler.ts` (if no longer needed)
- `apps/web/src/api/websocket.ts` (if fully replaced)

**Acceptance Criteria:**
- All functionality works via channel transport
- No references to legacy WebSocket API
- Bundle size reduced

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
| **Type Safety** | Runtime validation | Compile-time enforcement |
| **Event Direction** | Bidirectional (untyped) | Separated client→server and server→client |
| **Session Management** | sessionId in URL query | Per-channel instances, auto-managed |
| **Message Format** | `{ type, content, ... }` | `TransportEnvelope` with channelId |
| **Handler Registration** | Callback-based | `registerHandlers()` - type-enforced |
| **Reconnection** | Exponential backoff | Not supported (create new client) |

---

## Appendix B: Implementation Order

```
Phase 1: Implement Protocol Layer
├─ Create ProtocolServer and ProtocolClient
├─ Implement type-safe channel registry
└─ Write unit tests

Phase 2: Migrate Status Messages
├─ Add status:updates to ChannelTypes
├─ Update StatusBroadcaster
├─ Update WebSocketBridge
└─ Update client StatusDisplay

Phase 3: Migrate Chat Messages
├─ Add chat to ChannelTypes
├─ Create ChatRoom service
├─ Update server agent
└─ Update client hooks and pages

Phase 4: Deprecate WebSocket API
├─ Add deprecation warnings
├─ Update documentation
└─ Set deprecation timeline

Phase 5: Remove WebSocket Protocol
├─ Remove WebSocket handlers
├─ Remove client SessionWebSocket
└─ Clean up dependencies
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking changes to client API | Keep WebSocket as fallback during Phases 2-3 |
| Type registry complexity | Start with minimal channels (status, chat) |
| Client migration coordination | Use feature flags for gradual rollout |
| Performance regression | Benchmark channel overhead vs raw WebSocket |

---

## Rollback Plan

If migration encounters critical issues:

1. **Phase 1:** Protocol layer is additive - no rollback needed
2. **Phase 2-3:** Keep WebSocket fallback functional
3. **Phase 4:** Deprecation is documentation-only - no rollback needed
4. **Phase 5:** Revert removal if critical bugs found

**Rollback Command:**
```bash
git revert <commit-hash>
# Or restore from backup
```

---

## Success Criteria

- [ ] **Architecture:**
  - Protocol layer implemented with type-safe channels
  - Application services have no transport knowledge
  - Clear separation: protocol/ vs transport/ vs features/

- [ ] **Functionality:**
  - Status messages flow through channel transport
  - Chat messages flow through channel transport
  - Type-safe payloads enforced at compile-time

- [ ] **Testing:**
  - Unit tests for ProtocolServer and ProtocolClient
  - E2E tests pass for channel transport
  - Backward compatibility tests pass for WebSocket fallback

- [ ] **Documentation:**
  - Channel API documented
  - Migration guide complete
  - Deprecation notices in place

- [ ] **Code Quality:**
  - `npm run build` passes for all apps
  - `npm run lint` passes with no new errors
  - `npm run test` passes (unit tests)
  - `npm run test:e2e` passes (E2E tests)
