// apps/server/src/features/chat/MessageHandler.ts

import type { ServerChannel, ChannelTypes, ChatMessage, UserId } from '@cycledesign/common-protocol';
import { statusBroadcaster } from '../status/StatusBroadcaster.js';
import { getMessages, addMessage, generateMessageId } from '../../sessions/storage.js';
import { StoredMessage, getStoredMessageRole, getStoredMessageText, toModelMessage } from '../../llm/types.js';
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
   * Hydrate pane history from persisted storage (issue #170).
   *
   * Maps StoredMessage rows to pane-visible ChatMessage rows: only
   * user/assistant turns with non-empty text, in file order, preserving
   * stored id + timestamp. System/tool rows and corrupt rows are skipped
   * with a warn (same skip pattern as streamLLM).
   *
   * Never throws for bad input or missing files: invalid sessionIds and
   * missing sessions degrade to an empty pane.
   */
  async getSessionHistory(sessionId: string): Promise<ChatMessage[]> {
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      console.warn('[MessageHandler] getSessionHistory rejected invalid sessionId:', JSON.stringify(sessionId));
      return [];
    }

    let stored: StoredMessage[];
    try {
      stored = await getMessages(sessionId);
    } catch (error) {
      console.warn('[MessageHandler] getSessionHistory could not read session:', sessionId, (error as Error).message);
      return [];
    }

    const history: ChatMessage[] = [];
    for (const msg of stored) {
      const role = getStoredMessageRole(msg);
      if (role !== 'user' && role !== 'assistant') {
        const rowId = (msg as { id?: unknown } | null | undefined)?.id;
        console.warn('[MessageHandler] Skipping stored message with non-pane role:', rowId ?? '<unknown>');
        continue;
      }
      const text = getStoredMessageText(msg);
      if (!text) {
        const rowId = (msg as { id?: unknown } | null | undefined)?.id;
        console.warn('[MessageHandler] Skipping stored message with no usable content:', rowId ?? '<unknown>');
        continue;
      }
      const row = msg as { id?: unknown; timestamp?: unknown };
      history.push({
        id: typeof row.id === 'string' ? row.id : generateMessageId(),
        content: text,
        userId: role,
        timestamp: typeof row.timestamp === 'number' ? row.timestamp : Date.now(),
      });
    }
    return history;
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
  private addMessageToMemory(content: string, userId: UserId, id?: string, timestamp?: number): void {
    const message = {
      id: id ?? `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content,
      userId,
      timestamp: timestamp ?? Date.now(),
    };
    this.messages.push(message);
    this.messageHandlers.forEach(handler => handler(message));
  }

  /**
   * Add a message and notify subscribers
   */
  private addMessage(content: string, userId: UserId, id?: string, timestamp?: number): void {
    const message = {
      id: id ?? `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content,
      userId,
      timestamp: timestamp ?? Date.now(),
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
          const hadPriorUserMessage = existingMessages.some(
            (m) => getStoredMessageRole(m) === 'user',
          );
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

          // Server-push label invalidation (issue #75): the label derives
          // from the first user message, durable before the (possibly very
          // slow) LLM stream. Emit only on the null→first-user-message
          // transition so later messages don't refetch.
          if (!hadPriorUserMessage) {
            statusBroadcaster.sendSessionsChanged(sessionId);
          }

          // Broadcast user message to all channels (userId 'user' won't match any channel.id)
          // Reuse the stored id/timestamp so the live echo id-matches the
          // persisted snapshot on rehydrate (issue #170).
          this.addMessageToMemory(payload.content, 'user', serverMsgId, userMsg.timestamp);

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
      'get-history': async (payload: { sessionId: string }) => {
        // Per-session pane hydration from persisted storage (issue #170).
        // The sessionId echoes back so the client accepts only the history
        // for its current session.
        const sessionId = payload.sessionId;
        try {
          const messages = await this.getSessionHistory(sessionId);
          console.log('[MessageHandler] Sending persisted history for session:', sessionId, 'messages:', messages.length);
          channel.send('history', { messages, sessionId });
        } catch (error) {
          console.warn('[MessageHandler] get-history failed for session:', JSON.stringify(sessionId), (error as Error).message);
          channel.send('history', { messages: [], sessionId: typeof sessionId === 'string' ? sessionId : '' });
        }
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
          const needMoreInfo =
            `I need more information to proceed. The ${name} tool requires additional parameters. Could you please provide more details?`;
          // Persist the reply, not just the in-memory broadcast: without a
          // stored assistant row the next turn stacks user-on-user in
          // messages.jsonl and strict Jinja templates degrade (issue #169).
          const needInfoMsg: StoredMessage = {
            id: generateMessageId(),
            timestamp: Date.now(),
            modelMessage: {
              role: 'assistant',
              content: needMoreInfo
            }
          };
          await addMessage(sessionId, needInfoMsg);
          console.log('[MessageHandler] Need-more-info message saved to session:', sessionId);
          this.addMessage(needMoreInfo, 'assistant', needInfoMsg.id, needInfoMsg.timestamp);
          statusBroadcaster.sendGenerationComplete(needInfoMsg.id, 'Response complete');
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
           //
           // Known follow-up (issue #138, KD-6): tool results are not fed
           // back as `tool`-role messages — the AI SDK handles tool
           // messages internally, so the next turn only sees the assistant
           // text. If multi-turn tool chaining misbehaves, feed explicit
           // tool results here. `loopCount` below is also unbounded; add a
           // max-turn guard if the agent ever loops on tools.
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
            'assistant',
            assistantMsg.id,
            assistantMsg.timestamp
          );

          // Broadcast status: generation complete
          statusBroadcaster.sendGenerationComplete(assistantMsg.id, 'Response complete');
        }
      }

      // After multi-turn loop completes, trigger validation if tool calls were made.
      // The just-handled user message is the validation target — use its id
      // directly instead of re-deriving it from the pre-loop snapshot, which
      // can be stale under concurrency or contain skipped corrupt rows.
      //
      // Known follow-up (issue #138, KD-6): validation can trigger twice —
      // once in `executeToolCalls` on `submit_work` and again here on any
      // `toolCallsMade`. Kept as-is here; unifying ownership needs a
      // preview-routing decision. Workspace paths are unified in
      // `src/paths.ts` (repo-root `workspace/`, never derived from cwd).
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
      // Persist a marker assistant row (best-effort) so the failed turn does
      // not leave an orphan user row: without it the next turn stacks
      // user-on-user in messages.jsonl and strict Jinja templates degrade
      // (issue #169). This also covers the 'Stream not available' throw,
      // which funnels through this catch. Keeps pane and storage in sync.
      try {
        const errorNote = `[Error: ${errorMsg}]`;
        const errorMsgRow: StoredMessage = {
          id: generateMessageId(),
          timestamp: Date.now(),
          modelMessage: {
            role: 'assistant',
            content: errorNote
          }
        };
        await addMessage(sessionId, errorMsgRow);
        console.log('[MessageHandler] Error marker saved to session:', sessionId);
        this.addMessage(errorNote, 'assistant', errorMsgRow.id, errorMsgRow.timestamp);
      } catch (persistError) {
        console.error(
          '[MessageHandler] Failed to persist error marker:',
          (persistError as Error).message
        );
      }
    } finally {
      console.log('[MessageHandler] === streamLLM END === channel:', channelId);
    }
  }
}
