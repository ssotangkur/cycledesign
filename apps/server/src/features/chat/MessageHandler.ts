// apps/server/src/features/chat/MessageHandler.ts

import type { ServerChannel, ChannelTypes, UserId } from '@cycledesign/common-protocol';
import { statusBroadcaster } from '../status/StatusBroadcaster.js';
import { getMessages, addMessage, generateMessageId } from '../../sessions/storage.js';
import { StoredMessage, getStoredMessageRole, toModelMessage } from '../../llm/types.js';
import { SYSTEM_PROMPT } from '../../llm/system-prompt.js';
import { executeToolCalls } from '../../llm/tool-executor.js';
import { allTools } from '../../llm/tools/tools.js';
import { getLLMProvider } from '../../llm/providers/provider-factory.js';
import { ModelMessage } from 'ai';

/**
 * MessageHandler - Handles LLM streaming and tool execution for chat messages
 *
 * This handler processes user messages received via the chat channel,
 * streams responses from the LLM, handles tool calls, and broadcasts
 * status updates.
 */
export class MessageHandler {
  private messageHandlers = new Set<(msg: { id: string; content: string; userId: UserId; timestamp: number }) => void>();
  private messages: Array<{ id: string; content: string; userId: UserId; timestamp: number }> = [];

  /**
   * Get all messages (for history)
   */
  getHistory(): Array<{ id: string; content: string; userId: UserId; timestamp: number }> {
    return [...this.messages];
  }

  /**
   * Subscribe to new messages
   */
  onMessage(handler: (msg: { id: string; content: string; userId: UserId; timestamp: number }) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Add a message to internal memory and notify subscribers
   */
  private addMessageToMemory(content: string, userId: UserId): void {
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content,
      userId,
      timestamp: Date.now(),
    };
    this.messages.push(message);
    this.messageHandlers.forEach(handler => handler(message));
  }

  /**
   * Add a message and notify subscribers
   */
  private addMessage(content: string, userId: UserId): void {
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content,
      userId,
      timestamp: Date.now(),
    };
    this.messages.push(message);
    this.messageHandlers.forEach(handler => handler(message));
  }

  /**
   * Create channel handler for chat channel
   * This is called by ProtocolServer when a client subscribes to the chat channel
   *
   * Uses closure-based state management - each channel gets its own isolated state
   * captured in the closure, eliminating the need for a class-level Map.
   */
  createChatChannelHandler(channel: ServerChannel<ChannelTypes['chat']>) {
    // Per-channel state captured in closure
    let isStreaming = false;

    return {
      message: async (payload: { content: string; sessionId: string }) => {
        // Check if already streaming
        if (isStreaming) {
          console.log('[MessageHandler] Message ignored - streaming in progress for channel:', channel.id);
          return;
        }

        console.log('[MessageHandler] Handling user message for channel:', channel.id);
        console.log('[MessageHandler] Content length:', payload.content.length);

        // Mark as streaming
        isStreaming = true;

        try {
          // Use sessionId from the payload (sent by frontend)
          const sessionId = payload.sessionId;

          // Reject missing or path-traversal sessionIds before touching storage
          // (storage joins sessionId onto the sessions directory)
          if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
            console.error('[MessageHandler] Rejected message with invalid sessionId:', JSON.stringify(sessionId));
            return;
          }

          // Ensure system message exists once per session (storage-checked,
          // so server restarts don't duplicate it)
          const existingMessages = await getMessages(sessionId);
          if (!existingMessages.some((m) => getStoredMessageRole(m) === 'system')) {
            const systemMsg: StoredMessage = {
              id: generateMessageId(),
              timestamp: Date.now(),
              modelMessage: {
                role: 'system',
                content: SYSTEM_PROMPT
              }
            };
            await addMessage(sessionId, systemMsg);
            console.log('[MessageHandler] System message saved to session:', sessionId);
          }

          // Generate message IDs
          const serverMsgId = generateMessageId();

          // Save user message to storage
          const userMsg: StoredMessage = {
            id: serverMsgId,
            timestamp: Date.now(),
            modelMessage: {
              role: 'user',
              content: payload.content
            }
          };

          await addMessage(sessionId, userMsg);
          console.log('[MessageHandler] User message saved to session:', sessionId);

          // Broadcast user message to all channels (userId 'user' won't match any channel.id)
          this.addMessageToMemory(payload.content, 'user');

          // Broadcast status: generation start
          statusBroadcaster.sendGenerationStart(serverMsgId, 'Processing your message');

          // Stream LLM response
          await this.streamLLM(channel, sessionId, serverMsgId);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[MessageHandler] Error handling message:', errorMsg);
          statusBroadcaster.sendPreviewError('error', errorMsg);
        } finally {
          // Clear streaming flag
          isStreaming = false;
        }
      },
      typing: (payload: { isTyping: boolean }) => {
        // Handle typing indicator (optional)
        console.log(`User ${channel.id} is ${payload.isTyping ? 'typing' : 'not typing'}`);
      },
    };
  }

  /**
   * Stream LLM response and handle tool calls
   */
  private async streamLLM(
    channel: ServerChannel<ChannelTypes['chat']>,
    sessionId: string,
    userMessageId: string
  ): Promise<void> {
    const channelId = channel.id;

    console.log('[MessageHandler] === streamLLM START === channel:', channelId);

    try {
      const messages = await getMessages(sessionId);
      console.log('[MessageHandler] Retrieved', messages.length, 'messages from storage');

        // Build messages array for LLM
        // Use stored modelMessages directly, avoiding repeated conversion.
        // Legacy rows without modelMessage are rebuilt; unusable rows are
        // skipped (never pass undefined into the provider).
        let currentMessages: ModelMessage[] = [];
        for (const msg of messages) {
          const modelMsg = toModelMessage(msg);
          if (modelMsg) {
            currentMessages.push(modelMsg);
          } else {
            // Null-safe: a corrupt row may have no id either.
            // Null-safe: a corrupt row may have no id either.
            const rowId = (msg as { id?: unknown } | null | undefined)?.id;
            console.warn('[MessageHandler] Skipping stored message with no usable content:', rowId ?? '<unknown>');
          }
        }

      console.log('[MessageHandler] Built currentMessages array with', currentMessages.length, 'items');

      let toolCallsMade = false;
      let isFirstTurn = true;
      let hasMoreToolCalls = true;
      let loopCount = 0;
      let fullResponseContent = '';

      while (hasMoreToolCalls) {
        loopCount++;
        console.log('[MessageHandler] === Loop iteration', loopCount, '===');

        const result = await getLLMProvider().complete(currentMessages, {
          stream: true,
          tools: allTools,
        }) as unknown as {
          stream: AsyncIterable<string>;
          toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
        };

        console.log('[MessageHandler] Provider.complete returned');

        if (!result.stream) {
          console.error('[MessageHandler] Stream not available for channel:', channelId);
          throw new Error('Stream not available');
        }

        // Stream content chunks
        let chunkCount = 0;
        fullResponseContent = '';

        console.log('[MessageHandler] Starting to stream chunks');
        for await (const chunk of result.stream) {
          if (isFirstTurn) {
            // Note: We don't stream individual chunks to the client via chat channel
            // The client will see the complete message when it's added to ChatRoom
            chunkCount++;
          }
          fullResponseContent += chunk;
        }
        console.log('[MessageHandler] Stream complete - received', chunkCount, 'chunks');

        // Get tool calls
        const toolCalls = await result.toolCalls;
        console.log('[MessageHandler] Tool calls from LLM:', toolCalls?.length || 0);

        // Check if tool calls exist but have missing arguments
        const hasToolCalls = toolCalls && toolCalls.length > 0;
        const toolCallsMissingArgs = hasToolCalls &&
          toolCalls.some((tc: unknown) => {
            const t = tc as { args?: unknown };
            const args = t.args;
            return !args || (typeof args === 'object' && Object.keys(args).length === 0) ||
              (typeof args === 'string' && (args === '' || args === '{}'));
          });

        if (toolCallsMissingArgs) {
          console.log('[MessageHandler] Tool calls have missing arguments');
          const tc = toolCalls[0] as { name?: string; toolName?: string };
          const name = tc.name || tc.toolName || 'unknown';
          // Add a message indicating we need more information
          this.addMessage(
            `I need more information to proceed. The ${name} tool requires additional parameters. Could you please provide more details?`,
            'assistant'
          );
          break;
        }

        if (hasToolCalls) {
          toolCallsMade = true;
          console.log('[MessageHandler] Detected', toolCalls.length, 'tool calls');

          const toolCallArray = toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
            },
          }));

          console.log('[MessageHandler] Executing', toolCallArray.length, 'tool calls');
          await executeToolCalls(toolCallArray, userMessageId);
          console.log('[MessageHandler] All tool calls completed');

           // Build new messages for next turn
           const newMessages: ModelMessage[] = [];

           if (fullResponseContent.trim()) {
             newMessages.push({ role: 'assistant', content: fullResponseContent });
           }

           // Note: Tool messages are handled by the AI SDK automatically
           // The SDK will generate appropriate tool messages based on the tool calls

          currentMessages = [...currentMessages, ...newMessages];
          console.log('[MessageHandler] Added', newMessages.length, 'messages for next turn');
          isFirstTurn = false;
        } else {
          console.log('[MessageHandler] No tool calls detected');
          hasMoreToolCalls = false;

           // Save assistant message to storage
           const assistantMsg: StoredMessage = {
              id: generateMessageId(),
              timestamp: Date.now(),
              modelMessage: {
                role: 'assistant',
                content: hasToolCalls ? '[Design generated]' : fullResponseContent
              }
            };

          await addMessage(sessionId, assistantMsg);
          console.log('[MessageHandler] Assistant message saved to session:', sessionId);

          // Add message and notify subscribers
          this.addMessage(
            hasToolCalls ? '[Design generated]' : fullResponseContent,
            'assistant'
          );

          // Broadcast status: generation complete
          statusBroadcaster.sendGenerationComplete(assistantMsg.id, 'Response complete');
        }
      }

      // After multi-turn loop completes, trigger validation if tool calls were made.
      // The just-handled user message is the validation target — use its id
      // directly instead of re-deriving it from the pre-loop snapshot, which
      // can be stale under concurrency or contain skipped corrupt rows.
      if (toolCallsMade) {
        const autoMessageId = userMessageId;

        // Trigger validation pipeline
        try {
          const { ValidationService } = await import('../../validation/validation-service.js');
          const validationService = new ValidationService();
          await validationService.validateAndPreparePreview(autoMessageId);
          console.log('[MessageHandler] Automatic validation completed successfully');
        } catch (error) {
          console.error('[MessageHandler] Automatic validation failed:', (error as Error).message);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack';
      console.error('[MessageHandler] === streamLLM ERROR ===');
      console.error('[MessageHandler] Error message:', errorMsg);
      console.error('[MessageHandler] Error stack:', errorStack);
      console.error('[MessageHandler] Channel:', channelId);

      statusBroadcaster.sendPreviewError('error', errorMsg);
    } finally {
      console.log('[MessageHandler] === streamLLM END === channel:', channelId);
    }
  }
}
