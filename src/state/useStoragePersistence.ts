import { useEffect, useState } from "react";
import { hasArchivedGames } from "../domain/sessionHistory";
import {
  checkStoragePersistence,
  getStorageManager,
  requestStoragePersistence,
  shouldRequestPersistence,
  STORAGE_PERSISTENCE_CHANGED_EVENT,
  type StoragePersistenceStatus
} from "./storagePersistence";

/**
 * Once this device holds data worth keeping, asks for persistent storage on the
 * next user gesture (click or key press) rather than on cold load, so browsers
 * that prompt (Firefox) do so in response to the user.
 */
export function useStoragePersistenceRequest(hasLocalData: boolean): void {
  useEffect(() => {
    if (!getStorageManager() || !shouldRequestPersistence()) return;
    if (!hasLocalData && !hasArchivedGames()) return;

    const options = { capture: true } as const;
    let done = false;
    const remove = () => {
      window.removeEventListener("click", handle, options);
      window.removeEventListener("keydown", handle, options);
    };
    function handle() {
      if (done) return;
      done = true;
      remove();
      void requestStoragePersistence();
    }
    window.addEventListener("click", handle, options);
    window.addEventListener("keydown", handle, options);
    return remove;
  }, [hasLocalData]);
}

export function useStoragePersistenceStatus(): StoragePersistenceStatus | "unknown" {
  const [status, setStatus] = useState<StoragePersistenceStatus | "unknown">(() =>
    getStorageManager() ? "unknown" : "unsupported"
  );
  useEffect(() => {
    let active = true;
    const manager = getStorageManager();
    if (manager) {
      void checkStoragePersistence(manager).then((next) => {
        if (active) setStatus(next);
      });
    }
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<StoragePersistenceStatus>).detail;
      if (next) setStatus(next);
    };
    window.addEventListener(STORAGE_PERSISTENCE_CHANGED_EVENT, handleChange);
    return () => {
      active = false;
      window.removeEventListener(STORAGE_PERSISTENCE_CHANGED_EVENT, handleChange);
    };
  }, []);
  return status;
}
