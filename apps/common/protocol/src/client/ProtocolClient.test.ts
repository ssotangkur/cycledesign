import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProtocolClient } from './ProtocolClient.js';
import { serializeMessage, deserializeMessage } from '../utils/serialization.js';
import type { TransportEnvelope } from '../types.js';

/**
 * Fake WebSocket: captures sent messages, lets the test drive
 * open + inbound messages deterministically.
 */
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: serializeMessage(message as never) });
  }
}

describe('ProtocolClient pre-confirm publish (issue #170)', () => {
  const RealWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = RealWebSocket;
  });

  it('should route a publish made before confirmation with the real channel id', () => {
    const client = new ProtocolClient('ws://localhost:9999/protocol');
    const channel = client.channel('chat');

    // Publish before the server confirmed the channel (subscribe-response
    // not yet received): the envelope is queued with the temporary id.
    void channel.publish('get-history', { sessionId: 'session-abc123' });

    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    // Server connection opens, then confirms the subscription with a real id.
    ws.open();
    ws.receive({ type: 'subscribe-response', channelType: 'chat', channelId: 'channel-9', requestId: 'temp-1' });

    const envelopes = ws.sent
      .map((raw) => deserializeMessage(raw))
      .filter((msg): msg is TransportEnvelope => !!msg && !('type' in (msg as object)));

    const history = envelopes.find(
      (env) => (env.payload as { event?: string })?.event === 'get-history',
    );
    expect(history).toBeDefined();
    // Regression guard: before the fix this stayed 'temp-1', which the
    // server cannot route, so the message was silently dropped and pane
    // hydration never arrived after a reload.
    expect(history?.channelId).toBe('channel-9');
  });

  it('should send a publish made after confirmation directly', () => {
    const client = new ProtocolClient('ws://localhost:9999/protocol');
    const channel = client.channel('chat');
    const ws = FakeWebSocket.instances[0];

    ws.open();
    ws.receive({ type: 'subscribe-response', channelType: 'chat', channelId: 'channel-9', requestId: 'temp-1' });
    ws.sent.length = 0;

    void channel.publish('get-history', { sessionId: 'session-abc123' });

    const envelopes = ws.sent
      .map((raw) => deserializeMessage(raw))
      .filter((msg): msg is TransportEnvelope => !!msg && !('type' in (msg as object)));
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].channelId).toBe('channel-9');
  });
});
