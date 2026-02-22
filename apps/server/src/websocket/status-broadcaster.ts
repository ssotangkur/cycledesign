import { WebSocket } from 'ws';
import { StatusMessage } from './types';

export class StatusBroadcaster {
  private clients: Set<WebSocket>;

  constructor() {
    this.clients = new Set();
  }

  addClient(ws: WebSocket) {
    this.clients.add(ws);
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws);
  }

  broadcastStatus(status: StatusMessage) {
    const message = JSON.stringify(status);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  sendToolCallStart(messageId: string, tool: string, details: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_start',
      tool,
      details,
      timestamp: Date.now(),
    });
  }

  sendToolCallComplete(messageId: string, tool: string, details: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_complete',
      tool,
      details,
      timestamp: Date.now(),
    });
  }

  sendToolCallError(messageId: string, tool: string, error: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'tool_call_error',
      tool,
      details: error,
      timestamp: Date.now(),
    });
  }

  sendValidationStart(messageId: string, stage: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'validation_start',
      details: `Running ${stage}...`,
      timestamp: Date.now(),
    });
  }

  sendValidationComplete(messageId: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'validation_complete',
      details: 'All validations passed',
      timestamp: Date.now(),
    });
  }

  sendPreviewStart(messageId: string) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'preview_start',
      details: 'Starting preview server...',
      timestamp: Date.now(),
    });
  }

  sendPreviewReady(messageId: string, port: number) {
    this.broadcastStatus({
      type: 'status',
      messageId,
      status: 'preview_ready',
      details: `Preview ready at http://localhost:${port}`,
      timestamp: Date.now(),
    });
  }
}

export const statusBroadcaster = new StatusBroadcaster();
