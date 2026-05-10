import { formatCurrency } from "../domain/money";

type TransferPreviewProps = {
  amountCents: number;
  fromCurrentNetCents: number;
  fromName: string;
  toCurrentNetCents: number;
  toName: string;
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
  amountCents: number;
  currentNetCents: number;
  deltaSign: "+" | "-";
  name: string;
  role: "Sender" | "Receiver";
};

function FormulaCard({
  amountCents,
  currentNetCents,
  deltaSign,
  name,
  role
}: FormulaCardProps) {
  const nextNetCents =
    deltaSign === "+"
      ? currentNetCents + amountCents
      : currentNetCents - amountCents;

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
        <strong className="formula-delta">{formatCurrency(amountCents)}</strong>
        <span className="formula-operator">=</span>
        <strong className={signedClass(nextNetCents)}>
          {formatCurrency(nextNetCents)}
        </strong>
      </div>
    </article>
  );
}

export function TransferPreview({
  amountCents,
  fromCurrentNetCents,
  fromName,
  toCurrentNetCents,
  toName
}: TransferPreviewProps) {
  return (
    <div className="transfer-preview" aria-label="Transfer preview">
      <FormulaCard
        amountCents={amountCents}
        currentNetCents={fromCurrentNetCents}
        deltaSign="+"
        name={fromName}
        role="Sender"
      />
      <FormulaCard
        amountCents={amountCents}
        currentNetCents={toCurrentNetCents}
        deltaSign="-"
        name={toName}
        role="Receiver"
      />
    </div>
  );
}
