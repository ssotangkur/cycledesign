/**
 * Resolve the Tool UI origin for the preview-iframe postMessage bridge.
 *
 * The Tool UI port is offset-aware (see scripts/ports.cjs), so it cannot be
 * hardcoded. Resolution order:
 * 1. VITE_TOOL_URL injected at preview dev/build time by run-with-ports.cjs.
 * 2. document.referrer (the embedding parent page for iframes).
 * 3. Default-offset fallback.
 */
export function resolveToolOrigin(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    const injected = env?.VITE_TOOL_URL;
    if (typeof injected === 'string' && injected !== '') {
      return new URL(injected).origin;
    }
  } catch {
    // Fall through to referrer/default.
  }

  try {
    if (typeof document !== 'undefined' && document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch {
    // Fall through to default.
  }

  return 'http://localhost:3000';
}
