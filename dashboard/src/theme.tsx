import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';
type Resolved = 'dark' | 'light';

const STORAGE_KEY = 'nexuswatch.theme';

/** Pure: which theme a preference resolves to, given whether the OS prefers dark. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): Resolved {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

function readPreference(): ThemePreference {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark';
}

const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

interface ThemeContextValue {
  preference: ThemePreference;
  theme: Resolved;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => systemQuery()?.matches ?? true);

  useEffect(() => {
    const mq = systemQuery();
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setPreference: (p) => {
        localStorage.setItem(STORAGE_KEY, p);
        setPreferenceState(p);
      },
    }),
    [preference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
