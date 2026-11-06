import { useEffect, useState } from 'react';

/** The current time in ms, refreshed every `intervalMs` — for countdowns and "in 3:12" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
