import { formatCurrency } from "../domain/money";

type TransferPreviewProps = {
  amountCents: number;
  fromCurrentNetCents: number;
  fromName: string;
  toCurrentNetCents: number;
  toName: string;
  mode?: "gave" | "owes";
};

function signedClass(cents: number): string {
  if (cents > 0) {
    return "positive";
  }

  if (cents < 0) {
    return "negative";
  }

  return "neutral";
}

type FormulaCardProps = {
  currentNetCents: number;
  deltaCents: number;
  name: string;
  role: string;
};

function FormulaCard({
  currentNetCents,
  deltaCents,
  name,
  role
}: FormulaCardProps) {
  const nextNetCents = currentNetCents + deltaCents;
  const deltaSign = deltaCents >= 0 ? "+" : "-";

  return (
    <article className="preview-card">
      <div className="preview-card-heading">
        <span>{name}</span>
        <small>{role}</small>
      </div>
      <div className="preview-formula">
        <strong className={signedClass(currentNetCents)}>
          {formatCurrency(currentNetCents)}
        </strong>
        <span className="formula-operator">{deltaSign}</span>
        <strong className="formula-delta">{formatCurrency(Math.abs(deltaCents))}</strong>
        <span className="formula-operator">=</span>
        <strong className={signedClass(nextNetCents)}>
          {formatCurrency(nextNetCents)}
        </strong>
      </div>
    </article>
  );
}

export type LedgerImpact = {
  currentCents: number;
  deltaCents: number;
  name: string;
  role: string;
};

type LedgerImpactPreviewProps = {
  ariaLabel?: string;
  impacts: LedgerImpact[];
};

export function LedgerImpactPreview({
  ariaLabel = "Ledger impact preview",
  impacts
}: LedgerImpactPreviewProps) {
  return (
    <div className="transfer-preview" aria-label={ariaLabel}>
      {impacts.map((impact) => (
        <FormulaCard
          key={`${impact.role}:${impact.name}`}
          currentNetCents={impact.currentCents}
          deltaCents={impact.deltaCents}
          name={impact.name}
          role={impact.role}
        />
      ))}
    </div>
  );
}

export function TransferPreview({
  amountCents,
  fromCurrentNetCents,
  fromName,
  toCurrentNetCents,
  toName,
  mode = "gave"
}: TransferPreviewProps) {
  const isOwed = mode === "owes";
  return (
    <LedgerImpactPreview
      ariaLabel={isOwed ? "Player owes preview" : "Player gave preview"}
      impacts={[
        {
          currentCents: fromCurrentNetCents,
          deltaCents: isOwed ? -amountCents : amountCents,
          name: fromName,
          role: isOwed ? "Owes" : "Giver"
        },
        {
          currentCents: toCurrentNetCents,
          deltaCents: isOwed ? amountCents : -amountCents,
          name: toName,
          role: isOwed ? "Owed to" : "Receiver"
        }
      ]}
    />
  );
}
