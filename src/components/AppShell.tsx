import type { ReactNode } from "react";

type AppShellProps = {
  setup: ReactNode;
  table: ReactNode;
  players: ReactNode;
  bank: ReactNode;
  transactions: ReactNode;
  cashOut: ReactNode;
  settlement: ReactNode;
};

export function AppShell({
  setup,
  table,
  players,
  bank,
  transactions,
  cashOut,
  settlement
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local ledger</p>
          <h1>Poker Tracker</h1>
        </div>
        {setup}
      </header>

      <main className="app-main">
        <section className="table-zone" aria-label="Poker table">
          {table}
        </section>

        <aside className="side-zone" aria-label="Players and bank">
          {bank}
          {players}
        </aside>

        <section className="work-zone transaction-zone" aria-label="Transactions">
          {transactions}
        </section>

        <section className="work-zone cashout-zone" aria-label="Cash out">
          {cashOut}
        </section>

        <section className="work-zone settlement-zone" aria-label="Settlement">
          {settlement}
        </section>
      </main>
    </div>
  );
}
