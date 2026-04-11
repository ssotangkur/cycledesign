import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Test for Message Persistence Across Page Reload
 *
 * This test verifies that messages (both user and assistant) persist
 * correctly after a page reload, addressing a UX bug where conversation
 * history could become confusing or lost.
 *
 * Test Flow:
 * 1. Create a session
 * 2. Send a user message
 * 3. Wait for assistant response
 * 4. Reload the page
 * 5. Verify user messages still show as user messages
 * 6. Verify assistant messages still show as assistant messages
 */
test.describe('Message Persistence Across Page Reload', () => {

  test('should preserve user and assistant messages after page reload', async ({ authenticatedPage, createSession }) => {
    // Step 1: Create a session
    await createSession();

    // Step 2: Send a user message
    const testMessage = 'Hello, this is a test message for persistence!';
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Step 3: Wait for the user message to appear
    const userMessage = authenticatedPage.locator('[data-testid="message-user"]').first();
    await expect(userMessage).toBeVisible({ timeout: 10000 });

    // Verify the user message contains our test text (use getByText to avoid Avatar letter)
    await expect(authenticatedPage.getByText(testMessage)).toBeVisible();

    // Step 4: Wait for assistant response
    // Look for assistant message element (indicates response was received)
    const assistantMessage = authenticatedPage.locator('[data-testid="message-assistant"]').first();
    await expect(assistantMessage).toBeVisible({ timeout: 30000 });

    // Get assistant message content before reload (target Typography, not Avatar)
    const assistantContentBefore = await assistantMessage.locator('.MuiTypography-body1').textContent();
    expect(assistantContentBefore).toBeTruthy();

    // Step 5: Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    // Wait a bit for messages to load from history
    await authenticatedPage.waitForTimeout(1000);

    // Step 6: Verify user message still exists and is still a user message
    const userMessageAfter = authenticatedPage.locator('[data-testid="message-user"]').first();
    await expect(userMessageAfter).toBeVisible({ timeout: 10000 });
    // Use getByText to avoid Avatar letter matching
    await expect(authenticatedPage.getByText(testMessage)).toBeVisible();

    // Step 7: Verify assistant message still exists and is still an assistant message
    const assistantMessageAfter = authenticatedPage.locator('[data-testid="message-assistant"]').first();
    await expect(assistantMessageAfter).toBeVisible({ timeout: 10000 });

    // Verify the assistant message content is preserved (target Typography, not Avatar)
    const assistantContentAfter = await assistantMessageAfter.locator('.MuiTypography-body1').textContent();
    expect(assistantContentAfter).toBeTruthy();
    expect(assistantContentAfter).toBe(assistantContentBefore);
  });

  test('should preserve multiple messages after page reload', async ({ authenticatedPage, createSession }) => {
    // Step 1: Create a session
    await createSession();

    // Step 2: Send first user message
    const firstMessage = 'First test message';
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(firstMessage);
    await promptInput.press('Enter');

    // Wait for first user message
    await expect(authenticatedPage.getByText(firstMessage)).toBeVisible({ timeout: 10000 });

    // Wait for first assistant response
    await expect(authenticatedPage.locator('[data-testid="message-assistant"]').first()).toBeVisible({ timeout: 30000 });

    // Step 3: Send second user message
    const secondMessage = 'Second test message';
    await promptInput.fill(secondMessage);
    await promptInput.press('Enter');

    // Wait for second user message
    await expect(authenticatedPage.getByText(secondMessage)).toBeVisible({ timeout: 10000 });

    // Wait for second assistant response
    const assistantMessages = authenticatedPage.locator('[data-testid="message-assistant"]');
    await expect(assistantMessages.last()).toBeVisible({ timeout: 30000 });

    // Step 4: Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    // Wait for messages to load from history
    await authenticatedPage.waitForTimeout(1000);

    // Step 5: Verify both user messages are preserved by checking specific text
    await expect(authenticatedPage.getByText(firstMessage)).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.getByText(secondMessage)).toBeVisible({ timeout: 10000 });

    // Step 6: Verify at least 2 assistant messages are preserved
    await expect(assistantMessages).toHaveCount(2, { timeout: 10000 });
  });
});
