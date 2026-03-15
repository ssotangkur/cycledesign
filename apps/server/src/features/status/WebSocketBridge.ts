import type { WebSocketHandler } from '../../transport/ws/WebSocketHandler.js';
import type { StatusMessage } from './types.js';
import { statusBroadcaster } from './StatusBroadcaster.js';

/**
 * WebSocketBridge connects the application-layer status broadcasting system
 * to the WebSocket transport layer.
 *
 * It maintains a mapping of messageId to sessionId so that status messages
 * can be routed to the correct WebSocket session.
 */
export class WebSocketBridge {
  // Maps messageId to sessionId for routing status messages
  private messageIdToSessionId = new Map<string, string>();

  constructor(
    private wsHandler: WebSocketHandler
  ) {
    this.subscribe();
  }

  /**
   * Register a messageId to sessionId mapping.
   * Call this when a new message session starts.
   */
  public registerSession(messageId: string, sessionId: string): void {
    this.messageIdToSessionId.set(messageId, sessionId);
  }

  /**
   * Unregister a messageId from the mapping.
   * Call this when a message session ends.
   */
  public unregisterSession(messageId: string): void {
    this.messageIdToSessionId.delete(messageId);
  }

  /**
   * Subscribe to status events from the StatusBroadcaster.
   * Captures all status events and forwards them to the appropriate session.
   */
  private subscribe(): void {
    statusBroadcaster.subscribe((status) => {
      // Forward to appropriate session using messageId from the status
      this.broadcastStatusByMessageId(status.messageId, {
        status: status.status,
        details: status.details,
        timestamp: status.timestamp,
        tool: status.tool,
      });
    });
  }

  /**
   * Broadcast a status message to a specific session.
   * This is the primary method for sending status updates via WebSocket.
   *
   * @param sessionId - The session to broadcast to
   * @param messageId - The message ID for this status
   * @param status - The status message to send (without type and messageId)
   */
  public broadcastStatus(sessionId: string, messageId: string, status: Omit<StatusMessage, 'type' | 'messageId'>): void {
    this.wsHandler.broadcastToSession(sessionId, {
      type: 'status',
      messageId,
      ...status,
    });
  }

  /**
   * Broadcast a status message using messageId to look up the sessionId.
   *
   * @param messageId - The message ID to look up the session
   * @param status - The status message to send (without type and messageId)
   * @returns true if the message was sent, false if sessionId not found
   */
  public broadcastStatusByMessageId(messageId: string, status: Omit<StatusMessage, 'type' | 'messageId'>): boolean {
    const sessionId = this.messageIdToSessionId.get(messageId);
    if (!sessionId) {
      console.warn('[WebSocketBridge] No sessionId found for messageId:', messageId);
      return false;
    }
    this.broadcastStatus(sessionId, messageId, status);
    return true;
  }
}
