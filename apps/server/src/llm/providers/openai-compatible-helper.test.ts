import { describe, it, expect, vi, afterEach } from 'vitest';
import { withDynamicHeaders, createGatewayModel } from './openai-compatible-helper.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const seen: Array<{ input: unknown; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      seen.push({ input, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch
  );
  return seen;
}

function headersOf(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

describe('withDynamicHeaders', () => {
  it('should attach fresh dynamic headers on each string-URL request', async () => {
    const seen = stubFetch();
    let n = 0;
    const wrapped = withDynamicHeaders(() => ({ 'x-opencode-request': `prt_${++n}` }));

    await wrapped('https://example.com/a', { headers: { 'X-Static': 'keep' } });
    await wrapped('https://example.com/b', { headers: { 'X-Static': 'keep' } });

    expect(seen).toHaveLength(2);
    expect(headersOf(seen[0].init).get('x-opencode-request')).toBe('prt_1');
    expect(headersOf(seen[1].init).get('x-opencode-request')).toBe('prt_2');
    expect(headersOf(seen[0].init).get('X-Static')).toBe('keep');
  });

  it('should skip undefined dynamic values without clobbering static headers', async () => {
    const seen = stubFetch();
    const wrapped = withDynamicHeaders(() => ({
      'x-opencode-request': undefined,
      'x-opencode-session': 'ses_abc',
    }));

    await wrapped('https://example.com/', { headers: { 'x-opencode-request': 'static' } });

    const headers = headersOf(seen[0].init);
    expect(headers.get('x-opencode-request')).toBe('static');
    expect(headers.get('x-opencode-session')).toBe('ses_abc');
  });

  it('should merge dynamic headers into Request inputs without mutating the original', async () => {
    const seen = stubFetch();
    const wrapped = withDynamicHeaders(() => ({ 'x-opencode-request': 'prt_new' }));
    const original = new Request('https://example.com/', { headers: { 'X-Orig': 'yes' } });

    await wrapped(original);

    expect(original.headers.get('x-opencode-request')).toBeNull();
    const forwarded = seen[0].input as Request;
    expect(forwarded.headers.get('X-Orig')).toBe('yes');
    expect(forwarded.headers.get('x-opencode-request')).toBe('prt_new');
  });
});

describe('createGatewayModel with dynamicHeaders', () => {
  it('should build a V3 LanguageModel without throwing', () => {
    const model = createGatewayModel({
      apiKey: 'test-key',
      model: 'openrouter/free',
      headers: { 'x-opencode-client': 'cli' },
      dynamicHeaders: () => ({ 'x-opencode-request': 'prt_1' }),
    });
    const shape = model as unknown as { modelId: string; specificationVersion: string };
    expect(shape.modelId).toBe('openrouter/free');
    expect(shape.specificationVersion).toBe('v3');
  });
});
