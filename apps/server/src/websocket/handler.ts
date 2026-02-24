import { WebSocket } from 'ws';
import { statusBroadcaster } from './status-broadcaster';
import { executeToolCalls } from '../llm/tool-executor';
import { QwenProvider } from '../llm/providers/qwen';
import { allTools } from '../llm/tools';
import { SYSTEM_PROMPT } from '../llm/system-prompt';
import type { CoreMessage } from 'ai';

interface WebSocketMessage {
  type: string;
  id?: string;
  content?: string;
  timestamp?: number;
}

const llmProvider = new QwenProvider();

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
  const userPrompt = message.content!;
  
  ws.send(JSON.stringify({
    type: 'ack',
    messageId,
    timestamp: Date.now(),
  }));
  
  try {
    const messages: CoreMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    
    const response = await llmProvider.complete(messages, { tools: allTools });
    let toolCalls = response.toolCalls;
    let iterations = 0;
    const maxIterations = 10;
    
    while (iterations < maxIterations) {
      iterations++;
      
      if (!toolCalls || toolCalls.length === 0) {
        console.log('[HANDLER] No tool calls returned, using fallback validation');
        break;
      }
      
      const formattedToolCalls = toolCalls.map((tc) => ({
        id: tc.id ?? `call_${Date.now()}_${iterations}`,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
      
      await executeToolCalls(formattedToolCalls, messageId);
      
      const submitCall = toolCalls.find((tc) => tc.name === 'submit_work');
      if (submitCall) {
        console.log('[HANDLER] submit_work called, ending loop');
        break;
      }
      
      ws.send(JSON.stringify({
        type: 'content',
        messageId,
        content: response.content || '',
        timestamp: Date.now(),
      }));
      
      messages.push({ role: 'assistant', content: response.content || '' });
      for (const tc of toolCalls) {
        messages.push({
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: tc.id, toolName: tc.name, result: JSON.stringify(tc.args) }],
        });
      }
      
      const nextResponse = await llmProvider.complete(messages, { tools: allTools });
      toolCalls = nextResponse.toolCalls;
    }
    
    if (!toolCalls || toolCalls.length === 0) {
      ws.send(JSON.stringify({
        type: 'content',
        messageId,
        content: response.content || 'No code was generated. Please try again.',
        timestamp: Date.now(),
      }));
    }
    
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
