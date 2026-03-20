/**
 * @cycledesign/common-protocol
 *
 * Type-safe WebSocket channel protocol for CycleDesign
 */

// Types
export type {
  ChannelTypes,
  ClientEvents,
  ServerEvents,
  TransportEnvelope,
  ControlMessage,
  Channel,
  ChannelSubscription,
  ServerChannel,
  ChatMessage,
} from './types.js';

// Schemas (for validation)
export {
  ChannelTypesSchema,
  TransportEnvelopeSchema,
  ControlMessageSchema,
  PayloadSchema,
} from './types.js';

// Server
export { ProtocolServer } from './server/ProtocolServer.js';

// Client
export { ProtocolClient } from './client/ProtocolClient.js';
export type { ProtocolClientOptions } from './client/ProtocolClient.js';

// Utils
export { serializeMessage, deserializeMessage } from './utils/serialization.js';
