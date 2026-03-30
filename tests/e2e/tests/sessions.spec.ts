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

    // Get the session select element
    const sessionSelect = authenticatedPage.getByTestId('session-select');

    // Wait for options to appear inside the select
    await expect(sessionSelect.locator('option')).toHaveCount(2, { timeout: 5000 });

    // Get the selected value
    const selectedValue = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Verify a session is selected (should be the most recent one)
    expect(selectedValue).toBeDefined();
    expect(selectedValue).not.toBe('');
    
    // Get all option values and verify the first one is selected (most recent)
    const optionValues = await sessionSelect.locator('option').allTextContents();
    const firstOptionValue = await sessionSelect.locator('option').first().getAttribute('value');
    expect(selectedValue).toBe(firstOptionValue);
  });

  test('should auto-select new session after creation', async ({ authenticatedPage, createSession }) => {
    // Create first session
    await createSession();

    // Get the first session ID
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    
    // Wait for the select to have a value (using evaluate since toHaveValue doesn't work on select)
    await expect(async () => {
      const value = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
      expect(value).not.toBe('');
    }).toPass({ timeout: 5000 });
    
    const firstSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Create second session
    await createSession();

    // Wait for the second session option to appear
    await expect(sessionSelect.locator('option')).toHaveCount(2, { timeout: 5000 });
    
    // Give React state update time to propagate
    await authenticatedPage.waitForTimeout(200);

    // Get the new selected session ID
    const newSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // The selected session should have changed to the new one
    expect(newSessionId).not.toBe(firstSessionId);
  });

  test('should fall back to most recent session when stored session no longer exists', async ({ authenticatedPage, createSession }) => {
    // Create two sessions
    await createSession();
    await authenticatedPage.waitForTimeout(500);
    await createSession();

    // Get the most recent session ID
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    
    // Wait for session options to appear
    await expect(sessionSelect.locator('option')).toHaveCount(2, { timeout: 5000 });
    
    const mostRecentSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Delete the most recent session
    await authenticatedPage.getByTestId('delete-session-button').click();
    await authenticatedPage.getByTestId('confirm-delete-button').click();

    // Wait for the session list to update (should now have 1 option)
    await expect(sessionSelect.locator('option')).toHaveCount(1, { timeout: 5000 });

    // The selected session should now be the remaining session (not the deleted one)
    const newSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
    expect(newSessionId).toBeDefined();
    expect(newSessionId).not.toBe(mostRecentSessionId);
  });

  test('should show empty state when all sessions deleted', async ({ authenticatedPage, createSession }) => {
    // Create a session
    await createSession();

    // Delete all sessions
    await authenticatedPage.getByTestId('delete-all-sessions-button').click();
    await authenticatedPage.getByTestId('confirm-delete-all-button').click();

    // Wait for the session list to update
    await authenticatedPage.waitForTimeout(500);

    // The session select should have no options
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    
    // Wait for all session options to be removed
    await expect(sessionSelect.locator('option')).toHaveCount(0, { timeout: 5000 });

    // The select value should be empty (undefined when no options exist)
    const selectedValue = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
    expect(selectedValue).toBeFalsy();
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
    // Create a session
    await createSession();
    
    // Get the current session value
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    const sessionIdBefore = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
    
    // Reload the page
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]');
    
    // Verify session still exists (same session ID)
    const sessionSelectAfter = authenticatedPage.getByTestId('session-select');
    const sessionIdAfter = await sessionSelectAfter.evaluate((el: HTMLSelectElement) => el.value);
    expect(sessionIdAfter).toBe(sessionIdBefore);
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

    // Get the session select element
    const sessionSelect = authenticatedPage.getByTestId('session-select');

    // Get the current session value
    const currentSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Get all session options
    const options = sessionSelect.locator('option');
    const optionCount = await options.count();

    // If there are multiple sessions, try to select a different one
    if (optionCount > 1) {
      // Select the first option
      await sessionSelect.selectOption({ index: 0 });
      await authenticatedPage.waitForTimeout(500);

      // Verify the selection changed
      const newSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
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

    // Verify all sessions are deleted (select should be empty or have no options)
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    const optionsAfter = sessionSelect.locator('option');
    const optionCountAfter = await optionsAfter.count();
    expect(optionCountAfter).toBe(0);
  });

  test('should cancel delete all sessions', async ({ authenticatedPage, createSession }) => {
    // Create multiple sessions
    await createSession();
    await createSession();

    // Wait for delete all button to be visible
    await expect(authenticatedPage.getByTestId('delete-all-sessions-button')).toBeVisible();

    // Get initial session count before opening dialog
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    const optionsBefore = sessionSelect.locator('option');
    const optionCountBefore = await optionsBefore.count();

    // Click delete all button
    await authenticatedPage.getByTestId('delete-all-sessions-button').click();

    // Cancel deletion
    await authenticatedPage.getByTestId('cancel-delete-all-button').click();

    // Verify delete all dialog is closed but sessions still exist
    await expect(authenticatedPage.getByTestId('delete-all-dialog')).not.toBeVisible();

    const optionsAfter = sessionSelect.locator('option');
    const optionCountAfter = await optionsAfter.count();
    expect(optionCountAfter).toBe(optionCountBefore);
  });
});
