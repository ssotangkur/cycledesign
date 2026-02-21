/**
 * Compute session display label from first message or session ID
 * @param firstMessage - First user message content (from backend)
 * @param sessionId - Session ID (fallback if no first message)
 * @returns Display label (truncated to 50 chars, cleaned)
 */
export function computeSessionLabel(firstMessage: string | null, sessionId: string): string {
  if (firstMessage) {
    const truncated = firstMessage.slice(0, 50);
    const cleaned = truncated.replace(/[^\w\s\u4e00-\u9fff]/gi, '').trim();
    return cleaned || sessionId.slice(-8);
  }
  return sessionId.slice(-8);
}
