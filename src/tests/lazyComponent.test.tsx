import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LazyBoundary, lazyWithPreload } from "../components/lazyComponent";

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("lazyWithPreload", () => {
  it("shows the fallback until the chunk loads, then the component", async () => {
    const LazyGreeting = lazyWithPreload(async () => Greeting);
    render(
      <LazyBoundary fallback={<p>Loading…</p>}>
        <LazyGreeting name="Alex" />
      </LazyBoundary>
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Hello Alex")).toBeInTheDocument();
  });

  it("renders a preloaded component without suspending and loads it once", async () => {
    const load = vi.fn(async () => Greeting);
    const LazyGreeting = lazyWithPreload(load);
    await LazyGreeting.preload();
    await LazyGreeting.preload();
    render(
      <LazyBoundary fallback={<p>Loading…</p>}>
        <LazyGreeting name="Blair" />
      </LazyBoundary>
    );

    expect(screen.getByText("Hello Blair")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows a notice instead of crashing when the chunk cannot load, and retries on a later mount", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let online = false;
    const load = vi.fn(async () => {
      if (!online) throw new Error("offline");
      return Greeting;
    });
    const LazyGreeting = lazyWithPreload(load);
    const view = render(
      <LazyBoundary fallback={<p>Loading…</p>}>
        <LazyGreeting name="Casey" />
      </LazyBoundary>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    view.unmount();
    online = true;

    render(
      <LazyBoundary fallback={<p>Loading…</p>}>
        <LazyGreeting name="Casey" />
      </LazyBoundary>
    );
    expect(await screen.findByText("Hello Casey")).toBeInTheDocument();
    expect(load).toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });
});
