import { WebSocket } from 'ws';

export interface StatusMessage {
  type: 'status';
  messageId: string;
  status:
    | 'generation_start'
    | 'generation_thinking'
    | 'generation_complete'
    | 'tool_call_start'
    | 'tool_call_complete'
    | 'tool_call_error'
    | 'validation_start'
    | 'validation_complete'
    | 'validation_error'
    | 'preview_start'
    | 'preview_ready'
    | 'preview_error';
  tool?: string;
  details: string;
  timestamp: number;
}

/**
 * WebSocket protocol message type for status updates.
 * This is the format sent over the WebSocket connection.
 */
export interface WebSocketStatusMessage {
  type: 'status';
  status: StatusMessage['status'];
  messageId: string;
  tool?: string;
  details: string;
  timestamp: number;
}

export { WebSocket };
