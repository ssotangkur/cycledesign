/**
 * Global singleton registry for app-wide singletons
 * Keyed by unique string identifiers
 */
const singletonRegistry = new Map<string, unknown>();

/**
 * Returns a singleton instance stored globally by key.
 * Creates the instance using the supplier function if it doesn't exist yet.
 *
 * @param key - Unique identifier for this singleton
 * @param supplier - Function that creates the singleton instance (called only once)
 * @returns The singleton instance
 *
 * @example
 * ```tsx
 * // Simple singleton
 * const config = useSingleton('config', () => loadConfig());
 *
 * // Using with other hooks
 * function useApiClient() {
 *   const { token } = useAuth();
 *   return useSingleton('api-client', () => new ApiClient(token));
 * }
 * ```
 */
export function useSingleton<T>(key: string, supplier: () => T): T {
  // Initialize singleton if not exists
  if (!singletonRegistry.has(key)) {
    singletonRegistry.set(key, supplier());
  }

  // Return from registry
  return singletonRegistry.get(key) as T;
}
