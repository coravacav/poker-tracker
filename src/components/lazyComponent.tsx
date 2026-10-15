import { Component, lazy, Suspense, useState } from "react";
import type { ComponentType, ReactNode } from "react";

export type PreloadableComponent<P extends object> = ComponentType<P> & {
  /** Starts loading the chunk; resolves once it can render without suspending. */
  preload: () => Promise<unknown>;
};

/**
 * React.lazy that can be preloaded. Once the chunk has loaded, new instances
 * render the real component directly instead of suspending for a tick, so
 * opening a preloaded surface never flashes its fallback. Each instance keeps
 * the component type it mounted with, so nothing remounts when loading ends.
 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>
): PreloadableComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (component) => {
        loaded = component;
        return { default: component };
      },
      (error: unknown) => {
        // Let a later mount (for example after reconnecting) try again.
        pending = null;
        Lazy = lazy(preload);
        throw error;
      }
    ));
  let Lazy = lazy(preload);

  function Preloadable(props: P) {
    const [Resolved] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Resolved {...props} />;
  }
  return Object.assign(Preloadable, { preload });
}

type LazyBoundaryProps = { children: ReactNode; fallback: ReactNode };

/** Suspense plus a notice in place of a crash when a chunk cannot be loaded. */
export class LazyBoundary extends Component<LazyBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="notice notice-warning" role="alert">
          This part of the app could not be loaded. Reload the page to try again.
        </div>
      );
    }
    return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}

/** Runs once the browser is idle after first paint (or soon after, where idle callbacks are missing). */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 200);
  return () => window.clearTimeout(handle);
}
