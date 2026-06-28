import { JSDOM } from "jsdom";
import { afterEach } from "bun:test";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/"
});

globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.File = dom.window.File;
globalThis.Blob = dom.window.Blob;
globalThis.localStorage = dom.window.localStorage;

const { cleanup } = await import("@testing-library/react");
await import("@testing-library/jest-dom/vitest");

afterEach(() => {
  cleanup();
});
