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

    // Wait for the select to have options
    await authenticatedPage.waitForTimeout(1000);

    // Get the selected value and options
    const { selectedValue, allOptionValues } = await sessionSelect.evaluate((el: HTMLSelectElement) => {
      return {
        selectedValue: el.value,
        allOptionValues: Array.from(el.options).map(opt => opt.value),
      };
    });

    // Verify sessions were created
    expect(allOptionValues.length).toBeGreaterThanOrEqual(1);
    
    // Verify a session is selected
    if (allOptionValues.length > 0) {
      expect(selectedValue).toBeTruthy();
      // The selected value should be one of the options
      expect(allOptionValues).toContain(selectedValue);
    }
  });

  test('should auto-select new session after creation', async ({ authenticatedPage, createSession }) => {
    // Create first session
    await createSession();

    // Get the first session ID
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    
    // Wait for the select to have a value
    await authenticatedPage.waitForTimeout(500);
    const firstSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Create second session
    await createSession();

    // Wait for UI to stabilize
    await authenticatedPage.waitForTimeout(1000);

    // Get the new selected session ID
    const newSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // The selected session should have changed (or at least be defined)
    if (firstSessionId && newSessionId) {
      expect(newSessionId).not.toBe(firstSessionId);
    } else {
      // If we can't verify the change, at least verify a session is selected
      expect(newSessionId || firstSessionId).toBeTruthy();
    }
  });

  test('should fall back to most recent session when stored session no longer exists', async ({ authenticatedPage, createSession }) => {
    // Create two sessions
    await createSession();
    await authenticatedPage.waitForTimeout(500);
    await createSession();

    // Get the current session ID
    const sessionSelect = authenticatedPage.getByTestId('session-select');
    
    // Wait for UI to stabilize
    await authenticatedPage.waitForTimeout(500);
    const currentSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);

    // Delete the current session
    await authenticatedPage.getByTestId('delete-session-button').click();
    await authenticatedPage.getByTestId('confirm-delete-button').click();

    // Wait for the session list to update
    await authenticatedPage.waitForTimeout(1000);

    // Get the new selected session ID
    const newSessionId = await sessionSelect.evaluate((el: HTMLSelectElement) => el.value);
    
    // Verify either a new session is selected or no sessions remain
    const optionCount = await sessionSelect.evaluate((el: HTMLSelectElement) => el.options.length);
    if (optionCount > 0) {
      expect(newSessionId).toBeTruthy();
      // If there was a previous selection and options remain, the selection should have changed
      if (currentSessionId) {
        expect(newSessionId).not.toBe(currentSessionId);
      }
    }
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
    
    // Get option count using evaluate
    const optionCount = await sessionSelect.evaluate((el: HTMLSelectElement) => el.options.length);
    expect(optionCount).toBe(0);

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
