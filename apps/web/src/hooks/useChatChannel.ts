import type { Channel, ChannelTypes } from '@cycledesign/common-protocol';
import { useProtocolClient } from './useProtocolClient';
import { useSingleton } from './useSingleton';

/**
 * Returns a singleton chat channel instance.
 *
 * Since ProtocolClient is already a singleton, we can create a singleton
 * chat channel that all components share across the entire app.
 *
 * @returns The chat channel instance
 *
 * @example
 * ```tsx
 * const chatChannel = useChatChannel();
 *
 * // Subscribe to messages
 * useEffect(() => {
 *   const unsubscribe = chatChannel.subscribe('history', (payload) => {
 *     console.log('History:', payload.messages);
 *   });
 *   return () => unsubscribe();
 * }, [chatChannel]);
 *
 * // Send a message
 * const sendMessage = () => {
 *   chatChannel.publish('message', { content: 'Hello!' });
 * };
 * ```
 */
export function useChatChannel(): Channel<ChannelTypes['chat']> {
  const { client } = useProtocolClient();

  return useSingleton('chat-channel', () => client.channel('chat'));
}
