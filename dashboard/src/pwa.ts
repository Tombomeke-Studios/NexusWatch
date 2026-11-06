/**
 * Registers the app-shell service worker (`public/sw.js`) in production builds only:
 * in dev it would cache Vite's modules and fight hot reload.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unsupported or blocked worker only costs offline start-up; the app works without it.
    });
  });
}
