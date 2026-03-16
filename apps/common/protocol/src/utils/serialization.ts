import { TransportEnvelopeSchema, ControlMessageSchema } from '../types.js';
import type { TransportEnvelope, ControlMessage } from '../types.js';

/**
 * Serialize message for WebSocket transmission
 */
export function serializeMessage(envelope: TransportEnvelope | ControlMessage): string {
  return JSON.stringify(envelope);
}

/**
 * Deserialize message from WebSocket
 * Returns null for malformed messages (silently ignored)
 *
 * Uses Zod schemas from types.ts for validation:
 * - Control messages: must match ControlMessageSchema
 * - Transport envelopes: must match TransportEnvelopeSchema
 *
 * Note: This validates message STRUCTURE only. Semantic validation
 * (e.g., is 'chat' a valid channelType?) happens at the application layer
 * when handlers are registered via onChannelSubscribe() and channel.subscribe()
 */
export function deserializeMessage(data: string): TransportEnvelope | ControlMessage | null {
  try {
    const parsed = JSON.parse(data);

    // Basic validation - must be object
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Try to parse as control message first (has 'type' field)
    if ('type' in parsed) {
      const result = ControlMessageSchema.safeParse(parsed);
      if (result.success) {
        return result.data as ControlMessage;
      }
      // Invalid control message - fall through to return null
    }

    // Try to parse as transport envelope
    const result = TransportEnvelopeSchema.safeParse(parsed);
    if (result.success) {
      return result.data as TransportEnvelope;
    }

    // Unknown message format
    return null;
  } catch {
    // Silently ignore malformed messages
    return null;
  }
}
