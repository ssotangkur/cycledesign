import { useEffect } from 'react';
import type { Channel, ChannelTypes } from '@cycledesign/common-protocol';

/**
 * Subscribe to a channel event.
 *
 * IMPORTANT: This hook only cleans up the event subscription on unmount.
 * The channel instance itself is NOT cleaned up by this hook.
 *
 * Channel lifecycle is managed by the ProtocolClient instance.
 * For singleton channel patterns (e.g., status channel), use dedicated
 * hooks like `useStatusChannel` that manage channel instance reuse.
 *
 * @example
 * // For one-off subscriptions:
 * const { client } = useProtocolClient();
 * const channel = client.channel('status');
 * useChannelSubscription({ channel, event: 'update', handler });
 *
 * // For singleton channels, use dedicated hook:
 * const statusChannel = useStatusChannel();
 * useChannelSubscription({ channel: statusChannel, event: 'generation_start', handler });
 *
 * @example
 * ```tsx
 * const statusChannel = useStatusChannel();
 * useChannelSubscription({
 *   channel: statusChannel,
 *   event: 'generation_start',
 *   handler: (payload) => {
 *     console.log('Generation started:', payload);
 *   }
 * });
 * ```
 */
interface UseChannelSubscriptionOptions<T extends keyof ChannelTypes, K extends keyof ChannelTypes[T]['server']> {
  channel: Channel<ChannelTypes[T]>;
  event: K;
  handler: (payload: ChannelTypes[T]['server'][K]) => void;
}

export function useChannelSubscription<T extends keyof ChannelTypes, K extends keyof ChannelTypes[T]['server']>({
  channel,
  event,
  handler,
}: UseChannelSubscriptionOptions<T, K>): void {
  useEffect(() => {
    const unsubscribe = channel.subscribe(event, handler);
    return () => {
      unsubscribe();
    };
  }, [channel, event, handler]);
}
