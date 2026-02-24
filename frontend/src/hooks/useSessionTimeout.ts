/**
 * HIPAA Session Timeout Hook
 *
 * Enforces a 15-minute inactivity timeout as required by HIPAA Technical
 * Safeguards (Access Control - Automatic Logoff, 45 CFR 164.312(a)(2)(iii)).
 *
 * Behavior:
 *   - Tracks mouse, keyboard, touch, and scroll events as "activity"
 *   - After 13 minutes of inactivity: sets `showWarning = true`
 *   - After 15 minutes of inactivity: signs out via Firebase and redirects to /
 *   - Any user activity resets the inactivity timer
 *   - The warning modal can be dismissed (which also resets the timer)
 *
 * Usage:
 *   const { showWarning, dismissWarning, remainingSeconds } = useSessionTimeout();
 *   // Render a warning modal when showWarning is true
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { logOut } from "../lib/firebase";

const TIMEOUT_MS = 15 * 60 * 1000;        // 15 minutes
const WARNING_MS = 13 * 60 * 1000;        // 13 minutes — show warning
const TICK_INTERVAL_MS = 1000;             // Update countdown every second

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "scroll",
  "click",
];

// Throttle activity resets to avoid excessive timer resets
const THROTTLE_MS = 5000;

export function useSessionTimeout() {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(
    Math.floor((TIMEOUT_MS - WARNING_MS) / 1000)
  );

  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const throttleRef = useRef(0);
  const showWarningRef = useRef(false);
  showWarningRef.current = showWarning;

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const performLogout = useCallback(async () => {
    clearTimers();
    try {
      await logOut();
    } catch {
      // Best-effort logout
    }
    navigate("/", { replace: true });
  }, [clearTimers, navigate]);

  const startTimers = useCallback(() => {
    clearTimers();
    setShowWarning(false);

    lastActivityRef.current = Date.now();

    // Warning at 13 minutes
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(Math.floor((TIMEOUT_MS - WARNING_MS) / 1000));

      // Start countdown ticker
      tickRef.current = setInterval(() => {
        const elapsed = Date.now() - lastActivityRef.current;
        const remaining = Math.max(0, Math.floor((TIMEOUT_MS - elapsed) / 1000));
        setRemainingSeconds(remaining);
      }, TICK_INTERVAL_MS);
    }, WARNING_MS);

    // Auto-logout at 15 minutes
    logoutTimerRef.current = setTimeout(() => {
      performLogout();
    }, TIMEOUT_MS);
  }, [clearTimers, performLogout]);

  const handleActivity = useCallback(() => {
    const now = Date.now();
    // Throttle: only reset timers if enough time has passed since last reset
    if (now - throttleRef.current < THROTTLE_MS) return;
    throttleRef.current = now;

    // Don't reset if warning is showing — user must explicitly dismiss
    if (showWarningRef.current) return;

    startTimers();
  }, [startTimers]);

  const dismissWarning = useCallback(() => {
    // User acknowledged the warning — reset everything
    startTimers();
  }, [startTimers]);

  // Set up activity listeners
  useEffect(() => {
    startTimers();

    const handler = () => handleActivity();

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, handler, { passive: true });
    }

    return () => {
      clearTimers();
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, handler);
      }
    };
  }, [startTimers, handleActivity, clearTimers]);

  return {
    /** Whether the inactivity warning modal should be shown */
    showWarning,
    /** Dismiss the warning and reset the inactivity timer */
    dismissWarning,
    /** Seconds remaining before auto-logout (only meaningful when showWarning is true) */
    remainingSeconds,
    /** Manually trigger logout (e.g. from the warning modal) */
    logoutNow: performLogout,
  };
}
