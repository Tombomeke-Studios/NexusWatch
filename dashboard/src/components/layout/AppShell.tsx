import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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

/** Sidebar + page outlet. Every authenticated page renders inside this. */
export function AppShell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);

  return (
    <>
      <Background />
      <div className="shell">
        <Sidebar />
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
