import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CumulativeNetChart, PersonResultsChart } from "../components/HistoryCharts";
import { cumulativeSeries } from "../domain/historyTrends";

// Smoke test of the real TanStack Charts library under React 19 in jsdom (no layout, so the initial width).
describe("history charts", () => {
  const results = [
    { gameId: "g1", gameName: "Night 1", playedAtMs: Date.UTC(2026, 0, 1), netCents: -1000, durationMs: null },
    { gameId: "g2", gameName: "Night 2", playedAtMs: Date.UTC(2026, 0, 8), netCents: 2500, durationMs: null }
  ];

  it("draws a line per person with a dot per game", () => {
    const { container } = render(
      <CumulativeNetChart
        currencyCode="USD"
        label="Running totals"
        series={[{ key: "a", name: "Alex", color: "#2a78d6", points: cumulativeSeries(results) }]}
      />
    );
    expect(screen.getByRole("img", { name: "Running totals" })).toBeInTheDocument();
    const dots = [...container.querySelectorAll("circle")];
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => dot.getAttribute("fill"))).toEqual(["#2a78d6", "#2a78d6"]);
    expect([...container.querySelectorAll("path")].some((path) => path.getAttribute("stroke") === "#2a78d6")).toBe(true);
  });

  it("draws a bar per game, colored by win or loss", () => {
    const { container } = render(<PersonResultsChart currencyCode="EUR" label="Alex's games" results={results} />);
    expect(screen.getByRole("img", { name: "Alex's games" })).toBeInTheDocument();
    const fills = [...container.querySelectorAll("rect")]
      .map((bar) => bar.getAttribute("fill"))
      .filter((fill) => fill === "#b42318" || fill === "#146c43");
    expect(fills).toEqual(["#b42318", "#146c43"]);
  });
});
