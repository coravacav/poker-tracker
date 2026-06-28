import {
  ArrowRightLeft,
  BadgeDollarSign,
  CircleDollarSign,
  HandCoins,
  Move,
  Pencil
} from "lucide-react";

const items = [
  { label: "Move seat", icon: Move },
  { label: "Rename", icon: Pencil },
  { label: "Buy-in", icon: HandCoins },
  { label: "Transfer", icon: ArrowRightLeft },
  { label: "Final chips", icon: BadgeDollarSign },
  { label: "Drag transfer", icon: CircleDollarSign }
];

type IconKeyProps = {
  layoutEditing: boolean;
};

export function IconKey({ layoutEditing }: IconKeyProps) {
  const visibleItems = layoutEditing
    ? items
    : items.filter((item) => item.label !== "Move seat");

  return (
    <section className="panel icon-key" aria-label="Card icon key">
      <div className="panel-heading compact-heading">
        <div>
          <p className="eyebrow">Seat cards</p>
          <h2>Icon Key</h2>
        </div>
      </div>
      <dl>
        {visibleItems.map(({ label, icon: Icon }) => (
          <div key={label}>
            <dt>
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
