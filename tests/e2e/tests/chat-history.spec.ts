import { test, expect } from '../fixtures/test-fixtures';

/**
 * E2E Tests for Persisted Session History (issue #170)
 *
 * The conversation pane must hydrate from persisted storage
 * (messages.jsonl via `get-history`), not the server's in-memory buffer.
 *
 * NOTE on E2E/dev storage cross-talk: E2E sessions share the same
 * `.cycledesign/sessions/` dir as dev sessions, so every test uses a fresh
 * session plus a unique message string and asserts only its own rows.
 *
 * The session-switch test below is the discriminating regression test: a
 * `page.reload()` alone is NOT sufficient proof, because reload keeps the
 * same server process (and its in-memory buffer) alive — the old code would
 * pass a reload-only test as a false positive. Switching to a fresh session
 * fails on the old code (the pane keeps showing the previous session's
 * rows) and passes only when hydration is per-session from storage.
 */
test.describe('Persisted Session History with Mock Provider', () => {

  test('should hydrate persisted history when switching sessions', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider for deterministic responses
    await useMockProvider();
    await createSession();

    // Unique, short (<50 chars so the session label contains it in full)
    // and free of mock tool-call keywords (create/edit/update/hello world).
    const sessionAMessage = `persist check ${Date.now()}`;
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    const chatPanel = authenticatedPage.getByTestId('chat-panel');

    // Send message in session A
    await promptInput.fill(sessionAMessage);
    await promptInput.press('Enter');

    // Verify message appears and input is re-enabled after response
    await expect(chatPanel).toContainText(sessionAMessage);
    await expect(promptInput).toBeEnabled();

    // A fresh session must start with an empty pane (no cross-session leak)
    await createSession();
    await expect(chatPanel).not.toContainText(sessionAMessage);

    // Switch back to session A via the session select: the persisted
    // history (user turn + mock assistant reply) must re-render.
    await authenticatedPage.locator('[data-testid="session-select"] [role="combobox"]').click();
    const sessionAOption = authenticatedPage.locator('[role="option"]', { hasText: sessionAMessage });
    await expect(sessionAOption).toBeVisible({ timeout: 15000 });
    await sessionAOption.click();
    await expect(chatPanel).toContainText(sessionAMessage);
    await expect(chatPanel).toContainText('mock response');
  });

  test('should render persisted history after page reload', async ({
    authenticatedPage,
    createSession,
    useMockProvider,
  }) => {
    // Switch to mock provider for deterministic responses
    await useMockProvider();
    await createSession();

    const reloadMessage = `reload check ${Date.now()}`;
    const promptInput = authenticatedPage.getByTestId('prompt-input');
    const chatPanel = authenticatedPage.getByTestId('chat-panel');

    // Send message
    await promptInput.fill(reloadMessage);
    await promptInput.press('Enter');
    await expect(chatPanel).toContainText(reloadMessage);
    await expect(promptInput).toBeEnabled();

    // Reload: the same session's persisted history must re-render
    // (served from storage via get-history, not the in-memory buffer).
    await authenticatedPage.reload();
    await authenticatedPage.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });
    await expect(authenticatedPage.getByTestId('chat-panel')).toContainText(reloadMessage, { timeout: 15000 });
  });
});
