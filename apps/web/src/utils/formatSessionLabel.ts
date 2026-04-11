/**
 * Format a session label from the first message content or session ID.
 *
 * - If firstMessage is null/empty, returns last 8 characters of sessionId
 * - Strips special characters (\r, \n, \t)
 * - Trims whitespace
 * - Truncates to 50 characters max with "..." ellipsis if truncated
 */
export function formatSessionLabel(firstMessage: string | null, sessionId: string): string {
  // Fallback to session ID if no message
  if (!firstMessage || firstMessage.trim() === '') {
    return sessionId.slice(-8);
  }

  // Strip special characters and trim
  const cleaned = firstMessage.replace(/[\r\n\t]/g, '').trim();

  // Truncate with ellipsis if needed
  const maxLength = 50;
  if (cleaned.length > maxLength) {
    return `${cleaned.slice(0, maxLength)}...`;
  }

  return cleaned;
}
