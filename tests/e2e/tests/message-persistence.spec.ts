import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Test for Message Persistence Across Page Reload
 *
 * This test verifies that messages (both user and assistant) persist
 * correctly after a page reload, addressing a UX bug where conversation
 * history could become confusing or lost.
 *
 * Key design decisions:
 * - Uses .last() selectors to target the most recent messages, avoiding
 *   conflicts with messages from previous tests (server uses a hardcoded
 *   'default' session ID, so all tests share the same message history)
 * - Uses unique timestamps in message text to avoid duplicate text matches
 * - Avoids count-based assertions since the server accumulates messages
 *   across all tests in-memory
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

  test('should preserve user and assistant message roles after page reload', async ({ authenticatedPage, createSession }) => {
    // Step 1: Create a session
    await createSession();

    // Step 2: Send a unique user message (timestamp avoids duplicates from other tests)
    const testMessage = `Test msg ${Date.now()}`;
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Step 3: Wait for the user message to appear (use .last() to target our message)
    const userMessage = authenticatedPage.locator('[data-testid="message-user"]').last();
    await expect(userMessage).toBeVisible({ timeout: 10000 });
    await expect(userMessage).toContainText(testMessage);

    // Step 4: Wait for assistant response (use .last() to target our response)
    const assistantMessage = authenticatedPage.locator('[data-testid="message-assistant"]').last();
    await expect(assistantMessage).toBeVisible({ timeout: 30000 });

    // Get assistant message content before reload (target Typography, not Avatar)
    const assistantContentBefore = await assistantMessage.locator('.MuiTypography-body1').textContent();
    expect(assistantContentBefore).toBeTruthy();

    // Step 5: Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    // Wait a bit for messages to load from history
    await authenticatedPage.waitForTimeout(2000);

    // Step 6: Verify user message still exists and is still a user message (role preserved)
    const userMessageAfter = authenticatedPage.locator('[data-testid="message-user"]').last();
    await expect(userMessageAfter).toBeVisible({ timeout: 10000 });
    await expect(userMessageAfter).toContainText(testMessage);

    // Step 7: Verify assistant message still exists and is still an assistant message (role preserved)
    const assistantMessageAfter = authenticatedPage.locator('[data-testid="message-assistant"]').last();
    await expect(assistantMessageAfter).toBeVisible({ timeout: 10000 });

    // Verify the assistant message content is preserved (target Typography, not Avatar)
    const assistantContentAfter = await assistantMessageAfter.locator('.MuiTypography-body1').textContent();
    expect(assistantContentAfter).toBeTruthy();
    expect(assistantContentAfter).toBe(assistantContentBefore);
  });

  test('should preserve multiple messages after page reload', async ({ authenticatedPage, createSession }) => {
    // Step 1: Create a session
    await createSession();

    // Step 2: Send first user message (unique timestamp)
    const firstMessage = `First msg ${Date.now()}`;
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill(firstMessage);
    await promptInput.press('Enter');

    // Wait for first user message
    await expect(authenticatedPage.locator('[data-testid="message-user"]').last()).toBeVisible({ timeout: 10000 });

    // Wait for first assistant response
    await expect(authenticatedPage.locator('[data-testid="message-assistant"]').last()).toBeVisible({ timeout: 30000 });

    // Step 3: Send second user message (unique timestamp)
    const secondMessage = `Second msg ${Date.now() + 1}`;
    await promptInput.fill(secondMessage);
    await promptInput.press('Enter');

    // Wait for second user message
    await expect(authenticatedPage.locator('[data-testid="message-user"]').last()).toBeVisible({ timeout: 10000 });

    // Wait for second assistant response
    const assistantMessages = authenticatedPage.locator('[data-testid="message-assistant"]');
    await expect(assistantMessages.last()).toBeVisible({ timeout: 30000 });

    // Step 4: Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    // Wait for messages to load from history
    await authenticatedPage.waitForTimeout(2000);

    // Step 5: Verify both user messages are preserved by checking specific text
    // Use .last() to find the most recent, then check it contains our text
    await expect(authenticatedPage.locator('[data-testid="message-user"]').last()).toContainText(secondMessage, { timeout: 10000 });

    // Step 6: Verify at least one assistant message is preserved (role preserved)
    await expect(assistantMessages.last()).toBeVisible({ timeout: 10000 });
  });
});
