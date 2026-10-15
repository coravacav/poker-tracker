/// <reference lib="webworker" />
/**
 * Service worker, built to /sw.js by vite-plugins/serviceWorkerPrecache.ts, which also
 * replaces __PRECACHE_MANIFEST__ with the list of every file in the build. Installing
 * caches all of them, so one online visit is enough for the whole app (lazy chunks
 * included) to work offline.
 */
import { precacheName, routeRequest, staleCacheNames, type PrecacheManifest } from "./swRouting";

declare const __PRECACHE_MANIFEST__: PrecacheManifest;
declare const self: ServiceWorkerGlobalScope;

const manifest = __PRECACHE_MANIFEST__;
const cacheName = precacheName(manifest.version);
const base = new URL(self.registration.scope).pathname;
const precached = new Set(manifest.urls);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      try {
        // addAll is all-or-nothing; a failure rejects install so this worker never activates.
        // "no-cache" revalidates against the server instead of trusting the HTTP cache.
        await cache.addAll(manifest.urls.map((url) => new Request(url, { cache: "no-cache" })));
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })()
  );
  // Same update behavior as before: a new worker takes over as soon as its cache is complete.
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const stale = staleCacheNames(await caches.keys(), cacheName);
      await Promise.all(stale.map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

async function fromPrecache(key: string) {
  const cache = await caches.open(cacheName);
  return cache.match(key);
}

self.addEventListener("fetch", (event) => {
  const route = routeRequest(event.request, { origin: self.location.origin, base, precached });
  if (route.kind === "bypass") return;

  if (route.kind === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await fromPrecache(route.fallbackUrl);
        return cached ?? new Response("Offline", { status: 503, statusText: "Offline" });
      })
    );
    return;
  }

  event.respondWith(fromPrecache(route.cacheKey).then((cached) => cached ?? fetch(event.request)));
});
