import type { Channel, ChannelTypes } from '@cycledesign/common-protocol';
import { useProtocolClient } from './useProtocolClient';
import { useSingleton } from './useSingleton';

/**
 * Returns a singleton status channel instance.
 *
 * Since ProtocolClient is already a singleton, we can create a singleton
 * status channel that all components share across the entire app.
 *
 * @returns The status channel instance
 *
 * @example
 * ```tsx
 * const statusChannel = useStatusChannel();
 *
 * useEffect(() => {
 *   const unsubscribe = statusChannel.subscribe('generation_start', handler);
 *   return () => unsubscribe();
 * }, [statusChannel]);
 * ```
 */
export function useStatusChannel(): Channel<ChannelTypes['status']> {
  const { client } = useProtocolClient();

  return useSingleton('status-channel', () => client.channel('status'));
}
