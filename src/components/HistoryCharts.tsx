/**
 * The react-charts (TanStack React Charts) parts of Player History; part of
 * the lazily loaded HistoryTrends chunk. HistoryTrends.tsx has the legends,
 * text alternatives, and data tables.
 */
import { useEffect, useMemo, useState } from "react";
import { Chart, type AxisOptions, type Series } from "react-charts";
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

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setReduced(list.matches);
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function moneyTick(value: number, currencyCode: CurrencyCode): string {
  return formatCurrency(Math.round(value * 100), currencyCode, { trimWholeCents: true });
}

/**
 * The library's tooltip and crosshair glide on springs; with reduced motion
 * they are turned off and the data table carries the exact values.
 */
function interactionOptions(reducedMotion: boolean) {
  return reducedMotion ? { tooltip: false, primaryCursor: false, secondaryCursor: false } : {};
}

export function CumulativeNetChart({ series, currencyCode }: { series: ChartSeries[]; currencyCode: CurrencyCode }) {
  const reducedMotion = usePrefersReducedMotion();
  const colorByKey = useMemo(() => new Map(series.map((entry) => [entry.key, entry.color])), [series]);
  const data = useMemo(
    () => series.map((entry) => ({ id: entry.key, label: entry.name, data: entry.points })),
    [series]
  );
  const primaryAxis = useMemo(
    (): AxisOptions<CumulativePoint> => ({
      getValue: (point) => new Date(point.playedAtMs),
      scaleType: "time",
      formatters: {
        scale: (value: Date) => shortDate.format(value),
        tooltip: (value: Date) => fullDate.format(value)
      }
    }),
    []
  );
  const secondaryAxes = useMemo(
    (): AxisOptions<CumulativePoint>[] => [
      {
        getValue: (point) => point.cumulativeCents / 100,
        elementType: "line",
        // Dots mark each game, so a person with a single game still shows up.
        showDatumElements: true,
        formatters: {
          scale: (value: number) => moneyTick(value, currencyCode),
          tooltip: (value: number) => formatCurrency(Math.round(value * 100), currencyCode)
        }
      }
    ],
    [currencyCode]
  );
  return (
    <Chart
      options={{
        data,
        primaryAxis,
        secondaryAxes,
        interactionMode: "closest",
        getSeriesStyle: (entry: Series<CumulativePoint>) => ({
          color: colorByKey.get(entry.id) ?? "#64716c",
          line: { strokeWidth: 2 },
          circle: { r: 4, stroke: "#ffffff", strokeWidth: 2 }
        }),
        ...interactionOptions(reducedMotion)
      }}
    />
  );
}

type BarDatum = PersonGameResult & { slot: number };

export function PersonResultsChart({
  results,
  currencyCode
}: {
  results: PersonGameResult[];
  currencyCode: CurrencyCode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  // Games can share a date, so bars are keyed by position and labelled by date.
  const data = useMemo(
    () => [{ id: "results", label: "Result", data: results.map((result, slot): BarDatum => ({ ...result, slot })) }],
    [results]
  );
  const labelEvery = Math.max(1, Math.ceil(results.length / 8));
  const primaryAxis = useMemo(
    (): AxisOptions<BarDatum> => ({
      getValue: (datum) => datum.slot,
      scaleType: "band",
      maxBandSize: 24,
      formatters: {
        scale: (slot: number) => {
          // Label about eight bars so dates stay readable on narrow screens.
          const result = slot % labelEvery === (results.length - 1) % labelEvery ? results[slot] : undefined;
          return result ? shortDate.format(result.playedAtMs) : "";
        },
        tooltip: (slot: unknown) => {
          const result = typeof slot === "number" ? results[slot] : undefined;
          return result ? `${fullDate.format(result.playedAtMs)} · ${result.gameName}` : "";
        }
      }
    }),
    [labelEvery, results]
  );
  const secondaryAxes = useMemo(
    (): AxisOptions<BarDatum>[] => [
      {
        getValue: (datum) => datum.netCents / 100,
        elementType: "bar",
        formatters: {
          scale: (value: number) => moneyTick(value, currencyCode),
          tooltip: (value: number) => formatCurrency(Math.round(value * 100), currencyCode)
        }
      }
    ],
    [currencyCode]
  );
  return (
    <Chart
      options={{
        data,
        primaryAxis,
        secondaryAxes,
        getDatumStyle: (datum) => ({
          color: datum.originalDatum.netCents >= 0 ? WIN_COLOR : LOSS_COLOR
        }),
        ...interactionOptions(reducedMotion)
      }}
    />
  );
}
