import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/**
 * Player History charts are a separate lazily loaded chunk. Fetch it once the
 * service worker controls the page so its runtime cache holds the chunk, and
 * the charts still open offline even if Player History was never viewed online.
 */
function warmLazyChunksForOffline() {
  const warm = () => {
    const load = () => void import("./components/HistoryTrends").catch(() => undefined);
    if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 10_000 });
    else setTimeout(load, 2_000);
  };
  if (navigator.serviceWorker.controller) warm();
  else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then(warmLazyChunksForOffline, () => undefined);
  });
}
