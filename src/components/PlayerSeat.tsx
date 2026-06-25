import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import {
  ArrowRightLeft,
  BadgeDollarSign,
  CircleDollarSign,
  HandCoins,
  Pencil,
  Move
} from "lucide-react";
import { describeSignedMoney } from "../domain/money";
import type { Player, PlayerLedgerSummary } from "../domain/pokerTypes";

type PlayerSeatProps = {
  player: Player;
  positionStyle: CSSProperties;
  readOnly: boolean;
  summary?: PlayerLedgerSummary;
  onBuyIn: (player: Player) => void;
  onCashOut: (player: Player) => void;
  onEdit: (player: Player) => void;
  onStartTransfer: (fromPlayer: Player) => void;
};

export function PlayerSeat({
  player,
  positionStyle,
  readOnly,
  summary,
  onBuyIn,
  onCashOut,
  onEdit,
  onStartTransfer
}: PlayerSeatProps) {
  const seatDrag = useDraggable({
    id: `seat:${player.id}`,
    disabled: readOnly
  });
  const bucketDrag = useDraggable({
    id: `bucket:${player.id}`,
    disabled: readOnly
  });
  const drop = useDroppable({
    id: `player:${player.id}`,
    disabled: readOnly
  });

  const netCents = summary?.netCents ?? 0;
  const netClass = netCents > 0 ? "positive" : netCents < 0 ? "negative" : "neutral";

  function setSeatNode(node: HTMLElement | null) {
    seatDrag.setNodeRef(node);
    drop.setNodeRef(node);
  }

  return (
    <div className="seat-position" style={positionStyle}>
      <article
        ref={setSeatNode}
        className={`player-seat ${drop.isOver ? "is-over" : ""}`}
        style={{
          transform: CSS.Translate.toString(seatDrag.transform)
        }}
      >
        <div className="seat-topline">
          <button
            className="icon-button drag-handle"
            type="button"
            disabled={readOnly}
            title="Drag to move seat"
            ref={seatDrag.setActivatorNodeRef}
            {...seatDrag.attributes}
            {...seatDrag.listeners}
          >
            <Move size={15} />
          </button>
          <span>Seat {player.seatIndex + 1}</span>
          <button
            className="icon-button"
            type="button"
            disabled={readOnly}
            title="Rename player"
            onClick={() => onEdit(player)}
          >
            <Pencil size={14} />
          </button>
        </div>

        <h3>{player.name}</h3>
        <p className={`seat-net ${netClass}`}>{describeSignedMoney(netCents)}</p>

        <div className="seat-actions">
          <button
            className="icon-button"
            type="button"
            disabled={readOnly}
            title="Record default buy-in"
            onClick={() => onBuyIn(player)}
          >
            <HandCoins size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            disabled={readOnly}
            title="Start player transfer"
            onClick={() => onStartTransfer(player)}
          >
            <ArrowRightLeft size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            disabled={readOnly}
            title="Record final chips"
            onClick={() => onCashOut(player)}
          >
            <BadgeDollarSign size={16} />
          </button>
          <button
            ref={bucketDrag.setNodeRef}
            className="icon-button chip-drag"
            type="button"
            disabled={readOnly}
            title="Drag onto another player to record a rebuy from this player"
            style={{
              transform: CSS.Translate.toString(bucketDrag.transform)
            }}
            {...bucketDrag.attributes}
            {...bucketDrag.listeners}
          >
            <CircleDollarSign size={17} />
          </button>
        </div>
      </article>
    </div>
  );
}
