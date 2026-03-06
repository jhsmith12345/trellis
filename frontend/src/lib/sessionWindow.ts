/**
 * Determines whether "now" falls within the joinable window for a session.
 * Window: 10 minutes before start → 30 minutes after scheduled end.
 */
export function isInSessionWindow(
  scheduledAt: string,
  durationMinutes: number,
): boolean {
  const now = Date.now();
  const start = new Date(scheduledAt).getTime();
  const windowOpen = start - 10 * 60_000;
  const windowClose = start + (durationMinutes + 30) * 60_000;
  return now >= windowOpen && now <= windowClose;
}
