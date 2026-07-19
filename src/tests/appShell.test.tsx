import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/AppShell";
import type { RecentTransactionAction } from "../domain/recentTransactionAction";

const recentAction: RecentTransactionAction = {
  kind: "create",
  transactionId: "transaction",
  occurredAt: "2026-05-10T00:00:00.000Z"
};

function renderShell(
  changes: Partial<React.ComponentProps<typeof AppShell>> = {}
) {
  const props: React.ComponentProps<typeof AppShell> = {
    cashOut: <div>Cash out</div>,
    layoutEditing: false,
    layoutEditingDisabled: false,
    mode: "play",
    onLayoutEditingChange: vi.fn(),
    onModeChange: vi.fn(),
    onUndoRecentTransaction: vi.fn(),
    play: <div>Play</div>,
    readOnly: false,
    recentTransactionAction: recentAction,
    setup: <div>Setup</div>,
    settle: <div>Settle</div>,
    ...changes
  };

  return { ...render(<AppShell {...props} />), props };
}

describe("AppShell recent transaction undo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("places Undo immediately left of the mode selector and dispatches without confirmation", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-10T00:00:10.000Z");
    const confirm = vi.spyOn(window, "confirm");
    const { props } = renderShell();
    const nav = screen.getByRole("navigation", { name: "Poker tracker modes" });

    expect(
      within(nav).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)
    ).toEqual([
      "Edit layout",
      "Undo recent transaction action",
      "Setup",
      "Play",
      "Cash Out",
      "Settle"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Undo recent transaction action" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(props.onUndoRecentTransaction).toHaveBeenCalledWith(recentAction);
  });

  it("hides when the window expires without another state update", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-10T00:00:10.000Z");
    renderShell();

    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();
    act(() => vi.advanceTimersByTime(19_999));
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("button", { name: "Undo recent transaction action" })).toBeNull();
  });

  it("hides in read-only mode and returns while the window remains", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-10T00:00:10.000Z");
    const { rerender, props } = renderShell({ readOnly: true });

    expect(screen.queryByRole("button", { name: "Undo recent transaction action" })).toBeNull();
    rerender(<AppShell {...props} readOnly={false} />);
    expect(screen.getByRole("button", { name: "Undo recent transaction action" })).toBeVisible();
  });

  it("starts hidden for expired actions and leaves navigation ordering unchanged without one", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-10T00:00:30.000Z");
    const { rerender, props } = renderShell();

    expect(screen.queryByRole("button", { name: "Undo recent transaction action" })).toBeNull();
    rerender(<AppShell {...props} recentTransactionAction={null} />);
    expect(
      within(screen.getByRole("navigation", { name: "Poker tracker modes" }))
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Edit layout", "Setup", "Play", "Cash Out", "Settle"]);
  });

  it("stays hidden for a future-dated action", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-09T23:59:59.999Z");
    renderShell();

    expect(screen.queryByRole("button", { name: "Undo recent transaction action" })).toBeNull();
  });
});
