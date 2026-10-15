/**
 * Player History over time: charts, their legends, summary tiles, and data
 * tables. This module and the charting library it uses are loaded lazily by
 * SessionHistoryPanel so they stay out of the main bundle.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  buildPersonTimelines,
  cumulativeSeries,
  initialSeriesSlots,
  MAX_CHART_SERIES,
  summarizePersonResults,
  toggleSeriesSlot,
  type PersonTimeline,
  type SeriesSlots
} from "../domain/historyTrends";
import { formatCurrency, type CurrencyCode } from "../domain/money";
import type { PeopleDirectory } from "../domain/people";
import type { ArchivedGame } from "../domain/sessionHistory";
import { CumulativeNetChart, PersonResultsChart, type ChartSeries } from "./HistoryCharts";

/**
 * Categorical chart colors in fixed order (one per slot, never cycled),
 * checked for color-vision-deficiency separation on the white panel. Slots 3–5
 * are under 3:1 contrast, so every series is also named in the legend and the
 * data table.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
/** Newest games drawn as bars; the table below the chart lists every game. */
export const MAX_RESULT_BARS = 40;
const COLLAPSED_PEOPLE = 10;

const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

function signed(cents: number, currencyCode: CurrencyCode): string {
  return `${cents > 0 ? "+" : ""}${formatCurrency(cents, currencyCode)}`;
}

function tone(cents: number): string {
  return cents > 0 ? "positive" : cents < 0 ? "negative" : "neutral";
}

/** The chart is drawn for sighted users; the label and the data table carry the same values. */
function ChartFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="history-chart" role="img" aria-label={label}>
      {children}
    </div>
  );
}

export default function HistoryTrends({
  games,
  rangeGames,
  directory,
  currencies,
  rangeLabel
}: {
  /** Every archived game; picks the default people so a range change never repaints them. */
  games: ArchivedGame[];
  /** Games inside the selected date range. */
  rangeGames: ArchivedGame[];
  directory: PeopleDirectory;
  /** Currencies of the games in range, main currency first (historyCurrencies); not empty. */
  currencies: CurrencyCode[];
  /** "in the last 30 days", "" for all time. */
  rangeLabel: string;
}) {
  const [pickedCurrency, setPickedCurrency] = useState<CurrencyCode | null>(null);
  // Charts show one currency at a time; amounts in different currencies are never combined.
  const currencyCode = pickedCurrency && currencies.includes(pickedCurrency) ? pickedCurrency : currencies[0];
  const allTimelines = useMemo(() => buildPersonTimelines(games, directory, currencyCode), [currencyCode, directory, games]);
  const timelines = useMemo(
    () => buildPersonTimelines(rangeGames, directory, currencyCode),
    [currencyCode, directory, rangeGames]
  );
  const [chosen, setChosen] = useState<{ currencyCode: CurrencyCode; slots: SeriesSlots } | null>(null);
  const slots = chosen?.currencyCode === currencyCode ? chosen.slots : initialSeriesSlots(allTimelines);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const currencyPicker =
    currencies.length > 1 ? (
      <label className="history-currency-picker">
        <span>Currency</span>
        <select value={currencyCode} onChange={(event) => setPickedCurrency(event.currentTarget.value as CurrencyCode)}>
          {currencies.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </label>
    ) : null;
  const heading = (
    <div className="history-trend-heading">
      <h3>Over time{currencies.length > 1 ? "" : ` (${currencyCode})`}</h3>
      {currencyPicker}
    </div>
  );

  if (timelines.length === 0) {
    return <div className="history-trends">{heading}<p className="muted">No {currencyCode} results {rangeLabel || "yet"}.</p></div>;
  }

  const timelineByKey = new Map(timelines.map((timeline) => [timeline.key, timeline]));
  const series: ChartSeries[] = slots.flatMap((key, slot) => {
    const timeline = key ? timelineByKey.get(key) : undefined;
    return timeline
      ? [{ key: timeline.key, name: timeline.name, color: SERIES_COLORS[slot], points: cumulativeSeries(timeline.results) }]
      : [];
  });
  const slotsFull = slots.filter(Boolean).length >= MAX_CHART_SERIES;
  const listedPeople = showAllPeople
    ? timelines
    : timelines.filter((timeline, index) => index < COLLAPSED_PEOPLE || slots.includes(timeline.key));
  const chartRows = series
    .flatMap((entry) => entry.points.map((point) => ({ name: entry.name, key: entry.key, point })))
    .sort((left, right) => left.point.playedAtMs - right.point.playedAtMs || left.name.localeCompare(right.name));
  const chartLabel =
    series.length === 0
      ? "No players selected."
      : `Running total in ${currencyCode} ${rangeLabel || "over all games"}: ` +
        series
          .map((entry) => {
            const last = entry.points[entry.points.length - 1];
            return `${entry.name} ${signed(last.cumulativeCents, currencyCode)} after ${entry.points.length} ${entry.points.length === 1 ? "game" : "games"}`;
          })
          .join("; ") +
        ".";

  function toggle(key: string) {
    setChosen({ currencyCode, slots: toggleSeriesSlot(slots, key) });
  }

  const focus: PersonTimeline = (focusKey ? timelineByKey.get(focusKey) : undefined) ?? timelines[0];
  const summary = summarizePersonResults(currencyCode, focus.results)!;
  const focusRows = cumulativeSeries(focus.results);
  const bars = focus.results.slice(-MAX_RESULT_BARS);

  return (
    <div className="history-trends">
      {heading}
      <section className="history-trend" aria-labelledby="history-trend-cumulative">
        <h4 id="history-trend-cumulative">Running total</h4>
        <p className="muted history-trend-note">
          Each dot is a game, dated by its first buy-in. Choose up to {MAX_CHART_SERIES} players.
        </p>
        <div className="history-series-toggles" role="group" aria-label="Players on the chart">
          {listedPeople.map((timeline) => {
            const slot = slots.indexOf(timeline.key);
            const shown = slot >= 0;
            const last = timeline.results.reduce((total, result) => total + result.netCents, 0);
            return (
              <button
                key={timeline.key}
                type="button"
                className="history-series-toggle"
                aria-pressed={shown}
                disabled={!shown && slotsFull}
                onClick={() => toggle(timeline.key)}
              >
                <span
                  className="history-series-swatch"
                  aria-hidden="true"
                  style={shown ? { background: SERIES_COLORS[slot], borderColor: SERIES_COLORS[slot] } : undefined}
                />
                {timeline.name}
                {shown ? <small className={tone(last)}>{signed(last, currencyCode)}</small> : null}
              </button>
            );
          })}
          {timelines.length > COLLAPSED_PEOPLE ? (
            <button className="text-button" type="button" onClick={() => setShowAllPeople((value) => !value)}>
              {showAllPeople ? "Show fewer" : `Show all ${timelines.length}`}
            </button>
          ) : null}
        </div>
        {series.length === 0 ? (
          <p className="history-chart-message muted">Choose players above to draw their running totals.</p>
        ) : (
          <>
            <ChartFrame label={chartLabel}>
              <CumulativeNetChart series={series} currencyCode={currencyCode} />
            </ChartFrame>
            <details className="history-chart-data">
              <summary>Chart data as a table</summary>
              <div className="history-table-scroll">
                <table>
                  <thead>
                    <tr><th scope="col">Date</th><th scope="col">Player</th><th scope="col">Result</th><th scope="col">Running total</th></tr>
                  </thead>
                  <tbody>
                    {chartRows.map(({ key, name, point }, index) => (
                      <tr key={`${key}:${point.gameId}:${index}`}>
                        <td>{fullDate.format(point.playedAtMs)}</td>
                        <td>{name}</td>
                        <td className={tone(point.netCents)}>{signed(point.netCents, currencyCode)}</td>
                        <td className={tone(point.cumulativeCents)}>{signed(point.cumulativeCents, currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <section className="history-trend" aria-labelledby="history-trend-person">
        <div className="history-trend-heading">
          <h4 id="history-trend-person">Game by game</h4>
          <label className="history-person-picker">
            <span>Player</span>
            <select value={focus.key} onChange={(event) => setFocusKey(event.currentTarget.value)}>
              {timelines.map((timeline) => (
                <option key={timeline.key} value={timeline.key}>{timeline.name}</option>
              ))}
            </select>
          </label>
        </div>
        <dl className="history-tiles">
          <div><dt>Games</dt><dd>{summary.games}</dd></div>
          <div><dt>Total</dt><dd className={tone(summary.totalNetCents)}>{signed(summary.totalNetCents, currencyCode)}</dd></div>
          <div><dt>Average</dt><dd className={tone(summary.averageNetCents)}>{signed(summary.averageNetCents, currencyCode)}</dd></div>
          <div><dt>Win rate</dt><dd>{percent.format(summary.winRate)}<small> {summary.wins} of {summary.games}</small></dd></div>
          <div><dt>Best</dt><dd className={tone(summary.biggestWinCents)}>{signed(summary.biggestWinCents, currencyCode)}</dd></div>
          <div><dt>Worst</dt><dd className={tone(summary.biggestLossCents)}>{signed(summary.biggestLossCents, currencyCode)}</dd></div>
        </dl>
        <ChartFrame
          label={`${focus.name}'s result in each of ${bars.length === focus.results.length ? "their" : `their latest ${bars.length} of`} ${focus.results.length} ${focus.results.length === 1 ? "game" : "games"}: ${summary.wins} won, ${summary.games - summary.wins} not won.`}
        >
          <PersonResultsChart results={bars} currencyCode={currencyCode} />
        </ChartFrame>
        {bars.length < focus.results.length ? (
          <p className="muted history-trend-note">Showing the latest {bars.length} of {focus.results.length} games.</p>
        ) : null}
        <details className="history-chart-data">
          <summary>{focus.name}'s games as a table</summary>
          <div className="history-table-scroll">
            <table>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Game</th><th scope="col">Result</th><th scope="col">Running total</th></tr>
              </thead>
              <tbody>
                {focusRows.map((row, index) => (
                  <tr key={`${row.gameId}:${index}`}>
                    <td>{fullDate.format(row.playedAtMs)}</td>
                    <td>{row.gameName}</td>
                    <td className={tone(row.netCents)}>{signed(row.netCents, currencyCode)}</td>
                    <td className={tone(row.cumulativeCents)}>{signed(row.cumulativeCents, currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
