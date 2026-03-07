# CycleDesign E2E Tests

End-to-end tests for CycleDesign using Playwright.

## Setup

### Install Dependencies

```bash
npm install
```

### Install Playwright Browsers

```bash
npm run install:e2e:browsers
```

This installs Chromium browser for testing.

## Running Tests

### Run All Tests (Headless)

```bash
npm run test:e2e
```

### Run Tests with UI

```bash
npm run test:e2e:ui
```

Opens the Playwright UI for interactive test exploration.

### Run Tests in Debug Mode

```bash
npm run test:e2e:debug
```

Runs tests with browser visible and DevTools available.

### Run Tests in Headed Mode

```bash
npm run test:e2e:headed
```

Runs tests with visible browser (not debug mode).

### Run Specific Test File

```bash
npx playwright test tests/sessions.spec.ts
```

### Run Specific Test by Name

```bash
npx playwright test -g "should create a new session"
```

### Run with Specific Browser

```bash
npx playwright test --project=chromium
```

## Test Structure

### Fixtures

- `authenticatedPage` - Page fixture that waits for app hydration
- `createSession(name?)` - Helper to create a session, returns session ID
- `deleteAllSessions()` - Helper to clean up sessions

### Test Files

- `tests/sessions.spec.ts` - Session CRUD operations
- `tests/layout.spec.ts` - Layout rendering and resizing
- `tests/chat.spec.ts` - Chat panel interactions

## Writing Tests

```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Feature Name', () => {
  test('should do something', async ({ authenticatedPage, createSession }) => {
    // Navigate and interact
    await authenticatedPage.goto('/');
    await createSession('Test Session');
    
    // Assertions
    await expect(authenticatedPage.getByTestId('some-element')).toBeVisible();
  });
});
```

## Test Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

Reports are saved to `playwright-report/`.

## CI/CD

Tests run automatically in GitHub Actions on pull requests to `main`.

The CI workflow:
1. Installs dependencies
2. Installs Playwright browsers with system dependencies
3. Starts dev servers
4. Runs tests in headless mode
5. Uploads test artifacts on failure

## Debugging

### Using Debug Mode

```bash
npm run test:e2e:debug
```

This opens Playwright's debug UI where you can:
- Step through tests
- Inspect elements
- View console logs
- Take screenshots

### Using VS Code

Install the [Playwright Test for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) extension for:
- Run tests directly from editor
- Debug with breakpoints
- View test results inline

### Common Issues

**Tests fail with timeout:**
- Increase timeout in playwright.config.ts
- Check if dev servers are running
- Verify test selectors exist

**Tests fail in CI but pass locally:**
- CI runs headless - ensure elements are visible without focus
- Check for race conditions with proper waitFor selectors
- Use `data-testid` attributes for stable selectors

## Adding Test IDs to Components

Add `data-testid` attributes to interactive elements:

```tsx
<button data-testid="new-session-button">New Session</button>
<input data-testid="prompt-input" />
<div data-testid="message-list">{messages}</div>
```

## Limitations

### LLM Responses

Current tests do NOT assert on LLM response content because:
- LLM output is non-deterministic
- Rate limits would affect CI reliability
- OAuth flow adds complexity

**Future:** Implement LLM mocking for full chat flow testing.

### Preview Server

Tests verify preview panel states but don't validate rendered content because:
- Preview requires generated code
- Code generation depends on LLM responses

**Future:** Mock code generation for preview testing.
""  
