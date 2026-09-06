import { describe, it, expect, vi } from 'vitest';
import { StatusBroadcaster } from './StatusBroadcaster.js';

describe('StatusBroadcaster sendSessionsChanged (issue #75)', () => {
  it('should deliver sessions_changed with sessionId to subscribers', () => {
    const broadcaster = new StatusBroadcaster();
    const handler = vi.fn();
    const unsubscribe = broadcaster.subscribe(handler);

    broadcaster.sendSessionsChanged('session-abc123');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      event: 'sessions_changed',
      data: { sessionId: 'session-abc123' },
    });

    unsubscribe();
  });

  it('should not deliver after unsubscribe', () => {
    const broadcaster = new StatusBroadcaster();
    const handler = vi.fn();
    const unsubscribe = broadcaster.subscribe(handler);
    unsubscribe();

    broadcaster.sendSessionsChanged('session-abc123');

    expect(handler).not.toHaveBeenCalled();
  });
});
