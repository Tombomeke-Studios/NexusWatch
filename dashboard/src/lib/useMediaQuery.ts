import { useCallback, useSyncExternalStore } from 'react';

/** The one narrow-screen breakpoint. Keep in sync with the `820px` media queries in `app.css`. */
export const NARROW_QUERY = '(max-width: 820px)';

/** Live `matchMedia` result. Without `matchMedia` (jsdom, SSR) it reports `false`: the desktop layout. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}

export const useIsNarrow = () => useMediaQuery(NARROW_QUERY);
