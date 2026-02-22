import { WebSocket } from 'ws';
import { statusBroadcaster } from './status-broadcaster';
import { executeToolCalls } from '../llm/tool-executor';

interface WebSocketMessage {
  type: string;
  id?: string;
  content?: string;
  timestamp?: number;
}

export function handleWebSocketConnection(ws: WebSocket) {
  statusBroadcaster.addClient(ws);
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;
      
      if (message.type === 'message' && message.id && message.content) {
        await handleGenerationRequest(ws, message);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message',
      }));
    }
  });
  
  ws.on('close', () => {
    statusBroadcaster.removeClient(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    statusBroadcaster.removeClient(ws);
  });
}

async function handleGenerationRequest(
  ws: WebSocket,
  message: WebSocketMessage
) {
  const messageId = message.id!;
  
  ws.send(JSON.stringify({
    type: 'ack',
    messageId,
    timestamp: Date.now(),
  }));
  
  try {
    const mockToolCalls = [
      {
        id: `call_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: 'create_file',
          arguments: JSON.stringify({
            filename: 'example.tsx',
            location: 'designs',
            code: 'export default function Example() { return null; }',
          }),
        },
      },
    ];
    
    await executeToolCalls(mockToolCalls, messageId);
    
    ws.send(JSON.stringify({
      type: 'done',
      messageId,
      timestamp: Date.now(),
    }));
  } catch (error) {
    console.error('Generation error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      messageId,
      message: error instanceof Error ? error.message : 'Generation failed',
      timestamp: Date.now(),
    }));
  }
}
