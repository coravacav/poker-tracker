import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CumulativeNetChart, PersonResultsChart } from "../components/HistoryCharts";
import { cumulativeSeries } from "../domain/historyTrends";

// Smoke test of the real react-charts library under React 19 in jsdom (no layout, so default sizes).
describe("history charts", () => {
  const results = [
    { gameId: "g1", gameName: "Night 1", playedAtMs: Date.UTC(2026, 0, 1), netCents: -1000 },
    { gameId: "g2", gameName: "Night 2", playedAtMs: Date.UTC(2026, 0, 8), netCents: 2500 }
  ];

  it("draws a line per person", () => {
    const { container } = render(
      <div style={{ height: 200 }}>
        <CumulativeNetChart currencyCode="USD" series={[{ key: "a", name: "Alex", color: "#2a78d6", points: cumulativeSeries(results) }]} />
      </div>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("draws a bar per game, colored by win or loss", () => {
    const { container } = render(
      <div style={{ height: 200 }}>
        <PersonResultsChart currencyCode="EUR" results={results} />
      </div>
    );
    const bars = [...container.querySelectorAll("rect")].map((bar) => bar.style.fill);
    expect(bars).toEqual(["#b42318", "#146c43"]);
  });
});
