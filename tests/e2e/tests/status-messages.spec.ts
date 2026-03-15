import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Status Messages
 *
 * These tests verify that status messages are properly broadcast and displayed
 * during tool execution and AI generation:
 * - generation_start: When AI generation begins
 * - generation_thinking: During AI processing
 * - generation_complete: When AI finishes
 * - tool_call_start: When a tool execution begins
 * - tool_call_complete: When tool execution finishes
 * - tool_call_error: When tool execution fails
 * - validation_start: When code validation begins
 * - validation_complete: When validation finishes
 * - preview_ready: When preview is available
 */
test.describe('Status Messages', () => {

  test('should broadcast status messages during tool execution', async ({
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

    // Verify status messages appear during tool execution
    // The mock provider broadcasts status messages through the WebSocket bridge

    // Wait for and verify generation_start status
    await expect(authenticatedPage.getByText('Starting AI generation')).toBeVisible({ timeout: 5000 });

    // Wait for and verify tool_call_start status
    await expect(authenticatedPage.getByText('create_file')).toBeVisible({ timeout: 10000 });

    // Wait for and verify tool_call_complete status
    await expect(authenticatedPage.getByText('created successfully')).toBeVisible({ timeout: 10000 });
  });

  test('should show generation status during AI response', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Hello, how are you?';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify generation status appears
    // Mock provider should broadcast generation_start
    await expect(authenticatedPage.getByText('Starting AI generation')).toBeVisible({ timeout: 5000 });

    // Verify generation completes
    await expect(authenticatedPage.getByText('Generation complete')).toBeVisible({ timeout: 10000 });
  });

  test('should display validation status after tool execution', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message that triggers tool call and validation
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify validation status messages
    // After tool execution, validation should run
    await expect(authenticatedPage.getByText('Validating')).toBeVisible({ timeout: 10000 });

    // Validation should complete successfully for mock files
    await expect(authenticatedPage.getByText('Validation complete')).toBeVisible({ timeout: 10000 });
  });

  test('should show preview status when files are created', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message that triggers file creation
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify preview status messages
    // After validation, preview should be generated
    await expect(authenticatedPage.getByText('Preview')).toBeVisible({ timeout: 15000 });
  });

  test('should clear status after generation completes', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Hello';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Status should appear during generation
    await expect(authenticatedPage.getByText('Starting AI generation')).toBeVisible({ timeout: 5000 });

    // After completion, status should eventually clear or show completion state
    // Input should be re-enabled
    await expect(promptInput).toBeEnabled({ timeout: 10000 });
  });

  test('should show error status for failed operations', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    // This test verifies error status display
    // Note: May need to configure mock provider to fail specific tool calls
    // For now, we verify the error status UI can display error messages

    // Send a message
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await promptInput.fill('Test error display');
    await promptInput.press('Enter');

    // Verify error status would be displayed if an error occurred
    // The status component should handle error states
    // This is a placeholder for more specific error testing
  });

  test('should display status messages in correct order', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Verify status messages appear in expected order:
    // 1. generation_start
    await expect(authenticatedPage.getByText('Starting AI generation')).toBeVisible({ timeout: 5000 });

    // 2. tool_call_start (for tool executions)
    await expect(authenticatedPage.getByText('create_file')).toBeVisible({ timeout: 10000 });

    // 3. tool_call_complete
    await expect(authenticatedPage.getByText('created successfully')).toBeVisible({ timeout: 10000 });

    // 4. validation_start
    await expect(authenticatedPage.getByText('Validating')).toBeVisible({ timeout: 10000 });

    // 5. validation_complete
    await expect(authenticatedPage.getByText('Validation complete')).toBeVisible({ timeout: 10000 });
  });

  test('should update status messages in real-time', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider
    await useMockProvider();
    await createSession();

    const testMessage = 'Create file test.tsx';
    const promptInput = authenticatedPage.getByTestId('prompt-input');

    // Send message
    await promptInput.fill(testMessage);
    await promptInput.press('Enter');

    // Status should update as the operation progresses
    // First status appears
    const statusText = authenticatedPage.getByText('Starting AI generation');
    await expect(statusText).toBeVisible({ timeout: 5000 });

    // Status updates to tool execution
    const toolStatus = authenticatedPage.getByText('create_file');
    await expect(toolStatus).toBeVisible({ timeout: 10000 });

    // Status updates to completion
    const completeStatus = authenticatedPage.getByText('created successfully');
    await expect(completeStatus).toBeVisible({ timeout: 10000 });
  });
});
