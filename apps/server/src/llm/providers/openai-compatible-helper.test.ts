import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  withDynamicHeaders,
  createGatewayModel,
  OPENROUTER_BASE_URL,
  OPENROUTER_APP_REFERER,
  OPENROUTER_APP_TITLE,
} from './openai-compatible-helper.js';

vi.mock('@ai-sdk/openai-compatible', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ai-sdk/openai-compatible')>();
  return {
    ...original,
    createOpenAICompatible: vi.fn((options: unknown) => {
      const real = (original as unknown as { createOpenAICompatible: (o: unknown) => { chatModel: (m: string) => unknown } })
        .createOpenAICompatible(options);
      const originalChatModel = real.chatModel.bind(real);
      return {
        ...real,
        chatModel: vi.fn((modelId: string) => {
          const model = originalChatModel(modelId) as unknown as Record<string, unknown>;
          // Preserve V3 shape for the dynamicHeaders probe while staying mockable
          // for header-regression assertions.
          return { specificationVersion: 'v3', ...model, modelId };
        }),
      };
    }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
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

// Header regression (KD-2): the helper injects no default headers. OpenRouter
// attribution is passed explicitly by its call site; local passes none and
// omits apiKey when keyless so no Authorization header is sent.
describe('createGatewayModel header behavior', () => {
  it('should forward explicit OpenRouter attribution headers', async () => {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    createGatewayModel({
      apiKey: 'test-key',
      model: 'openrouter/free',
      headers: {
        'HTTP-Referer': OPENROUTER_APP_REFERER,
        'X-Title': OPENROUTER_APP_TITLE,
      },
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      baseURL: OPENROUTER_BASE_URL,
      name: 'openrouter',
      apiKey: 'test-key',
      headers: {
        'HTTP-Referer': OPENROUTER_APP_REFERER,
        'X-Title': OPENROUTER_APP_TITLE,
      },
    });
  });

  it('should send no headers and no apiKey for a keyless local server', async () => {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    createGatewayModel({ baseURL: 'http://localhost:11434/v1', name: 'local', model: 'llama3.1:8b' });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      baseURL: 'http://localhost:11434/v1',
      name: 'local',
    });
    const call = vi.mocked(createOpenAICompatible).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(call).not.toHaveProperty('headers');
    expect(call).not.toHaveProperty('apiKey');
  });
});
