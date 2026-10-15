/**
 * Pure routing and cache-naming rules for the service worker (src/pwa/serviceWorker.ts).
 * Kept free of worker globals so they can be unit tested.
 */

/** Written into the built sw.js by vite-plugins/serviceWorkerPrecache.ts. */
export type PrecacheManifest = {
  /** Hash of every precached file's path and content; changes whenever any of them does. */
  version: string;
  /** Root-relative URLs of every build file, with index.html listed as the base path ("/"). */
  urls: string[];
};

export const CACHE_PREFIX = "poker-tracker-";

export function precacheName(version: string) {
  return `${CACHE_PREFIX}precache-${version}`;
}

/** Caches this app owns that are not the current precache (older builds, the pre-manifest shell cache). */
export function staleCacheNames(names: readonly string[], currentCache: string) {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== currentCache);
}

export type SwRoute =
  /** Leave to the browser: non-GET, cross-origin (Convex, APIs), or not part of the build. */
  | { kind: "bypass" }
  /** Page load: network first, then the precached index.html. */
  | { kind: "navigate"; fallbackUrl: string }
  /** Build file: served from the precache, network only if it is somehow missing. */
  | { kind: "precache"; cacheKey: string };

export type RoutableRequest = { method: string; url: string; mode: string };

export function routeRequest(
  request: RoutableRequest,
  scope: { origin: string; base: string; precached: ReadonlySet<string> }
): SwRoute {
  if (request.method !== "GET") return { kind: "bypass" };
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return { kind: "bypass" };
  if (request.mode === "navigate") return { kind: "navigate", fallbackUrl: scope.base };
  if (!url.search && scope.precached.has(url.pathname)) return { kind: "precache", cacheKey: url.pathname };
  return { kind: "bypass" };
}
