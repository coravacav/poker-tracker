import { fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo, useReducer } from "react";
import { describe, expect, it } from "vitest";
import { CashOutMode } from "../components/CashOutMode";
import { buildPlayerSummaries, calculateBankSummary } from "../domain/ledger";
import type { GameState } from "../domain/pokerTypes";
import { gameReducer } from "../state/gameReducer";
import { createDefaultGameState } from "../state/seedGame";

function initialState(): GameState {
  const state = createDefaultGameState();
  const player = state.players[0];
  return {
    ...state,
    players: [player],
    settings: {
      ...state.settings,
      chipDenominations: [
        { id: "blue", label: "Blue", colorHex: "#0000ff", valueCents: 500 },
        { id: "red", label: "Red", colorHex: "#ff0000", valueCents: 100 }
      ]
    },
    transactions: [
      { id: "buy", type: "bank_buy_in", createdAt: "2026-01-01", amountCents: 2000, toPlayerId: player.id }
    ]
  };
}

function Harness({ withPartial = false }: { withPartial?: boolean }) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => {
    const state = initialState();
    if (withPartial) {
      state.transactions.push({
        id: "partial",
        type: "bank_cash_out",
        cashOutKind: "partial",
        createdAt: "2026-01-02",
        amountCents: 500,
        fromPlayerId: state.players[0].id
      });
    }
    return state;
  });
  const summaries = useMemo(() => buildPlayerSummaries(state.players, state.transactions), [state]);
  const bank = useMemo(() => calculateBankSummary(state.transactions), [state.transactions]);
  return (
    <CashOutMode
      bankSummary={bank}
      denominations={state.settings.chipDenominations}
      dispatch={dispatch}
      drafts={state.cashOutDrafts}
      players={state.players}
      readOnly={false}
      summaries={summaries}
      transactions={state.transactions}
    />
  );
}

describe("CashOutMode", () => {
  it("autosaves counts, calculates a total, and records a breakdown", () => {
    render(<Harness />);
    const card = screen.getByRole("article");
    fireEvent.change(within(card).getByLabelText("Player 1 Blue chip count"), { target: { value: "3" } });
    fireEvent.change(within(card).getByLabelText("Player 1 Red chip count"), { target: { value: "5" } });

    expect(within(card).getAllByText("$20.00")).toHaveLength(2);
    fireEvent.click(within(card).getByRole("button", { name: "Record cash-out" }));

    expect(within(card).getByText("Recorded")).toBeInTheDocument();
    expect(within(card).getByText("3 × $5.00")).toBeInTheDocument();
    expect(within(card).getByText("5 × $1.00")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("requires an explicit zero confirmation", () => {
    render(<Harness />);
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm $0" }));
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.getByText("Confirmed with no chips.")).toBeInTheDocument();
  });

  it("keeps recording blocked while any denomination input is invalid", () => {
    render(<Harness />);
    const card = screen.getByRole("article");
    fireEvent.change(screen.getByLabelText("Player 1 Blue chip count"), {
      target: { value: "-1" }
    });
    fireEvent.change(screen.getByLabelText("Player 1 Red chip count"), {
      target: { value: "2" }
    });

    expect(screen.getByText("Chip counts must be nonnegative whole numbers.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record cash-out" }));
    expect(within(card).queryByText("Recorded")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Player 1 Blue chip count"), {
      target: { value: "1" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Record cash-out" }));
    expect(within(card).getByText("Recorded")).toBeInTheDocument();
  });

  it("restores a recorded count for atomic correction", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Player 1 Blue chip count"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Record cash-out" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct count" }));

    expect(screen.getByLabelText("Player 1 Blue chip count")).toHaveValue("2");
    fireEvent.change(screen.getByLabelText("Player 1 Blue chip count"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Record correction" }));

    expect(screen.getByText("3 × $5.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct count" })).toBeInTheDocument();
  });

  it("keeps final counting available after a partial cash-out", () => {
    render(<Harness withPartial />);
    const card = screen.getByRole("article");

    expect(within(card).getByText("Partial")).toBeInTheDocument();
    expect(within(card).getByText("Cashed out earlier")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    expect(screen.queryByText(/multiple active cash-outs/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Player 1 Blue chip count"), {
      target: { value: "3" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Record cash-out" }));

    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(within(card).getByText("Total cashed out")).toBeInTheDocument();
    expect(within(card).getAllByText("$20.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Correct count" })).toBeInTheDocument();
  });
});
