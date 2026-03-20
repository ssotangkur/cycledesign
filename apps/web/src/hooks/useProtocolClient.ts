import { useState, useEffect } from 'react';
import { ProtocolClient } from '@cycledesign/common-protocol';
import type { ProtocolClientOptions } from '@cycledesign/common-protocol';
import { useSingleton } from './useSingleton';

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

// Global connection state - shared across all components
let _isConnected = false;
const _stateListeners = new Set<(connected: boolean) => void>();

export interface ProtocolClientState {
  client: ProtocolClient;
  isConnected: boolean;
}

/**
 * Creates and manages a singleton ProtocolClient instance.
 *
 * The client connects to the ProtocolServer at /protocol endpoint.
 * No sessionId is needed - the server manages channel instances per connection.
 *
 * @returns Object containing ProtocolClient instance and connection state
 *
 * @example
 * ```tsx
 * function App() {
 *   const { client, isConnected } = useProtocolClient();
 *
 *   return (
 *     <ProtocolContext.Provider value={client}>
 *       <StatusDisplay />
 *     </ProtocolContext.Provider>
 *   );
 * }
 * ```
 */
export function useProtocolClient(): ProtocolClientState {
  // Use useSingleton for the ProtocolClient instance
  const client = useSingleton('protocol-client', () => {
    const url = `${WS_BASE_URL}/protocol`;

    const options: ProtocolClientOptions = {
      onError: (error: Error) => {
        console.error('[ProtocolClient] Error:', error);
      },
      onStateChange: (state: 'connecting' | 'connected' | 'disconnected') => {
        console.log('[ProtocolClient] State changed:', state);
        // Update global state
        _isConnected = state === 'connected';
        // Notify all listeners
        _stateListeners.forEach(listener => listener(_isConnected));
      },
    };

    return new ProtocolClient(url, options);
  });

  // Subscribe to global connection state
  const [isConnected, setIsConnected] = useState(_isConnected);

  useEffect(() => {
    // Subscribe to state changes
    const listener = (connected: boolean) => {
      setIsConnected(connected);
    };
    _stateListeners.add(listener);

    return () => {
      _stateListeners.delete(listener);
    };
  }, [client]);

  return { client, isConnected };
}
