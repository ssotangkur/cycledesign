import type { ChannelTypes } from '@cycledesign/common-protocol';

/**
 * Status server event type - union of all status channel server events
 * Derived from ChannelTypes for type safety
 */
type StatusServerEvent = {
  [K in keyof ChannelTypes['status']['server']]: {
    event: K;
    data: ChannelTypes['status']['server'][K];
  }
}[keyof ChannelTypes['status']['server']];

type StatusEventHandler = (status: StatusServerEvent) => void;

/**
 * StatusBroadcaster - Application service for broadcasting status events.
 * 
 * This is a pure application service with NO transport knowledge.
 * It uses an event emitter pattern for internal broadcasting.
 * The ProtocolServer subscribes to events and forwards them to channels.
 */
export class StatusBroadcaster {
  private handlers = new Set<StatusEventHandler>();

  /**
   * Subscribe to status events.
   * @param handler - Function to call when a status is broadcast
   * @returns Unsubscribe function
   */
  subscribe(handler: StatusEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Broadcast a status event to all subscribers.
   */
  private broadcast(status: StatusServerEvent) {
    this.handlers.forEach(handler => handler(status));
  }

  sendGenerationStart(messageId: string, details: string) {
    this.broadcast({ event: 'generation_start', data: { messageId, details } });
  }

  sendGenerationThinking(messageId: string, details: string) {
    this.broadcast({ event: 'generation_thinking', data: { messageId, details } });
  }

  sendGenerationComplete(messageId: string, details: string) {
    this.broadcast({ event: 'generation_complete', data: { messageId, details } });
  }

  sendToolCallStart(messageId: string, tool: string, details: string) {
    this.broadcast({ event: 'tool_call_start', data: { messageId, tool, details } });
  }

  sendToolCallComplete(messageId: string, tool: string, details: string) {
    this.broadcast({ event: 'tool_call_complete', data: { messageId, tool, details } });
  }

  sendToolCallError(messageId: string, tool: string, error: string) {
    this.broadcast({ event: 'tool_call_error', data: { messageId, tool, details: error } });
  }

  sendValidationStart(messageId: string, details: string) {
    this.broadcast({ event: 'validation_start', data: { messageId, details } });
  }

  sendValidationComplete(messageId: string, details: string) {
    this.broadcast({ event: 'validation_complete', data: { messageId, details } });
  }

  sendPreviewStart(messageId: string, details: string) {
    this.broadcast({ event: 'preview_start', data: { messageId, details } });
  }

  sendPreviewReady(messageId: string, port: number, details: string) {
    this.broadcast({ event: 'preview_ready', data: { messageId, port, details } });
  }

  sendPreviewError(messageId: string, details: string) {
    this.broadcast({ event: 'preview_error', data: { messageId, details } });
  }
}

/**
 * Singleton instance for application-wide use
 */
export const statusBroadcaster = new StatusBroadcaster();
