/**
 * The TanStack Charts parts of Player History; part of the lazily loaded
 * HistoryTrends chunk. HistoryTrends.tsx has the legends, summaries, and data
 * tables. The default SVG renderer has no motion, so nothing animates even
 * without a reduced-motion preference.
 */
import { useMemo } from "react";
import { barY } from "@tanstack/charts/bar";
import { dot } from "@tanstack/charts/dot";
import { lineY } from "@tanstack/charts/line";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { defineChart } from "@tanstack/charts/scene";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { scaleTime } from "d3-scale";
import type { CumulativePoint, PersonGameResult } from "../domain/historyTrends";
import { formatCurrency, type CurrencyCode } from "../domain/money";

export type ChartSeries = {
  key: string;
  name: string;
  color: string;
  points: CumulativePoint[];
};

const WIN_COLOR = "#146c43";
const LOSS_COLOR = "#b42318";
const CHART_HEIGHT = 240;

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

function moneyTick(value: number, currencyCode: CurrencyCode): string {
  return formatCurrency(Math.round(value * 100), currencyCode, { trimWholeCents: true });
}

function signed(cents: number, currencyCode: CurrencyCode): string {
  return `${cents > 0 ? "+" : ""}${formatCurrency(cents, currencyCode)}`;
}

type LineRow = CumulativePoint & { key: string; name: string; date: Date; total: number };

export function CumulativeNetChart({
  series,
  currencyCode,
  label
}: {
  series: ChartSeries[];
  currencyCode: CurrencyCode;
  /** Accessible name of the chart; the data table nearby carries every value. */
  label: string;
}) {
  const definition = useMemo(() => {
    const rows = series.flatMap((entry) =>
      entry.points.map(
        (point): LineRow => ({
          ...point,
          key: entry.key,
          name: entry.name,
          date: new Date(point.playedAtMs),
          total: point.cumulativeCents / 100
        })
      )
    );
    return defineChart({
      marks: [
        // The dots carry focus and the tooltip; the lines only connect them.
        decorative(lineY(rows, { x: "date", y: "total", z: "key", color: "key", strokeWidth: 2 })),
        // Dots mark each game, so a person with a single game still shows up.
        dot(rows, {
          x: "date",
          y: "total",
          color: "key",
          key: (row) => `${row.key}:${row.gameId}`,
          r: 4,
          stroke: "#ffffff",
          strokeWidth: 2
        })
      ],
      scales: {
        x: { scale: scaleTime, axis: { ticks: { format: (value) => shortDate.format(value) } } },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value) => moneyTick(value, currencyCode) } }
        }
      },
      // Each person keeps the color of their slot, whoever else is shown.
      color: {
        scale: scaleOrdinal(
          series.map((entry) => entry.key),
          series.map((entry) => entry.color)
        )
      },
      tooltip: {
        use: tooltip,
        className: "history-chart-tooltip",
        content: (points) => {
          const row = points[0]?.datum;
          return row
            ? {
                title: row.name,
                color: points[0].color,
                rows: [
                  { label: "Date", value: fullDate.format(row.playedAtMs) },
                  { label: "Result", value: signed(row.netCents, currencyCode) },
                  { label: "Running total", value: signed(row.cumulativeCents, currencyCode) }
                ]
              }
            : { rows: [] };
        }
      }
    });
  }, [currencyCode, series]);
  return <Chart definition={definition} height={CHART_HEIGHT} ariaLabel={label} />;
}

type BarRow = PersonGameResult & { slot: number; result: number };

export function PersonResultsChart({
  results,
  currencyCode,
  label
}: {
  results: PersonGameResult[];
  currencyCode: CurrencyCode;
  label: string;
}) {
  const definition = useMemo(() => {
    // Games can share a date, so bars are keyed by position and labelled by date.
    const rows = results.map((result, slot): BarRow => ({ ...result, slot, result: result.netCents / 100 }));
    return defineChart({
      marks: [
        barY(rows, {
          x: "slot",
          y: "result",
          key: (row) => `${row.gameId}:${row.slot}`,
          fill: (row) => (row.netCents >= 0 ? WIN_COLOR : LOSS_COLOR),
          maxThickness: 24
        })
      ],
      scales: {
        x: {
          scale: scaleBand<number>()
            .domain(rows.map((row) => row.slot))
            .padding(0.2),
          axis: {
            ticks: { size: 0, format: (slot) => (results[slot] ? shortDate.format(results[slot].playedAtMs) : "") },
            // Overlapping dates are dropped; the first and latest game keep theirs.
            tickLabels: { thin: { priority: "ends" } }
          }
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { ticks: { format: (value) => moneyTick(value, currencyCode) } }
        }
      },
      tooltip: {
        use: tooltip,
        className: "history-chart-tooltip",
        content: (points) => {
          const row = points[0]?.datum;
          return row
            ? {
                title: `${fullDate.format(row.playedAtMs)} · ${row.gameName}`,
                color: row.netCents >= 0 ? WIN_COLOR : LOSS_COLOR,
                rows: [{ label: "Result", value: signed(row.netCents, currencyCode) }]
              }
            : { rows: [] };
        }
      }
    });
  }, [currencyCode, results]);
  return <Chart definition={definition} height={CHART_HEIGHT} ariaLabel={label} />;
}
