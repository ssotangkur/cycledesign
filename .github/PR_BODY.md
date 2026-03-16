## Overview

Implements a complete channel-based transport protocol to replace the legacy WebSocket API. This migration provides type-safe, bidirectional communication between client and server using a structured channel abstraction.

## Changes

### Protocol Implementation (apps/common/protocol/)
- New @cycledesign/common-protocol package
- ProtocolServer - Manages WebSocket connections at /protocol endpoint with channel routing
- ProtocolClient - Client-side channel management with auto-connect on first channel() call
- Type-safe channel registry with TransportEnvelope message format
- Message serialization/deserialization with Zod validation
- **Fix:** Control messages are now queued until WebSocket connection is established

### Server-side Changes
- Integrated ProtocolServer in server.ts
- Migrated StatusBroadcaster to use channel transport (fire-and-forget pattern)
- Refactored MessageHandler to use closure-based per-channel state management (better encapsulation)
- **Fix:** LLM responses are now properly saved and broadcast when no tool calls are present
- Removed legacy WebSocketBridge, WebSocketHandler, and related types

### Client-side Changes
- New React hooks:
  - useProtocolClient - Singleton ProtocolClient instance
  - useStatusChannel - Access to status channel
  - useChatChannel - Access to chat channel
  - useChannelSubscription - Generic hook for channel event subscriptions
  - useSingleton - Utility for creating singleton instances
- Migrated components to use channel subscription pattern:
  - StatusDisplay - Now subscribes to status channel events
  - ConnectionStatus - Uses ProtocolClient connection state
  - MessageList, PromptInput - Use useChatMessageList with channel transport
- Removed legacy SessionWebSocket and useMessageListState

### Documentation
- Updated CHANNEL-SUBSCRIPTION-DESIGN.md with requestId matching pattern for channel subscriptions
- Updated WEBSOCKET-MIGRATION.md to reflect completed implementation

## Testing

- Verified WebSocket connection establishment at ws://localhost:3001/protocol
- Verified bidirectional message flow (subscribe, history, chat messages)
- Verified status message broadcasting through WebSocket
- Verified LLM responses are received and displayed
- Chrome DevTools shows WebSocket frames in Network → WS → protocol → Frames tab

## Type Safety

The channel protocol provides compile-time type safety:
- Separated client→server and server→client event types
- Type-safe payload validation
- Automatic channel instance management per connection

## Migration Notes

The legacy WebSocket API at /ws has been removed. All communication now flows through the channel transport at /protocol.
