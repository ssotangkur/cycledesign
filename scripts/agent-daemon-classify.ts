/**
 * Gateway-quota vs upstream-transient classifier (KD-3).
 *
 * Normative input is the raw `--format json` line text:
 * - `/Upstream request failed: \[([a-z_]+)\]/` present → upstream
 *   (`rate_limit_exceeded` → `upstream-transient`, other codes → `other`).
 * - else `/Rate limit exceeded/` → `gateway-quota` (fail over).
 * - else → `other` (clean lines, unknown events, non-JSON).
 *
 * Parsed `session.error`-style structured fields (`isRetryable` /
 * `statusCode`) are consulted only when present; absence never blocks
 * classification. Regex-over-line is what drives failover so schema drift
 * cannot silently disable it.
 *
 * #155: the raw-text fallback never applies to `tool_use` envelopes. Tool
 * results embed arbitrary content (whole file contents), so a marker found
 * only there is a false positive — reading agent-daemon-classify.ts fired
 * a failover on its own source. Error-shaped fields stay authoritative for
 * every envelope type (a `tool_use` carrying a real error still counts).
 */

export type LineClass = 'gateway-quota' | 'upstream-transient' | 'other';

const UPSTREAM_RE = /Upstream request failed: \[([a-z_]+)\]/;
const RATE_LIMIT_RE = /Rate limit exceeded/;

function classifyText(text: string): LineClass | null {
  const upstream = UPSTREAM_RE.exec(text);
  if (upstream) {
    return upstream[1] === 'rate_limit_exceeded' ? 'upstream-transient' : 'other';
  }
  if (RATE_LIMIT_RE.test(text)) {
    return 'gateway-quota';
  }
  return null;
}

/** Best-effort structured consult: stringify any `error`-shaped field. */
function structuredHint(rawLine: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ['error', 'session.error', 'data']) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
    }
  }
  // Shallow scan for `{ isRetryable, message }`-style error objects.
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null && 'message' in value) {
      const message = (value as Record<string, unknown>)['message'];
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return null;
}

/** Envelope types whose lines embed arbitrary content (tool results). */
function isToolResult(rawLine: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  return (parsed as Record<string, unknown>)['type'] === 'tool_use';
}

export function classifyLine(rawLine: string): LineClass {
  const hint = structuredHint(rawLine);
  if (hint !== null) {
    const structured = classifyText(hint);
    if (structured !== null) {
      return structured;
    }
  }
  // #155: a marker reachable only via tool-result content is a false
  // positive (file contents, not an error). The hint above already spoke.
  if (isToolResult(rawLine)) {
    return 'other';
  }
  return classifyText(rawLine) ?? 'other';
}
