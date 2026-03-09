import { useMemo } from 'react';
import { useLocalStorage } from 'usehooks-ts';
import { useCallback, useState, useEffect } from 'react';
import { trpc } from '../utils/trpc';

const STORAGE_KEY = 'cycledesign:currentSessionId';

// ============ Current Session ID ============

/**
 * Hook to manage the current session ID.
 * Persists to localStorage and syncs across components.
 */
export function useCurrentSessionId() {
  const [currentSessionId, setCurrentSessionId] = useLocalStorage<string | null>(STORAGE_KEY, null);

  return {
    currentSessionId,
    setCurrentSessionId,
  };
}

/**
 * Hook to check if localStorage has hydrated.
 * useLocalStorage returns null on first render before hydration.
 */
export function useIsHydrated() {
  const [isHydrated, setIsHydrated] = useState(false);

  // Use requestAnimationFrame to avoid setState in effect
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      setIsHydrated(true);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  return isHydrated;
}

// ============ Sessions List ============

/**
 * Hook to access sessions list and derived data.
 * Uses tRPC query with automatic caching and background refetching.
 */
export function useSessions() {
  const {
    data: sessions = [],
    isLoading,
    isRefetching,
    isFetching,
    error,
    refetch,
  } = trpc.sessions.list.useQuery();

  // Derived: session labels map
  const sessionLabelsMap = useMemo(() => {
    const map: Record<string, string> = {};
    sessions.forEach((session) => {
      map[session.id] = session.firstMessage || session.id.slice(-8);
    });
    return map;
  }, [sessions]);

  // Derived: session count
  const sessionCount = sessions.length;

  // Derived: check if session exists
  const hasSession = (id: string) => sessions.some((s) => s.id === id);

  return {
    // Raw query data
    sessions,
    isLoading,
    isRefetching,
    isFetching,
    error,
    refetch,

    // Derived data
    sessionLabelsMap,
    sessionCount,
    hasSession,
  };
}

// ============ Session Mutations ============

/**
 * Hook to create a new session.
 * Automatically invalidates the sessions list on success.
 */
export function useCreateSession() {
  const utils = trpc.useUtils();

  const mutation = trpc.sessions.create.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
    },
  });

  const createSession = useCallback(async (name?: string) => {
    return mutation.mutateAsync({ name });
  }, [mutation]);

  return {
    createSession,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to delete a session.
 * Automatically invalidates the sessions list on success.
 */
export function useDeleteSession() {
  const utils = trpc.useUtils();

  const mutation = trpc.sessions.delete.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
    },
  });

  const deleteSession = useCallback(async (id: string) => {
    return mutation.mutateAsync(id);
  }, [mutation]);

  return {
    deleteSession,
    isDeleting: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to delete all sessions.
 * Automatically invalidates the sessions list on success.
 */
export function useDeleteAllSessions() {
  const utils = trpc.useUtils();

  const mutation = trpc.sessions.deleteAll.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
    },
  });

  const deleteAllSessions = useCallback(async () => {
    return mutation.mutateAsync();
  }, [mutation]);

  return {
    deleteAllSessions,
    isDeletingAll: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to get a session by ID.
 * Uses tRPC utility to fetch without caching.
 */
export function useGetSession() {
  const utils = trpc.useUtils();

  const getSessionById = useCallback(async (id: string) => {
    return utils.sessions.get.fetch(id);
  }, [utils]);

  return { getSessionById };
}

/**
 * Hook to invalidate/refetch the sessions list.
 */
export function useInvalidateSessions() {
  const utils = trpc.useUtils();

  const invalidateSessions = useCallback(async () => {
    return utils.sessions.list.invalidate();
  }, [utils]);

  return { invalidateSessions };
}
