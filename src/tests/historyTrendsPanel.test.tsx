import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionHistoryPanel } from "../components/SessionHistoryPanel";
import type { CurrencyCode } from "../domain/money";
import type { ArchivedGame } from "../domain/sessionHistory";
import { mergeArchivedGames } from "../state/gameArchive";
import { createDefaultGameState } from "../state/seedGame";

// Stand-ins show what each chart was given; like the library, each names its surface with the label.
vi.mock("../components/HistoryCharts", () => ({
  CumulativeNetChart: ({
    series,
    label
  }: {
    series: Array<{ name: string; color: string; points: Array<{ cumulativeCents: number }> }>;
    label: string;
  }) => (
    <div role="img" aria-label={label}>
      <ul data-testid="cumulative-chart">
        {series.map((entry) => (
          <li key={entry.name} data-color={entry.color}>
            {entry.name} {entry.points.map((point) => point.cumulativeCents).join(",")}
          </li>
        ))}
      </ul>
    </div>
  ),
  PersonResultsChart: ({ results, label }: { results: Array<{ netCents: number }>; label: string }) => (
    <p role="img" aria-label={label} data-testid="results-chart">
      {results.map((result) => result.netCents).join(",")}
    </p>
  )
}));

const DAY = 24 * 60 * 60 * 1000;
let gameCount = 0;

function game(daysAgo: number, results: Record<string, number>, currencyCode: CurrencyCode = "USD"): ArchivedGame {
  const playedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  const state = createDefaultGameState(currencyCode);
  gameCount += 1;
  const names = Object.keys(results);
  state.players = names.map((name, index) => ({ id: `p${gameCount}_${index}`, name, seatIndex: index, isActive: true }));
  state.transactions = names.map((name, index) =>
    results[name] < 0
      ? { id: `t${gameCount}_${index}`, type: "bank_buy_in" as const, toPlayerId: state.players[index].id, amountCents: -results[name], createdAt: playedAt }
      : {
          id: `t${gameCount}_${index}`,
          type: "bank_cash_out" as const,
          cashOutKind: "final" as const,
          fromPlayerId: state.players[index].id,
          amountCents: results[name],
          createdAt: playedAt
        }
  );
  return { archivedAt: playedAt, state };
}

async function renderHistory(games: ArchivedGame[]) {
  await mergeArchivedGames(games);
  render(<SessionHistoryPanel />);
  return await screen.findByTestId("cumulative-chart");
}

describe("Player History over time", () => {
  it("draws running totals with a text alternative and data table", async () => {
    const chart = await renderHistory([
      game(40, { Alex: -1000, Blair: 1000 }),
      game(10, { Alex: 2500, Blair: -2500 }),
      game(5, { Alex: 500, Casey: -500 })
    ]);
    expect(within(chart).getByText("Alex -1000,1500,2000")).toBeInTheDocument();
    expect(within(chart).getByText("Blair 1000,-1500")).toBeInTheDocument();
    const figure = screen.getAllByRole("img")[0];
    expect(figure).toHaveAccessibleName(/Running total in USD over all games: Alex \+\$20\.00 after 3 games/);
    expect(screen.getByText("Chart data as a table")).toBeInTheDocument();

    // The per-person view defaults to whoever played most.
    expect(screen.getByLabelText("Player")).toHaveValue("name:alex");
    expect(screen.getByTestId("results-chart")).toHaveTextContent("-1000,2500,500");
    const tiles = screen.getByText("Win rate").closest("dl")!;
    expect(tiles).toHaveTextContent("Games3");
    expect(tiles).toHaveTextContent("67%");
    expect(tiles).toHaveTextContent("Best+$25.00");
    expect(tiles).toHaveTextContent("Worst-$10.00");
    // These games record every entry at one moment, so none can be timed.
    expect(tiles).toHaveTextContent("Per hour— no timed games");
  });

  it("shows a per-hour rate over the games that can be timed", async () => {
    const timed = game(3, { Alex: -1000, Blair: 1000 });
    // Alex bought in 2 hours before Blair cashed out; Alex never cashed out, so only Blair is timed.
    timed.state.transactions[0].createdAt = new Date(Date.parse(timed.state.transactions[1].createdAt) - 2 * 60 * 60 * 1000).toISOString();
    timed.state.transactions.push({
      id: "blair_buy_in",
      type: "bank_buy_in",
      toPlayerId: timed.state.players[1].id,
      amountCents: 1000,
      createdAt: timed.state.transactions[0].createdAt
    });
    timed.state.transactions[1].amountCents = 4000;
    await renderHistory([timed, game(1, { Blair: 500, Casey: -500 })]);
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "name:blair" } });
    const tiles = screen.getByText("Win rate").closest("dl")!;
    // +$30.00 over 2 hours; the untimed second game is left out of both sides.
    expect(tiles).toHaveTextContent("Per hour+$15.00 2 h, 1 of 2 games");
    expect(screen.getByRole("cell", { name: "2 h" })).toBeInTheDocument();
  });

  it("toggles people without repainting the others", async () => {
    const chart = await renderHistory([game(3, { Alex: -100, Blair: 100, Casey: 0 }), game(2, { Alex: -100, Blair: 100 })]);
    const colorOf = (name: string) => within(chart).getByText(new RegExp(`^${name} `)).getAttribute("data-color");
    const casey = colorOf("Casey");
    const toggles = screen.getByRole("group", { name: "Players on the chart" });
    fireEvent.click(within(toggles).getByRole("button", { name: /^Blair/ }));
    expect(within(toggles).getByRole("button", { name: /^Blair/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(chart).queryByText(/^Blair /)).not.toBeInTheDocument();
    expect(colorOf("Casey")).toBe(casey);
  });

  it("applies the date range to the table and the charts", async () => {
    await renderHistory([game(100, { Alex: -1000, Dana: 1000 }), game(5, { Alex: 300, Blair: -300 })]);
    expect(screen.getByText("2 archived games")).toBeInTheDocument();
    expect(document.querySelector(".history-stat-list")).toHaveTextContent("Dana");

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByText("1 of 2 archived games in the last 30 days")).toBeInTheDocument();
    expect(document.querySelector(".history-stat-list")).not.toHaveTextContent("Dana");
    expect(screen.getByTestId("cumulative-chart")).toHaveTextContent("Alex 300");
    expect(screen.getByTestId("results-chart")).toHaveTextContent("300");
  });

  it("downloads the games in the range as CSV", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:csv"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await renderHistory([game(100, { Alex: -1000, Dana: 1000 }), game(5, { Alex: 300, Blair: -300 })]);
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    }));
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    // Only the game in the last 30 days; Dana played 100 days ago.
    expect(text.trimEnd().split("\r\n")).toHaveLength(3);
    expect(text).toMatch(/^\uFEFFDate,Game,Person/);
    expect(text).not.toContain("Dana");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^poker-history-last-30d-\d{4}-\d{2}-\d{2}\.csv$/);
    click.mockRestore();
  });

  it("charts one currency at a time", async () => {
    await renderHistory([game(3, { Alex: -100, Blair: 100 }), game(2, { Alex: 700, Blair: -700 }, "EUR"), game(1, { Alex: 50, Blair: -50 })]);
    expect(screen.getByTestId("cumulative-chart")).toHaveTextContent("Alex -100,-50");
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "EUR" } });
    expect(screen.getByTestId("cumulative-chart")).toHaveTextContent("Alex 700");
    expect(screen.getAllByRole("img")[0]).toHaveAccessibleName(/in EUR/);
  });

  it("says when no games fall in the range", async () => {
    await renderHistory([game(100, { Alex: -100, Blair: 100 })]);
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByText("No games in the last 30 days.")).toBeInTheDocument();
    expect(screen.queryByTestId("cumulative-chart")).not.toBeInTheDocument();
  });
});
