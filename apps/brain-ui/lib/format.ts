/** Format a 0..1 confidence as a percentage string for the reasoning panel. */
export function formatConfidence(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `${Math.round(clamped * 100)}%`;
}
