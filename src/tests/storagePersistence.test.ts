import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStoragePersistenceRequest } from "../state/useStoragePersistence";
import {
  checkStoragePersistence,
  getStorageManager,
  PERSISTENCE_RETRY_MS,
  requestStoragePersistence,
  shouldRequestPersistence,
  STORAGE_PERSISTENCE_CHANGED_EVENT,
  STORAGE_PERSISTENCE_KEY
} from "../state/storagePersistence";

function fakeManager({ persisted = false, grant = false } = {}) {
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => grant)
  };
}

describe("storage persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("feature-detects the StorageManager API", () => {
    expect(getStorageManager(undefined)).toBeNull();
    expect(getStorageManager({})).toBeNull();
    expect(getStorageManager({ storage: {} })).toBeNull();
    const manager = fakeManager();
    expect(getStorageManager({ storage: manager })).toBe(manager);
  });

  it("reports unsupported browsers without throwing", async () => {
    expect(await checkStoragePersistence(null)).toBe("unsupported");
    expect(await requestStoragePersistence(null)).toBe("unsupported");
    expect(localStorage.getItem(STORAGE_PERSISTENCE_KEY)).toBeNull();
  });

  it("does not prompt when storage is already persistent", async () => {
    const manager = fakeManager({ persisted: true });
    expect(await requestStoragePersistence(manager)).toBe("granted");
    expect(manager.persist).not.toHaveBeenCalled();
  });

  it("requests persistence and remembers a grant", async () => {
    const manager = fakeManager({ grant: true });
    const listener = vi.fn();
    window.addEventListener(STORAGE_PERSISTENCE_CHANGED_EVENT, listener);
    expect(await requestStoragePersistence(manager, 1000)).toBe("granted");
    window.removeEventListener(STORAGE_PERSISTENCE_CHANGED_EVENT, listener);
    expect(manager.persist).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: "granted" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_PERSISTENCE_KEY) ?? "null")).toMatchObject({
      outcome: "granted",
      requestedAt: 1000
    });
  });

  it("does not re-request after a denial until the retry window passes", async () => {
    const manager = fakeManager({ grant: false });
    expect(await requestStoragePersistence(manager, 1000)).toBe("not_granted");
    expect(await requestStoragePersistence(manager, 2000)).toBe("not_granted");
    expect(manager.persist).toHaveBeenCalledTimes(1);
    expect(shouldRequestPersistence(1000 + PERSISTENCE_RETRY_MS - 1)).toBe(false);
    expect(shouldRequestPersistence(1000 + PERSISTENCE_RETRY_MS)).toBe(true);

    await requestStoragePersistence(manager, 1000 + PERSISTENCE_RETRY_MS);
    expect(manager.persist).toHaveBeenCalledTimes(2);
  });

  it("treats API errors as not granted", async () => {
    const manager = {
      persisted: vi.fn(async () => false),
      persist: vi.fn(async () => {
        throw new Error("blocked");
      })
    };
    expect(await requestStoragePersistence(manager, 1000)).toBe("not_granted");
    expect(shouldRequestPersistence(2000)).toBe(false);
  });
});

describe("useStoragePersistenceRequest", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => Reflect.deleteProperty(navigator, "storage"));

  function installManager(manager: ReturnType<typeof fakeManager>) {
    Object.defineProperty(navigator, "storage", { configurable: true, value: manager });
  }

  it("waits for meaningful data and then asks on the next user gesture", async () => {
    const manager = fakeManager({ grant: true });
    installManager(manager);
    const { rerender } = renderHook(({ hasData }) => useStoragePersistenceRequest(hasData), {
      initialProps: { hasData: false }
    });
    fireEvent.click(document.body);
    expect(manager.persist).not.toHaveBeenCalled();

    rerender({ hasData: true });
    expect(manager.persisted).not.toHaveBeenCalled();
    fireEvent.click(document.body);
    await waitFor(() => expect(manager.persist).toHaveBeenCalledTimes(1));
    fireEvent.click(document.body);
    expect(manager.persist).toHaveBeenCalledTimes(1);
  });

  it("does nothing in browsers without the API", () => {
    renderHook(() => useStoragePersistenceRequest(true));
    fireEvent.click(document.body);
    expect(localStorage.getItem(STORAGE_PERSISTENCE_KEY)).toBeNull();
  });
});
