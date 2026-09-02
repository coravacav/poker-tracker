import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { LAST_VISIT_KEY, LOCAL_ENTRY_TIMEOUT_MS } from "../session/localEntry";
import { GAME_ARCHIVE_KEY } from "../domain/sessionHistory";
import { STORAGE_KEY } from "../state/persistence";
import { createDefaultGameState } from "../state/seedGame";

describe("local start page", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("welcomes a first-time visitor without persisting a default game before the choice", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Ready for poker night?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start new game" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start new game" }));

    expect(screen.getByRole("heading", { name: "Poker Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Game Setup" })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("offers continuation for a stale saved game and preserves it", () => {
    const state = createDefaultGameState();
    state.settings.gameName = "Friday Night";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - LOCAL_ENTRY_TIMEOUT_MS - 1));

    render(<App />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Friday Night")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue Friday Night" })).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue Friday Night" }));

    expect(screen.getByRole("heading", { name: "Poker Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").localGameId).toBe(
      state.localGameId
    );
  });

  it("archives a played game before starting fresh", async () => {
    const state = createDefaultGameState();
    state.settings.gameName = "Old Game";
    state.transactions = [
      {
        id: "buy-in",
        type: "bank_buy_in",
        createdAt: new Date().toISOString(),
        amountCents: 2_000,
        toPlayerId: state.players[0].id
      }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - LOCAL_ENTRY_TIMEOUT_MS - 1));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Start new game" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Game Setup" })).toBeInTheDocument());
    const nextState = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const archive = JSON.parse(localStorage.getItem(GAME_ARCHIVE_KEY) ?? "[]");
    expect(nextState.localGameId).not.toBe(state.localGameId);
    expect(nextState.transactions).toHaveLength(0);
    expect(archive).toHaveLength(1);
    expect(archive[0].state.localGameId).toBe(state.localGameId);
  });

  it("prompts when a visible local tab returns after 24 hours", () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-10T00:00:00.000Z");
    vi.setSystemTime(now);
    const state = createDefaultGameState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(LAST_VISIT_KEY, String(now.getTime()));

    render(<App />);
    expect(screen.getByRole("heading", { name: "Poker Tracker" })).toBeInTheDocument();

    fireEvent.blur(window);
    vi.setSystemTime(now.getTime() + LOCAL_ENTRY_TIMEOUT_MS + 1);
    fireEvent.focus(window);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });
});
