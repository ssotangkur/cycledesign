# CycleDesign Technical Design

**Last Updated:** March 2026
**Version:** 2.0 (Post WebSocket Migration)

---

## Architecture Overview

### Directory Structure

```
apps/server/src/
├── transport/                    # Transport layer (WebSocket protocol)
│   └── ws/
│       └── WebSocketHandler.ts   # Connection, session, rate limiting
│
├── features/                     # Application features
│   └── status/
│       ├── types.ts              # StatusMessage, StatusType definitions
│       ├── StatusBroadcaster.ts  # Pub/sub for status events
│       └── WebSocketBridge.ts    # Bridge: status → WebSocket
│
├── llm/                          # LLM domain
│   ├── agent.ts                  # ToolLoopAgent orchestration
│   ├── tool-executor.ts          # Manual tool execution
│   ├── tools/                    # Tool implementations
│   └── providers/
│       ├── provider-factory.ts
│       ├── mistral.ts
│       ├── qwen.ts
│       └── mock.ts               # Mock provider for testing
│
└── validation/                   # Validation domain
    ├── validation-service.ts     # Shared validation logic
    ├── pipeline.ts
    └── ...
```

### Responsibility Boundaries

| Layer | Directory | Responsibilities |
|-------|-----------|------------------|
| **Transport** | `transport/ws/` | WebSocket protocol, TCP connections, session tracking, rate limiting, message routing |
| **Application** | `features/status/` | Status message types, pub/sub broadcasting, WebSocket bridge |
| **Domain** | `llm/`, `validation/` | LLM orchestration, tool execution, validation logic |

### Data Flow

```
User Message (WebSocket)
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │  Transport Layer
│  (connections, sessions)│
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  ToolLoopAgent          │  Application Layer
│  (LLM + tool calls)     │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  StatusBroadcaster      │  Application Layer
│  (pub/sub events)       │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketBridge        │  Bridge
│  (route by sessionId)   │
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│  WebSocketHandler       │  Transport Layer
│  (sends to client)      │
└─────────────────────────┘
```

---

## Component Summary

| Component | Location | Purpose | Documentation |
|-----------|----------|---------|---------------|
| Channel Transport | `packages/protocol/` | Type-safe bidirectional channel abstraction, per-session channels, message routing | [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) |
| WebSocket Transport | `transport/ws/` | Legacy WebSocket connection management, session tracking, rate limiting | [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) |
| Status Broadcasting | `features/status/` | Pub/sub status events, real-time updates during AI generation | [STATUS-MESSAGES.md](./STATUS-MESSAGES.md) |
| ToolLoopAgent | `llm/agent.ts` | LLM orchestration, tool call coordination | [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) |
| Validation Service | `validation/` | Centralized validation logic for TypeScript, ESLint, dependencies | [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) |
| Mock Provider | `llm/providers/mock.ts` | Deterministic LLM provider for E2E testing | [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) |
| File System Tools | `llm/tools/` | readFile, findFile for workspace introspection | [TOOLS-REFERENCE.md](./TOOLS-REFERENCE.md) |
| Design System Tools | `llm/tools/` | Component introspection, design tokens, composition rules | [DESIGN-SYSTEM-TOOLS.md](./DESIGN-SYSTEM-TOOLS.md) |
| Preview Bridge | `apps/web/src/hooks/` | postMessage API for tool UI ↔ preview iframe communication | [PREVIEW-BRIDGE.md](./PREVIEW-BRIDGE.md) |

---

## Key Design Decisions

### 1. Separation of Transport and Application Layers

The transport layer handles low-level connection management, while the application layer handles domain logic. 

**New Channel Transport:** The channel-based transport (`packages/protocol/`) provides a type-safe bidirectional abstraction with per-session channel instances. Application services are pure (no transport knowledge) and the transport subscribes to application events. See [CHANNEL-SUBSCRIPTION-DESIGN.md](./CHANNEL-SUBSCRIPTION-DESIGN.md) for complete architecture.

**Legacy WebSocket Transport:** The WebSocket transport (`transport/ws/`) handles raw WebSocket connections, session tracking, and rate limiting. See [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) for detailed architecture.

This separation allows application logic to remain agnostic of the underlying transport mechanism, making it easier to migrate between transports or add new ones.

### 2. Centralized Validation Logic

All validation logic (TypeScript compilation, ESLint checks, dependency verification) is centralized in the `validation/` directory and used by both ToolLoopAgent and manual tool execution. This ensures consistent validation behavior across all code generation paths. See [WEBSOCKET-MIGRATION.md](./WEBSOCKET-MIGRATION.md) for validation pipeline details.

### 3. Session-Aware Status Routing

The `WebSocketBridge` maintains a mapping between message IDs and session IDs, enabling status updates to be routed to the correct client session even when multiple sessions are active concurrently. This design supports the pub/sub pattern while maintaining session isolation. See [STATUS-MESSAGES.md](./STATUS-MESSAGES.md) for status type definitions and routing logic.

### 4. Tool-Based LLM Interaction

File system operations and design system introspection are exposed as AI SDK tools rather than direct function calls. This enables the LLM to dynamically decide when to read files, search for patterns, or query component definitions during code generation. See [TOOLS-REFERENCE.md](./TOOLS-REFERENCE.md) and [DESIGN-SYSTEM-TOOLS.md](./DESIGN-SYSTEM-TOOLS.md) for tool specifications.

### 5. Cross-Origin Preview Communication

The preview iframe communicates with the tool UI via postMessage API, enabling mode switching, component selection, and prop updates across origins (port 3000 ↔ port 3002). This design maintains security boundaries while enabling rich interactive preview features. See [PREVIEW-BRIDGE.md](./PREVIEW-BRIDGE.md) for message protocol details.
