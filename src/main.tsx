import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installErrorReporting } from "./diagnostics/reportErrors";
import { configuredDeploymentUrl } from "./session/convexRoomTransport";
import "./styles/global.css";

// Production builds with a Convex deployment report uncaught errors to it (no game data; see src/diagnostics).
const deploymentUrl = configuredDeploymentUrl();
const reportError =
  import.meta.env.PROD && deploymentUrl
    ? installErrorReporting({ deploymentUrl, build: import.meta.env.VITE_APP_BUILD ?? "unknown" })
    : null;

ReactDOM.createRoot(document.getElementById("root")!, {
  // Errors React catches in an error boundary never reach the window's error event, so report them here.
  // Uncaught ones keep React's default handling, which raises them on the window.
  ...(reportError
    ? {
        onCaughtError: (error: unknown) => {
          console.error(error);
          reportError("render", error);
        }
      }
    : {})
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The worker precaches every build file (lazy chunks included) when it installs; see src/pwa/serviceWorker.ts.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
