import { useDroppable } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import type { Player, PlayerId, PlayerLedgerSummary } from "../../domain/pokerTypes";
import type { TableSeatSlot } from "../../domain/tableLayout";
import { PlayerSeat } from "../PlayerSeat";

function positionFor(slot: TableSeatSlot): CSSProperties {
  return {
    left: `${slot.leftPercent}%`,
    top: `${slot.topPercent}%`
  };
}

type SeatSlotProps = {
  cashedOut: boolean;
  compactView: boolean;
  layoutEditing: boolean;
  isSeatDragging: boolean;
  player?: Player;
  hideActions: boolean;
  readOnly: boolean;
  slot: TableSeatSlot;
  summary?: PlayerLedgerSummary;
  onBuyIn: (player: Player) => void;
  onCashOut: (player: Player) => void;
  onEdit: (player: Player) => void;
  onSeatElementChange: (playerId: PlayerId, element: HTMLElement | null) => void;
  onStartTransfer: (fromPlayer: Player) => void;
};

export function SeatSlot({
  cashedOut,
  compactView,
  layoutEditing,
  isSeatDragging,
  player,
  hideActions,
  readOnly,
  slot,
  summary,
  onBuyIn,
  onCashOut,
  onEdit,
  onSeatElementChange,
  onStartTransfer
}: SeatSlotProps) {
  const drop = useDroppable({
    id: `seat-slot:${slot.seatIndex}`,
    disabled: readOnly || layoutEditing || compactView
  });

  return (
    <div
      ref={drop.setNodeRef}
      className={`seat-slot ${player ? "" : "is-empty"} ${drop.isOver ? "is-over" : ""}`}
      style={compactView ? { order: slot.seatIndex } : positionFor(slot)}
    >
      {player ? (
        <PlayerSeat
          cashedOut={cashedOut}
          compactView={compactView}
          layoutEditing={layoutEditing}
          player={player}
          hideActions={hideActions}
          readOnly={readOnly}
          summary={summary}
          onBuyIn={onBuyIn}
          onCashOut={onCashOut}
          onEdit={onEdit}
          onSeatElementChange={onSeatElementChange}
          onStartTransfer={onStartTransfer}
        />
      ) : (
        <div
          className="empty-seat-target"
          aria-hidden={!isSeatDragging}
          title={`Seat ${slot.seatIndex + 1}`}
        >
          Seat {slot.seatIndex + 1}
        </div>
      )}
    </div>
  );
}
