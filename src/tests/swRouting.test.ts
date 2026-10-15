import { describe, expect, it } from "vitest";
import { precacheName, routeRequest, staleCacheNames } from "../pwa/swRouting";

const scope = {
  origin: "https://poker.example",
  base: "/",
  precached: new Set(["/", "/assets/index-Ab12.js", "/assets/HistoryTrends-Cd34.js", "/manifest.webmanifest"])
};

function route(url: string, init: { method?: string; mode?: string } = {}) {
  return routeRequest({ url, method: init.method ?? "GET", mode: init.mode ?? "cors" }, scope);
}

describe("service worker routing", () => {
  it("falls back to the precached app shell for any page load", () => {
    expect(route("https://poker.example/", { mode: "navigate" })).toEqual({ kind: "navigate", fallbackUrl: "/" });
    expect(route("https://poker.example/room/abc?x=1", { mode: "navigate" })).toEqual({ kind: "navigate", fallbackUrl: "/" });
  });

  it("serves build files, including lazy chunks, from the precache", () => {
    expect(route("https://poker.example/assets/index-Ab12.js")).toEqual({ kind: "precache", cacheKey: "/assets/index-Ab12.js" });
    expect(route("https://poker.example/assets/HistoryTrends-Cd34.js")).toEqual({
      kind: "precache",
      cacheKey: "/assets/HistoryTrends-Cd34.js"
    });
    expect(route("https://poker.example/manifest.webmanifest", { mode: "same-origin" }).kind).toBe("precache");
  });

  it("leaves Convex, other origins, writes, and unknown files to the network", () => {
    expect(route("https://happy-otter-123.convex.cloud/api/query", { method: "POST" }).kind).toBe("bypass");
    expect(route("https://happy-otter-123.convex.cloud/api/1.0/sync").kind).toBe("bypass");
    expect(route("https://cdn.example/assets/index-Ab12.js").kind).toBe("bypass");
    expect(route("https://poker.example/", { method: "POST", mode: "navigate" }).kind).toBe("bypass");
    expect(route("https://poker.example/assets/old-Zz99.js").kind).toBe("bypass");
    expect(route("https://poker.example/assets/index-Ab12.js?v=2").kind).toBe("bypass");
  });

  it("versions the cache and clears only this app's older caches", () => {
    const current = precacheName("abc123");
    expect(current).toBe("poker-tracker-precache-abc123");
    expect(staleCacheNames(["poker-tracker-shell-v1", "poker-tracker-precache-old", current, "other-app"], current)).toEqual([
      "poker-tracker-shell-v1",
      "poker-tracker-precache-old"
    ]);
  });
});
