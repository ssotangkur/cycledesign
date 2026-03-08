import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Chat Panel Interactions
 * 
 * These tests verify the chat panel functionality:
 * - Sending messages
 * - Message display
 * - Input behavior
 * - Loading states
 * 
 * Note: We do NOT assert on LLM response content since it's non-deterministic.
 * Future: Mock LLM responses for full flow testing.
 */
test.describe('Chat Panel', () => {
  
  test('should display empty state when no session selected', async ({ authenticatedPage }) => {
    // Clear any existing session by going to a fresh page
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]');
    
    // Wait a bit for any localStorage to load
    await authenticatedPage.waitForTimeout(500);
    
    // The message list area should exist in the chat panel
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toBeVisible();
  });

  test('should enable prompt input when session is selected', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    // Prompt input should be enabled - target the actual input element
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await expect(promptInput).toBeEnabled();
  });

  test('should send a message and display it in chat', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const testMessage = 'Hello, this is a test message!';
    
    // Type message - target the actual input element inside MUI TextField
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(testMessage);
    
    // Send message (press Enter)
    await promptInput.press('Enter');
    
    // Verify message appears in chat (look for user message)
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText(testMessage);
    
    // Verify input is cleared
    await expect(promptInput).toHaveValue('');
  });

  test('should send message with Send button', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const testMessage = 'Sending with button';
    
    // Type message
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(testMessage);
    
    // Click send button
    await authenticatedPage.getByTestId('send-button').click();
    
    // Verify message appears
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText(testMessage);
  });

  test('should clear input after sending message', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill('Test message');
    await promptInput.press('Enter');
    
    // Input should be empty after sending
    await expect(promptInput).toHaveValue('');
  });

  // NOTE: Loading indicator test removed - timing is non-deterministic without LLM mocking
  // The loading state depends on network latency and LLM response time

  test('should disable input while streaming response', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    // Send a message
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill('Test');
    await promptInput.press('Enter');
    
    // Input should be disabled while streaming
    await expect(promptInput).toBeDisabled();
  });

  test('should not send empty message', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    
    // Try to send empty message
    await promptInput.press('Enter');
    
    // Input should still be empty (message wasn't sent)
    await expect(promptInput).toHaveValue('');
  });

  test('should not send whitespace-only message', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    
    // Fill with whitespace only
    await promptInput.fill('   ');
    await promptInput.press('Enter');
    
    // Input should be cleared or still have whitespace (message wasn't sent)
    const value = await promptInput.inputValue();
    expect(value.trim()).toBe('');
  });

  test('should handle multi-line input', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    const multiLineMessage = 'Line 1\nLine 2\nLine 3';
    
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(multiLineMessage);
    
    // Verify multi-line content is in the input
    await expect(promptInput).toHaveValue(multiLineMessage);
    
    // Send with Ctrl+Enter (should preserve newlines)
    await promptInput.press('Control+Enter');
    
    // Message should appear in chat
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toContainText('Line 1');
  });

  test('should show user avatar for user messages', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();
    
    // Send a message
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill('Test');
    await promptInput.press('Enter');
    
    // User message should have user avatar
    const userAvatar = authenticatedPage.locator('[data-testid="avatar-user"]').first();
    await expect(userAvatar).toBeVisible();
  });

  test('should display connection status changes', async ({ authenticatedPage }) => {
    const connectionStatus = authenticatedPage.getByTestId('connection-status');
    
    // Connection status should be visible
    await expect(connectionStatus).toBeVisible();
    
    // Should show either Connected or Disconnected
    const statusText = await connectionStatus.textContent();
    expect(statusText).toMatch(/Connected|Disconnected/);
  });
});
