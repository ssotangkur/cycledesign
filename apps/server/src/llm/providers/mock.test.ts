import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from './mock.js';

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  describe('Static Methods', () => {
    it('should return correct name', () => {
      expect(MockProvider.name()).toBe('mock');
    });

    it('should return correct displayName', () => {
      expect(MockProvider.displayName()).toBe('Mock Provider');
    });

    it('should not require API key', () => {
      expect(MockProvider.requiresApiKey()).toBe(false);
    });

    it('should not have API key', () => {
      expect(MockProvider.hasApiKey()).toBe(false);
    });

    it('should save config without error', () => {
      expect(() => MockProvider.saveConfig({ model: 'test' })).not.toThrow();
    });

    it('should load config with default model', () => {
      const config = MockProvider.loadConfig();
      expect(config).toEqual({ model: 'mock-model' });
    });
  });

  describe('Instance Properties', () => {
    it('should have name property', () => {
      expect(provider.name).toBe('mock');
    });
  });

  describe('complete()', () => {
    it('should return create_file tool call for "create file" prompt', async () => {
      const messages = [{ role: 'user' as const, content: 'Please create file for me' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('I will create a file for you.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('create_file');
      expect(result.toolCalls[0].args).toEqual({
        filename: 'test.tsx',
        code: 'export default function Test() { return <div>Hello</div>; }',
      });
    });

    it('should return create_file tool call for "create_file" prompt', async () => {
      const messages = [{ role: 'user' as const, content: 'Please create_file for me' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('I will create a file for you.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('create_file');
    });

    it('should return edit_file tool call for "edit" prompt', async () => {
      const messages = [{ role: 'user' as const, content: 'Please edit this file' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('I will edit the file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('edit_file');
      expect(result.toolCalls[0].args).toEqual({
        filename: 'test.tsx',
        code: 'export default function Updated() { return <div>Updated</div>; }',
      });
    });

    it('should return edit_file tool call for "update" prompt', async () => {
      const messages = [{ role: 'user' as const, content: 'Please update this file' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('I will edit the file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('edit_file');
    });

    it('should return default response for unknown prompts', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello, how are you?' }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('This is a mock response from the MockProvider. How can I help you today?');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle array content format', async () => {
      const messages = [{
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Create file for me' }],
      }];
      const result = await provider.complete(messages);

      expect(result.content).toBe('I will create a file for you.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('create_file');
    });

    it('should return stream for all responses', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await provider.complete(messages);

      expect(result.stream).toBeDefined();
      if (result.stream) {
        expect(result.stream[Symbol.asyncIterator]).toBeDefined();
      }
    });

    it('should stream chunks with delays', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await provider.complete(messages);

      const chunks: string[] = [];
      if (result.stream) {
        for await (const chunk of result.stream) {
          chunks.push(chunk);
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('').trim()).toBe('This is a mock response from the MockProvider. How can I help you today?');
    });

    it('should always include toolCalls array', async () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = await provider.complete(messages);

      expect(result.toolCalls).toBeDefined();
      expect(Array.isArray(result.toolCalls)).toBe(true);
    });
  });

  describe('listModels()', () => {
    it('should return mock model', async () => {
      const models = await provider.listModels();

      expect(models).toHaveLength(1);
      expect(models[0]).toEqual({
        id: 'mock-model',
        name: 'Mock Model',
      });
    });
  });
});
