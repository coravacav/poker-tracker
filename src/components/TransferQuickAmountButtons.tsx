import { formatCurrency } from "../domain/money";

type TransferQuickAmountButtonsProps = {
  defaultBuyInCents: number;
  disabled?: boolean;
  onSelect: (amountCents: number) => void;
};

const transferAmounts = [
  { label: "2 buy-ins", numerator: 2, denominator: 1 },
  { label: "1 buy-in", numerator: 1, denominator: 1 },
  { label: "1/2 buy-in", numerator: 1, denominator: 2 },
  { label: "1/4 buy-in", numerator: 1, denominator: 4 }
] as const;

export function TransferQuickAmountButtons({
  defaultBuyInCents,
  disabled = false,
  onSelect
}: TransferQuickAmountButtonsProps) {
  return transferAmounts.map(({ label, numerator, denominator }) => {
    const amountCents = Math.round((defaultBuyInCents * numerator) / denominator);

    return (
      <button
        className="transfer-quick-amount"
        type="button"
        disabled={disabled}
        key={label}
        onClick={() => onSelect(amountCents)}
      >
        <span>{label}</span>
        <small>{formatCurrency(amountCents)}</small>
      </button>
    );
  });
}
