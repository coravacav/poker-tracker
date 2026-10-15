// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import {
  MANIFEST_PLACEHOLDER,
  createPrecacheManifest,
  injectPrecacheManifest,
  precacheUrl,
  shouldPrecache
} from "./serviceWorkerPrecache";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "sw-precache-"));
  tempDirs.push(dir);
  return dir;
}

function writeFiles(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, root);
    return [relative(root, full).split(sep).join("/")];
  });
}

function manifestIn(swSource: string) {
  const match = swSource.match(/\{"version":"[0-9a-f]+","urls":\[[^\]]*\]\}/);
  if (!match) throw new Error("No manifest in sw.js");
  return JSON.parse(match[0]) as { version: string; urls: string[] };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("precache manifest", () => {
  it("skips the worker, host config files, dot paths, and source maps", () => {
    expect(shouldPrecache("sw.js")).toBe(false);
    expect(shouldPrecache("_headers")).toBe(false);
    expect(shouldPrecache("_redirects")).toBe(false);
    expect(shouldPrecache(".assetsignore")).toBe(false);
    expect(shouldPrecache(".vite/manifest.json")).toBe(false);
    expect(shouldPrecache("assets/index-abc123.js.map")).toBe(false);
    expect(shouldPrecache("assets/index-abc123.js")).toBe(true);
    expect(shouldPrecache("assets/_baseFor-abc123.js")).toBe(true);
    expect(shouldPrecache("assets/sw.js")).toBe(true);
  });

  it("serves index.html as the base path", () => {
    expect(precacheUrl("index.html")).toBe("/");
    expect(precacheUrl("assets/a.js")).toBe("/assets/a.js");
    expect(precacheUrl("index.html", "/app")).toBe("/app/");
    expect(precacheUrl("assets/a.js", "/app/")).toBe("/app/assets/a.js");
  });

  it("is sorted, deduplicated, and versioned by paths and contents", () => {
    const files = [
      { path: "manifest.webmanifest", hash: "m" },
      { path: "assets/index-AAA.js", hash: "a" },
      { path: "index.html", hash: "i" },
      { path: "assets/index-AAA.js", hash: "a" },
      { path: "sw.js", hash: "s" }
    ];
    const manifest = createPrecacheManifest(files);
    expect(manifest.urls).toEqual(["/", "/assets/index-AAA.js", "/manifest.webmanifest"]);
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);

    expect(createPrecacheManifest([...files].reverse()).version).toBe(manifest.version);
    expect(createPrecacheManifest(files.map((f) => (f.path === "index.html" ? { ...f, hash: "j" } : f))).version)
      .not.toBe(manifest.version);
    // The worker's own bytes do not force a re-download of unchanged files.
    expect(createPrecacheManifest(files.map((f) => (f.path === "sw.js" ? { ...f, hash: "t" } : f))).version)
      .toBe(manifest.version);
  });

  it("injects every served output file into sw.js", () => {
    const outDir = tempDir();
    writeFiles(outDir, {
      "index.html": "<html></html>",
      "assets/index-Ab12Cd.js": "main",
      "assets/index-Ab12Cd.css": "css",
      "assets/HistoryTrends-Xy9.js": "chart",
      "assets/nested/font-Q1.woff2": "font",
      "assets/index-Ab12Cd.js.map": "{}",
      "manifest.webmanifest": "{}",
      "icon.svg": "<svg/>",
      "_headers": "/sw.js\n  Cache-Control: no-cache\n",
      "sw.js": `const m=${MANIFEST_PLACEHOLDER};self.m=m;`
    });

    const manifest = injectPrecacheManifest(outDir);
    expect(manifest.urls).toEqual([
      "/",
      "/assets/HistoryTrends-Xy9.js",
      "/assets/index-Ab12Cd.css",
      "/assets/index-Ab12Cd.js",
      "/assets/nested/font-Q1.woff2",
      "/icon.svg",
      "/manifest.webmanifest"
    ]);
    const sw = readFileSync(join(outDir, "sw.js"), "utf8");
    expect(sw).not.toContain(MANIFEST_PLACEHOLDER);
    expect(manifestIn(sw)).toEqual(manifest);
  });

  it("fails the build when sw.js has no single placeholder", () => {
    const outDir = tempDir();
    writeFiles(outDir, { "index.html": "", "sw.js": "self.x = 1;" });
    expect(() => injectPrecacheManifest(outDir)).toThrow(/found 0/);
  });
});

describe("production build", () => {
  it("precaches every file it emits, lazy chunks included", async () => {
    const outDir = tempDir();
    await build({ root: projectRoot, logLevel: "silent", build: { outDir, emptyOutDir: true } });

    const emitted = listFiles(outDir);
    const { urls } = manifestIn(readFileSync(join(outDir, "sw.js"), "utf8"));
    const expected = emitted.filter(shouldPrecache).map((path) => precacheUrl(path)).sort();

    expect(urls).toEqual(expected);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("/");
    expect(urls).toContain("/manifest.webmanifest");
    expect(urls).not.toContain("/sw.js");
    const chunks = urls.filter((url) => url.startsWith("/assets/"));
    expect(chunks.some((url) => /^\/assets\/index-[\w-]+\.js$/.test(url))).toBe(true);
    expect(chunks.some((url) => /^\/assets\/HistoryTrends-[\w-]+\.js$/.test(url))).toBe(true);
    expect(chunks.some((url) => /\.css$/.test(url))).toBe(true);
  }, 120_000);
});
