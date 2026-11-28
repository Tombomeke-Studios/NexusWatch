import { ConnectionBanner } from './ConnectionBanner';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsNarrow } from '@/lib/useMediaQuery';
import { useTheme } from '@/theme';
import { MobileTabBar, MobileTopBar } from './MobileNav';
import { Sidebar } from './Sidebar';

function Background() {
  return (
    <div className="bgl" aria-hidden="true">
      <div className="grid" />
      <div className="au au1" />
      <div className="au au2" />
    </div>
  );
}

/** Keeps the browser / installed-app chrome (`theme-color`) on the page background of the active theme. */
function useThemeColor() {
  const { theme } = useTheme();
  useEffect(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (!bg) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = bg;
  }, [theme]);
}

/**
 * Every page renders inside this. Wider than 820px: sticky sidebar + page.
 * Narrower: top bar, page, bottom tab bar (see `MobileNav`). Only one of the two navs is mounted.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const narrow = useIsNarrow();
  useThemeColor();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);

  return (
    <>
      <Background />
      <div className={`shell${narrow ? ' mobile' : ''}`}>
        {narrow ? <MobileTopBar /> : <Sidebar />}
        <main className="main" id="main">
          <ConnectionBanner />
          <Outlet />
        </main>
        {narrow && <MobileTabBar />}
      </div>
    </>
  );
}
