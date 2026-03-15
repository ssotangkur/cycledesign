import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Chat Flow with Mock Provider
 *
 * These tests use the mock provider to ensure deterministic responses:
 * - No dependency on external LLM APIs
 * - Consistent, predictable responses
 * - Fast execution without network latency
 * - Reliable CI/CD testing
 */
test.describe('Chat Flow with Mock Provider', () => {

  test('should complete full chat flow with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider for deterministic responses
    await useMockProvider();
    await createSession();

    const testMessage = 'Create a hello world app';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify user message appears in chat
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText(testMessage);

    // Verify input is cleared after sending
    await expect(promptInput).toHaveValue('');

    // Verify mock response appears (deterministic response)
    // The mock provider returns "This is a mock response from the MockProvider."
    await expect(chatPanel).toContainText('mock response');

    // Verify input is re-enabled after response completes
    await expect(promptInput).toBeEnabled();
  });

  test('should trigger tool calls with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider for deterministic tool calls
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message that triggers tool call
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify tool call status appears
    // The mock provider triggers create_file tool
    await expect(authenticatedPage.getByText('create_file')).toBeVisible({ timeout: 10000 });

    // Verify file creation status is displayed
    await expect(authenticatedPage.getByText('test.tsx')).toBeVisible({ timeout: 10000 });
  });

  test('should handle multiple messages with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const promptInput = authenticatedPage.getByTestId('prompt-input');
    const chatPanel = authenticatedPage.getByTestId('chat-panel');

    // Send first message
    await promptInput.fill('First message');
    await promptInput.press('Enter');

    // Verify first message appears
    await expect(chatPanel).toContainText('First message');
    await expect(chatPanel).toContainText('mock response');

    // Send second message
    await promptInput.fill('Second message');
    await promptInput.press('Enter');

    // Verify second message appears
    await expect(chatPanel).toContainText('Second message');

    // Verify input is re-enabled after each response
    await expect(promptInput).toBeEnabled();
  });

  test('should preserve chat history with mock provider', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const promptInput = authenticatedPage.getByTestId('prompt-input');
    const chatPanel = authenticatedPage.getByTestId('chat-panel');

    // Send multiple messages
    const messages = ['Message 1', 'Message 2', 'Message 3'];

    for (const message of messages) {
      await promptInput.fill(message);
      await promptInput.press('Enter');
      await expect(chatPanel).toContainText(message);
    }

    // All messages should be visible in chat history
    for (const message of messages) {
      await expect(chatPanel).toContainText(message);
    }
  });

  test('should handle special characters in messages', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Create app with <div>HTML</div> and "quotes" and \'apostrophes\'';
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    const chatPanel = authenticatedPage.getByTestId('chat-panel');

    // Send message with special characters
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify message appears correctly
    await expect(chatPanel).toContainText('Create app with');
    await expect(chatPanel).toContainText('HTML');

    // Verify input is re-enabled
    await expect(promptInput).toBeEnabled();
  });
});
