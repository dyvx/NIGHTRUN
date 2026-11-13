/**
 * Service worker lifecycle.
 * - Registered only in production builds (the dev server has no precache
 *   manifest, and a half-built SW would poison the cache).
 * - The SW precaches every emitted asset at install, so the very first
 *   successful load is enough to go offline forever after.
 */
export function registerServiceWorker({ onOfflineReady, onUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      const announce = () => {
        if (registration.active) onOfflineReady?.();
      };

      if (registration.waiting) {
        onUpdate?.();
      }
      registration.addEventListener('updatefound', () => {
        const sw = registration.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed') {
            if (navigator.serviceWorker.controller) onUpdate?.();
            else onOfflineReady?.();
          }
        });
      });

      if (navigator.serviceWorker.controller) announce();

      // Ask the active worker whether the cache is populated.
      navigator.serviceWorker.ready.then((reg) => {
        const target = reg.active;
        if (!target) return;
        const channel = new MessageChannel();
        channel.port1.onmessage = () => onOfflineReady?.();
        target.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      });

      // Check for a fresh build every hour while the app is open.
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('[nightrun] service worker registration failed', err);
    }
  };

  // `load` may already have fired by the time the game finishes booting —
  // registering late would leave the app without an offline cache.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
