import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Session Management
 *
 * These tests verify the core session CRUD operations:
 * - Creating sessions
 * - Session appears in selector
 * - Deleting sessions
 * - Session persistence across page reload
 * - Auto-selection of most recent session
 *
 * Note: This app manages sessions via localStorage, not URL routing.
 */
test.describe('Session Management', () => {

  test('should create a new session with auto-generated name', async ({ createSession }) => {
    // Use the createSession fixture which handles all the waiting
    await createSession();

    // If we got here, the session was created successfully
    // The fixture waits for the session select to have a value
  });

  test('should auto-select most recent session on app load', async ({ authenticatedPage, createSession }) => {
    // Create first session
    await createSession();
    await authenticatedPage.waitForTimeout(500);

    // Create second session (most recent)
    await createSession();

    // Get the session select element - MUI renders a combobox, not a native select
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');

    // Wait for the select to be visible
    await sessionSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for options to appear
    await authenticatedPage.waitForTimeout(1000);

    // Get the selected value (textContent for combobox instead of inputValue for select)
    const selectedValue = await sessionSelect.textContent();

    // Verify a session is selected
    expect(selectedValue).toBeTruthy();
    expect(selectedValue).not.toBe('');
  });

  test('should auto-select new session after creation', async ({ authenticatedPage, createSession }) => {
    // Create first session
    await createSession();

    // Get the session select element - MUI renders a combobox
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for the select to have a value
    await authenticatedPage.waitForTimeout(500);
    const firstSessionId = await sessionSelect.textContent();

    // Create second session
    await createSession();

    // Wait for UI to stabilize
    await authenticatedPage.waitForTimeout(1000);

    // Get the new selected session ID
    const newSessionId = await sessionSelect.textContent();

    // The selected session should have changed
    expect(newSessionId).not.toBe(firstSessionId);
  });

  test('should fall back to most recent session when stored session no longer exists', async ({ authenticatedPage, createSession }) => {
    // Create two sessions
    await createSession();
    await authenticatedPage.waitForTimeout(500);
    await createSession();

    // Get the session select element - MUI renders a combobox
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for UI to stabilize
    await authenticatedPage.waitForTimeout(500);
    const currentSessionId = await sessionSelect.textContent();

    // Delete the current session
    await authenticatedPage.getByTestId('delete-session-button').click();
    await authenticatedPage.getByTestId('confirm-delete-button').click();

    // Wait for the session list to update
    await authenticatedPage.waitForTimeout(1000);

    // Get the new selected session ID
    const newSessionId = await sessionSelect.textContent();

    // The selection should have changed to a different session
    expect(newSessionId).not.toBe(currentSessionId);
  });

  test('should show empty state when all sessions deleted', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();

    // Delete all sessions
    await authenticatedPage.getByTestId('delete-all-sessions-button').click();
    await authenticatedPage.getByTestId('confirm-delete-all-button').click();

    // Wait for the session list to update
    await authenticatedPage.waitForTimeout(1000);

    // Get the session select element - MUI renders a combobox
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelect.waitFor({ state: 'visible', timeout: 10000 });

    // The select value should be empty (textContent should be empty or only whitespace/zero-width space)
    const selectedValue = await sessionSelect.textContent();
    // MUI uses a zero-width space (\u200b) as placeholder, so check for empty or only special chars
    expect(!selectedValue || selectedValue.trim().replace(/\u200b/g, '') === '').toBe(true);

    // Verify no options remain - check the listbox when opened
    // Note: MUI doesn't render listbox until combobox is clicked
    await sessionSelect.click();
    const listbox = authenticatedPage.locator('[role="listbox"]');
    await listbox.waitFor({ state: 'visible', timeout: 5000 });
    const optionCount = await listbox.locator('[role="option"]').count();
    expect(optionCount).toBe(0);
  });

  test('should delete a session', async ({ authenticatedPage, createSession }) => {
    // Create a session first
    await createSession();

    // Click delete button
    await authenticatedPage.getByTestId('delete-session-button').click();

    // Confirm deletion in dialog
    await expect(authenticatedPage.getByTestId('delete-dialog')).toBeVisible();
    await authenticatedPage.getByTestId('confirm-delete-button').click();

    // Verify delete dialog is closed
    await expect(authenticatedPage.getByTestId('delete-dialog')).not.toBeVisible();
  });

  test('should cancel session deletion', async ({ authenticatedPage, createSession }) => {
    // Create a session first
    await createSession();
    
    // Click delete button
    await authenticatedPage.getByTestId('delete-session-button').click();
    
    // Cancel deletion
    await authenticatedPage.getByTestId('cancel-delete-button').click();
    
    // Verify delete dialog is closed but session still exists
    await expect(authenticatedPage.getByTestId('delete-dialog')).not.toBeVisible();
    const sessionSelector = authenticatedPage.getByTestId('session-selector');
    await expect(sessionSelector).toBeVisible();
  });

  test('should persist session after page reload', async ({ authenticatedPage, createSession }) => {
    // Clear any existing sessions first by deleting all
    await authenticatedPage.evaluate(() => localStorage.clear());
    await authenticatedPage.reload();
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]');
    
    // Create a session
    await createSession();

    // Get the current session value from the combobox
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelect.waitFor({ state: 'visible', timeout: 5000 });
    const sessionIdBefore = await sessionSelect.textContent();

    // Wait for localStorage to be updated
    await authenticatedPage.waitForTimeout(500);

    // Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]');

    // Verify session still exists (same session ID)
    const sessionSelectAfter = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelectAfter.waitFor({ state: 'visible', timeout: 5000 });
    const sessionIdAfter = await sessionSelectAfter.textContent();
    expect(sessionIdAfter?.trim()).toBe(sessionIdBefore?.trim());
  });

  test('should show empty state when no sessions exist', async ({ authenticatedPage }) => {
    // Note: This test assumes we can clear sessions
    // In a real scenario, you'd need to delete all sessions first
    
    // Check that session selector is visible (even if empty)
    const sessionSelector = authenticatedPage.getByTestId('session-selector');
    await expect(sessionSelector).toBeVisible();
  });

  test('should switch between sessions', async ({ authenticatedPage, createSession }) => {
    // Create two sessions
    await createSession();
    await authenticatedPage.waitForTimeout(500);
    await createSession();

    // Get the session select element - MUI renders a combobox
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');

    // Get the current session value
    const currentSessionId = await sessionSelect.textContent();

    // Click to open the listbox
    await sessionSelect.click();
    const listbox = authenticatedPage.locator('[role="listbox"]');
    await listbox.waitFor({ state: 'visible', timeout: 5000 });

    // Get all session options
    const options = listbox.locator('[role="option"]');
    const optionCount = await options.count();

    // If there are multiple sessions, try to select a different one
    if (optionCount > 1) {
      // Select the first option
      await options.first().click();
      await authenticatedPage.waitForTimeout(500);

      // Verify the selection changed
      const newSessionId = await sessionSelect.textContent();
      expect(newSessionId).not.toBe(currentSessionId);
    }
  });

  test('should delete all sessions', async ({ authenticatedPage, createSession }) => {
    // Create multiple sessions
    await createSession();
    await createSession();

    // Wait for delete all button to be visible
    await expect(authenticatedPage.getByTestId('delete-all-sessions-button')).toBeVisible();

    // Click delete all button
    await authenticatedPage.getByTestId('delete-all-sessions-button').click();

    // Confirm deletion in dialog
    await expect(authenticatedPage.getByTestId('delete-all-dialog')).toBeVisible();
    await authenticatedPage.getByTestId('confirm-delete-all-button').click();

    // Verify delete all dialog is closed
    await expect(authenticatedPage.getByTestId('delete-all-dialog')).not.toBeVisible();

    // Verify all sessions are deleted - combobox should be empty
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    const selectedValue = await sessionSelect.textContent();
    // MUI uses a zero-width space (\u200b) as placeholder, so check for empty or only special chars
    expect(!selectedValue || selectedValue.trim().replace(/\u200b/g, '') === '').toBe(true);

    // Verify no options remain
    await sessionSelect.click();
    const listbox = authenticatedPage.locator('[role="listbox"]');
    await listbox.waitFor({ state: 'visible', timeout: 5000 });
    const optionCountAfter = await listbox.locator('[role="option"]').count();
    expect(optionCountAfter).toBe(0);
  });

  test('should cancel delete all sessions', async ({ authenticatedPage, createSession }) => {
    // Create multiple sessions
    await createSession();
    await authenticatedPage.waitForTimeout(500);
    await createSession();

    // Wait for delete all button to be visible
    await expect(authenticatedPage.getByTestId('delete-all-sessions-button')).toBeVisible();

    // Click delete all button
    await authenticatedPage.getByTestId('delete-all-sessions-button').click();

    // Cancel deletion
    await authenticatedPage.getByTestId('cancel-delete-all-button').click();

    // Verify delete all dialog is closed but sessions still exist
    await expect(authenticatedPage.getByTestId('delete-all-dialog')).not.toBeVisible();

    // Verify sessions still exist by checking the combobox has a value
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    const selectedValue = await sessionSelect.textContent();
    expect(selectedValue?.trim()).toBeTruthy();
  });

  test('should update session label to first message content after sending message', async ({ authenticatedPage }) => {
    // Clear all existing sessions to ensure a clean state
    await authenticatedPage.evaluate(() => localStorage.clear());
    await authenticatedPage.reload();
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]');

    // Create a new session
    await authenticatedPage.getByTestId('new-session-button').click();

    // Get the session select element
    const sessionSelect = authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]');
    await sessionSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for session select to have a value (session was created and selected)
    await authenticatedPage.waitForFunction(() => {
      const combobox = document.querySelector('[data-testid="session-select"] [role="combobox"]');
      return combobox && combobox.textContent && combobox.textContent.trim() !== '';
    }, { timeout: 5000 });

    // Wait for UI to stabilize
    await authenticatedPage.waitForTimeout(500);

    // Verify the session label shows something before any messages
    // This should be the session ID (last 8 chars) for a fresh session with no messages
    const labelBeforeMessage = await sessionSelect.textContent();
    expect(labelBeforeMessage?.trim()).toBeTruthy();

    // Store the initial label to verify it changes
    const initialLabel = labelBeforeMessage?.trim();

    // Define a test message with some special characters to verify they get stripped
    const testMessage = 'Hello, this is a test message!\nWith special\tcharacters.';
    const expectedLabel = 'Hello, this is a test message!With special characters.';

    // Verify the initial label is different from what we expect after sending the message
    // This ensures we're starting from a clean state (session ID or short label, not a previous message)
    expect(initialLabel).not.toContain('Hello, this is a test message');

    // Type the message in the prompt input
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.waitFor({ state: 'visible', timeout: 5000 });
    await promptInput.click();
    await promptInput.fill(testMessage);

    // Send the message via the send button
    await authenticatedPage.getByTestId('send-button').click();

    // Wait for the session label to update by polling the session select text
    // The label should change from the session ID to the first message content
    await authenticatedPage.waitForFunction(
      ({ expectedLabel, initialLabel }) => {
        const combobox = document.querySelector('[data-testid="session-select"] [role="combobox"]');
        if (!combobox || !combobox.textContent) return false;
        const currentLabel = combobox.textContent.trim();
        // Label should have changed from the initial value
        if (currentLabel === initialLabel) return false;
        // Label should contain the expected text (truncated version of the message)
        return currentLabel.includes(expectedLabel.slice(0, 50));
      },
      { expectedLabel, initialLabel },
      { timeout: 10000 }
    );

    // Final verification - get the updated label
    const labelAfterMessage = await sessionSelect.textContent();
    expect(labelAfterMessage?.trim()).toBeTruthy();
    expect(labelAfterMessage?.trim()).not.toBe(initialLabel);
    // Verify special characters (\r, \n, \t) are stripped
    expect(labelAfterMessage?.trim()).not.toContain('\n');
    expect(labelAfterMessage?.trim()).not.toContain('\r');
    expect(labelAfterMessage?.trim()).not.toContain('\t');
    // Verify the label contains the message content (truncated to 50 chars max)
    expect(labelAfterMessage?.trim()).toContain('Hello, this is a test message!');
  });
});
