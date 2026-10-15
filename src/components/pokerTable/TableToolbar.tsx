import {
  ArrowDown,
  ArrowUp,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw
} from "lucide-react";
import type { Dispatch } from "react";
import type { TableShape } from "../../domain/pokerTypes";
import type { GameAction } from "../../state/gameReducer";
import { useFormatCurrency } from "../CurrencyContext";

export type PlayerArrangement = "rotate_left" | "rotate_right" | "reverse";

const SHAPES: Array<{ shape: TableShape; label: string }> = [
  { shape: "rectangle", label: "Rectangle" },
  { shape: "oval", label: "Oval" },
  { shape: "round", label: "Round" }
];

type TableToolbarProps = {
  compactView: boolean;
  layoutEditing: boolean;
  readOnly: boolean;
  playerCount: number;
  tableShape: TableShape;
  defaultBuyInCents: number;
  dispatch: Dispatch<GameAction>;
  onArrange: (arrangement: PlayerArrangement) => void;
};

/** Table heading with the player arrangement, table shape, and default buy-in controls. */
export function TableToolbar({
  compactView,
  layoutEditing,
  readOnly,
  playerCount,
  tableShape,
  defaultBuyInCents,
  dispatch,
  onArrange
}: TableToolbarProps) {
  const formatCurrency = useFormatCurrency();

  return (
    <div className="table-toolbar">
      <div>
        <p className="eyebrow">
          <span className="table-view-only" aria-hidden={compactView}>
            Drag seats to rearrange
          </span>
          <span className="player-list-only" aria-hidden={!compactView}>
            Player actions
          </span>
        </p>
        <h2>
          <span className="table-view-only" aria-hidden={compactView}>
            Table Layout
          </span>
          <span className="player-list-only" aria-hidden={!compactView}>
            Players
          </span>
        </h2>
      </div>
      <div className="table-toolbar-controls">
        {layoutEditing || (compactView && !readOnly) ? (
          <div
            className="player-arrangement-controls"
            role="group"
            aria-label={compactView ? "Arrange player list" : "Arrange players"}
          >
            <button
              type="button"
              aria-label={compactView ? "Shift player order up" : "Rotate players left"}
              title={compactView ? "Shift player order up" : "Rotate players left"}
              disabled={readOnly || playerCount < 2}
              onClick={() => onArrange("rotate_left")}
            >
              {compactView ? <ArrowUp size={18} /> : <RotateCcw size={17} />}
            </button>
            <button
              type="button"
              aria-label="Reverse player order"
              title="Reverse player order"
              disabled={readOnly || playerCount < 2}
              onClick={() => onArrange("reverse")}
            >
              {compactView ? <FlipVertical2 size={18} /> : <FlipHorizontal2 size={17} />}
            </button>
            <button
              type="button"
              aria-label={compactView ? "Shift player order down" : "Rotate players right"}
              title={compactView ? "Shift player order down" : "Rotate players right"}
              disabled={readOnly || playerCount < 2}
              onClick={() => onArrange("rotate_right")}
            >
              {compactView ? <ArrowDown size={18} /> : <RotateCw size={17} />}
            </button>
          </div>
        ) : null}
        {layoutEditing ? (
          <div className="shape-segments" aria-label="Table shape">
            {SHAPES.map(({ shape, label }) => (
              <button
                key={shape}
                type="button"
                aria-pressed={tableShape === shape}
                disabled={readOnly}
                onClick={() => dispatch({ type: "set_table_shape", shape })}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <span className="default-buy-in">
          Default buy-in {formatCurrency(defaultBuyInCents)}
        </span>
      </div>
    </div>
  );
}
