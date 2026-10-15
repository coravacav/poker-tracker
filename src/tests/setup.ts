import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";
import { resetGameArchiveForTests } from "../state/gameArchive";
import { resetPeopleStoreForTests } from "../state/peopleStore";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    }
  };
}

const testLocalStorage = createMemoryStorage();
const testSessionStorage = createMemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: testLocalStorage
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: testSessionStorage
});
// Node-environment tests (the build plugin's) have no window.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { configurable: true, value: testLocalStorage });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: testSessionStorage });
}

// Each test gets an empty IndexedDB and a fresh Player History module state.
beforeEach(() => {
  resetGameArchiveForTests();
  resetPeopleStoreForTests();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
});
