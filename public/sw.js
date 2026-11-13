/* ============================================================
   NIGHTRUN — NEON DISTRICT · service worker
   Strategy
   - install : precache EVERY emitted build asset (JS, CSS, HTML,
               manifest, icons). The game needs zero network after.
   - fetch   : cache-first for same-origin assets, with a network
               revalidate in the background; navigations fall back to
               the cached shell so the app launches offline.
   - update  : new cache version, old caches pruned. Progress lives in
               localStorage (not here) so updates never wipe saves.
   ============================================================ */

const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_PREFIX = 'nightrun-';
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

const SHELL_URL = './index.html';
const OFFLINE_URL = './offline.html';

const scopeURL = (path) => new URL(path, self.registration.scope).toString();

/* ---------------- install ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Cache individually so one 404 can never abort the whole install.
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const request = new Request(scopeURL(url), { cache: 'reload' });
          const response = await fetch(request);
          if (!response || !response.ok) throw new Error(`precache miss: ${url}`);
          await cache.put(request, response);
          return url;
        }),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.warn('[sw] precache partial:', failed.map((f) => f.reason?.message));
      }
      const shell = await cache.match(scopeURL(SHELL_URL));
      if (!shell) {
        // Fallback: fetch the shell directly (dev/preview edge cases).
        const res = await fetch(scopeURL('./'), { cache: 'reload' });
        if (res.ok) await cache.put(scopeURL(SHELL_URL), res.clone());
      }
      await self.skipWaiting();
    })(),
  );
});

/* ---------------- activate ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch {
          /* noop */
        }
      }
      await self.clients.claim();
    })(),
  );
});

/* ---------------- message ---------------- */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION' && event.ports?.[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

/* ---------------- fetch ---------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // Range requests (audio/video seeking) — let the browser handle it.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function handleNavigate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const shellUrl = scopeURL(SHELL_URL);
  const rootUrl = scopeURL('./');
  const url = new URL(request.url);

  // Deep links: the built shell uses relative asset paths, so bounce unknown
  // routes back to the app root instead of serving HTML that cannot resolve
  // its own bundles (an important detail when there is no network).
  const hit = await cache.match(request);
  if (!hit && url.pathname !== new URL(shellUrl).pathname && url.pathname !== new URL(rootUrl).pathname) {
    const shellExists = await cache.match(shellUrl);
    if (shellExists) {
      return new Response(null, { status: 302, headers: { Location: rootUrl } });
    }
  }

  const cached = hit || (await cache.match(shellUrl));

  // Offline-first for instant launch; refresh the shell in the background.
  if (cached) {
    fetch(request)
      .then(async (res) => {
        if (res && res.ok) {
          const c = await caches.open(CACHE_VERSION);
          await c.put(scopeURL(SHELL_URL), res.clone());
        }
      })
      .catch(() => {});
    return cached;
  }

  try {
    return await fetch(request);
  } catch {
    const offline = await cache.match(scopeURL(OFFLINE_URL));
    return (
      offline ||
      new Response('<!doctype html><title>NIGHTRUN</title><h1>Offline</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) {
    // Background revalidate (only when we have connectivity).
    fetch(request)
      .then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    const isHtml = request.headers.get('accept')?.includes('text/html');
    if (isHtml) {
      const offline = await cache.match(scopeURL(OFFLINE_URL));
      if (offline) return offline;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
