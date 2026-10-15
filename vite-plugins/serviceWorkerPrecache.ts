import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { PrecacheManifest } from "../src/pwa/swRouting";

export const SW_FILE_NAME = "sw.js";
export const MANIFEST_PLACEHOLDER = "__PRECACHE_MANIFEST__";

/** Root files read by the host (Cloudflare) rather than served, plus the worker itself. */
const NOT_SERVED = new Set([SW_FILE_NAME, "_headers", "_redirects", "_routes.json", "_worker.js"]);

/** Whether a build-output-relative path ("/" separated) belongs in the precache. */
export function shouldPrecache(path: string) {
  if (NOT_SERVED.has(path)) return false;
  if (path.split("/").some((part) => part.startsWith("."))) return false; // .assetsignore, .vite/
  return !path.endsWith(".map");
}

/** The URL a build file is requested under; index.html is the app shell at the base path. */
export function precacheUrl(path: string, base = "/") {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return path === "index.html" ? prefix : `${prefix}${path}`;
}

/**
 * Builds the manifest from build-output-relative paths ("/" separated) and their content
 * hashes. Sorted, deduplicated, and versioned by every included path and hash.
 */
export function createPrecacheManifest(files: readonly { path: string; hash: string }[], base = "/"): PrecacheManifest {
  const byUrl = new Map<string, string>();
  for (const file of files) {
    if (shouldPrecache(file.path)) byUrl.set(precacheUrl(file.path, base), file.hash);
  }
  const urls = [...byUrl.keys()].sort();
  const version = sha256(urls.map((url) => `${url} ${byUrl.get(url)}`).join("\n")).slice(0, 16);
  return { version, urls };
}

function sha256(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, root);
    return entry.isFile() ? [relative(root, full).split(sep).join("/")] : [];
  });
}

/** Reads every file in outDir, then writes the manifest into outDir/sw.js. */
export function injectPrecacheManifest(outDir: string, base = "/"): PrecacheManifest {
  const files = listFiles(outDir).map((path) => ({ path, hash: sha256(readFileSync(join(outDir, path))) }));
  const manifest = createPrecacheManifest(files, base);
  const swPath = join(outDir, SW_FILE_NAME);
  const source = readFileSync(swPath, "utf8");
  const occurrences = source.split(MANIFEST_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one ${MANIFEST_PLACEHOLDER} in ${SW_FILE_NAME}, found ${occurrences}.`);
  }
  writeFileSync(swPath, source.replace(MANIFEST_PLACEHOLDER, () => JSON.stringify(manifest)));
  return manifest;
}

/**
 * Bundles the service worker entry to /sw.js and, once everything (including public/)
 * has been written, fills in the list of every output file so install precaches it all.
 */
export function serviceWorkerPrecache(options: { entry: string }): Plugin {
  let outDir = "";
  let base = "/";
  return {
    name: "poker-tracker:service-worker-precache",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    buildStart() {
      this.emitFile({ type: "chunk", id: options.entry, fileName: SW_FILE_NAME });
    },
    generateBundle(_, bundle) {
      const sw = bundle[SW_FILE_NAME];
      // sw.js is registered as a classic script, so it must not depend on other chunks.
      if (sw?.type !== "chunk" || sw.imports.length > 0 || sw.dynamicImports.length > 0) {
        throw new Error(`${SW_FILE_NAME} must be a self-contained chunk.`);
      }
    },
    writeBundle: {
      order: "post",
      sequential: true,
      handler() {
        const manifest = injectPrecacheManifest(outDir, base);
        this.info(`precaching ${manifest.urls.length} files, version ${manifest.version}`);
      }
    }
  };
}
