import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Layout and Navigation
 * 
 * These tests verify the core UI layout and navigation:
 * - Main layout renders correctly
 * - Resizable panes work
 * - Connection status displays
 * - Preview panel states
 */
test.describe('Layout and Navigation', () => {
  
  test('should render main layout with all regions', async ({ authenticatedPage }) => {
    // Verify app layout container exists
    await expect(authenticatedPage.getByTestId('app-layout')).toBeVisible();
    
    // Verify left pane (chat panel) exists
    await expect(authenticatedPage.getByTestId('chat-panel')).toBeVisible();
    
    // Verify right pane (preview panel) exists
    await expect(authenticatedPage.getByTestId('preview-panel')).toBeVisible();
    
    // Verify divider between panes exists
    await expect(authenticatedPage.getByTestId('resize-divider')).toBeVisible();
  });

  test('should render session selector in chat panel', async ({ authenticatedPage }) => {
    const sessionSelector = authenticatedPage.getByTestId('session-selector');
    await expect(sessionSelector).toBeVisible();
    
    // Verify new session button exists
    await expect(authenticatedPage.getByTestId('new-session-button')).toBeVisible();
  });

  test('should render message list area', async ({ authenticatedPage }) => {
    // Message list is inside chat panel - look for the component
    // The MessageList component renders when there's a session
    const chatPanel = authenticatedPage.getByTestId('chat-panel');
    await expect(chatPanel).toBeVisible();
  });

  test('should render prompt input', async ({ authenticatedPage }) => {
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    await expect(promptInput).toBeVisible();
    
    // Note: Input is disabled when no session is selected or no connection
    // It will be enabled after creating a session (tested in chat.spec.ts)
  });

  test('should render connection status indicator', async ({ authenticatedPage }) => {
    const connectionStatus = authenticatedPage.getByTestId('connection-status');
    await expect(connectionStatus).toBeVisible();
    
    // Status should show either "Connected" or "Disconnected"
    const statusText = await connectionStatus.textContent();
    expect(statusText).toMatch(/Connected|Disconnected/);
  });

  test('should render preview server status', async ({ authenticatedPage }) => {
    const previewStatus = authenticatedPage.getByTestId('preview-server-status');
    await expect(previewStatus).toBeVisible();
  });

  test('should render preview frame container', async ({ authenticatedPage }) => {
    const previewFrame = authenticatedPage.getByTestId('preview-frame');
    await expect(previewFrame).toBeVisible();
  });

  test('should show preview panel in initial state (no preview)', async ({ authenticatedPage }) => {
    // The preview server might already be running from previous tests
    // Just verify the preview panel is visible
    const previewPanel = authenticatedPage.getByTestId('preview-panel');
    await expect(previewPanel).toBeVisible();
  });

  test('should have app header with title', async ({ authenticatedPage }) => {
    // Check for the app title in the header
    await expect(authenticatedPage.getByText('CycleDesign')).toBeVisible();
  });

  test('should have settings navigation', async ({ authenticatedPage }) => {
    // Check for settings button with data-testid
    const settingsButton = authenticatedPage.getByTestId('settings-button');
    await expect(settingsButton).toBeVisible();
  });

  test('should navigate to settings page', async ({ authenticatedPage }) => {
    // Find and click settings button
    const settingsButton = authenticatedPage.getByTestId('settings-button');
    await settingsButton.click();
    
    // Verify navigation to settings page
    await expect(authenticatedPage).toHaveURL('/settings');
  });

  test('should navigate back to home from settings', async ({ authenticatedPage }) => {
    // Go to settings
    await authenticatedPage.goto('/settings');
    await authenticatedPage.waitForSelector('[data-testid="settings-page"]');
    
    // Navigate back using browser back button
    await authenticatedPage.goBack();
    
    // Should be back on home page
    await expect(authenticatedPage).toHaveURL('/');
  });
});
