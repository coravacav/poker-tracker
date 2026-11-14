import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` while `active`, so open
 * entries grey out once they expire (the views don't filter by the clock).
 */
export function useNow(active: boolean, intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
