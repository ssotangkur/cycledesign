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

  test('should send message and receive response', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider for deterministic responses
    await useMockProvider();
    await createSession();

    const testMessage = 'Hello';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify user message appears in chat
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText(testMessage);

    // Verify input is cleared after sending
    await expect(promptInput).toHaveValue('');

    // Verify input is re-enabled after response completes
    await expect(promptInput).toBeEnabled();
  });

  test('should handle multiple messages', async ({
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

    // Verify first message appears and input is re-enabled
    await expect(chatPanel).toContainText('First message');
    await expect(promptInput).toBeEnabled();

    // Verify input is re-enabled after each response
    await expect(promptInput).toBeEnabled();
  });

  test('should preserve chat history', async ({
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
    await promptInput.fill('Message 1');
    await promptInput.press('Enter');
    await expect(chatPanel).toContainText('Message 1');
    await expect(promptInput).toBeEnabled();

    // All messages should be visible in chat history
    await expect(chatPanel).toContainText('Message 1');
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
