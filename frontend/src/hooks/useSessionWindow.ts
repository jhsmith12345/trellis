import { useEffect, useState } from "react";
import { isInSessionWindow } from "../lib/sessionWindow";

/**
 * Returns true when the current time is within the joinable window
 * (10 min before start → 30 min after end). Re-checks every 60 s.
 */
export function useSessionWindow(
  scheduledAt: string,
  durationMinutes: number,
): boolean {
  const [inWindow, setInWindow] = useState(() =>
    isInSessionWindow(scheduledAt, durationMinutes),
  );

  useEffect(() => {
    const check = () => setInWindow(isInSessionWindow(scheduledAt, durationMinutes));
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [scheduledAt, durationMinutes]);

  return inWindow;
}

/**
 * Forces a re-render every 60 s so that inline `isInSessionWindow()` calls
 * stay current in list views where per-item hooks aren't possible.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}
