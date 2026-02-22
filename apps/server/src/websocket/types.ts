import { WebSocket } from 'ws';

export interface StatusMessage {
  type: 'status';
  messageId: string;
  status:
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

export { WebSocket };
