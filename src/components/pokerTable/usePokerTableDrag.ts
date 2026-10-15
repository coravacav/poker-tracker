import {
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { useState } from "react";
import type { Dispatch } from "react";
import type { Player, PlayerId, SeatRail } from "../../domain/pokerTypes";
import type { GameAction } from "../../state/gameReducer";

export const pokerTableCollisionDetection: CollisionDetection = (args) =>
  String(args.active.id).startsWith("table-seat:")
    ? pointerWithin(args)
    : rectIntersection(args);

type PokerTableDragOptions = {
  activePlayers: Player[];
  compactView: boolean;
  dispatch: Dispatch<GameAction>;
  layoutEditing: boolean;
  playerBySeatIndex: Map<number, Player>;
  readOnly: boolean;
  openTransfer: (fromPlayerId: PlayerId, toPlayerId?: PlayerId) => void;
  snapshotPlayerSeatRects: () => void;
};

/**
 * Drag-and-drop on the table: drag a seat to move a player, a chip bucket onto
 * another player to start a transfer, or (while editing the layout) a table
 * seat onto an insertion target.
 */
export function usePokerTableDrag({
  activePlayers,
  compactView,
  dispatch,
  layoutEditing,
  playerBySeatIndex,
  readOnly,
  openTransfer,
  snapshotPlayerSeatRects
}: PokerTableDragOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const [activeDragType, setActiveDragType] = useState<
    "seat" | "bucket" | "table-seat" | null
  >(null);

  function handleDragStart(event: DragStartEvent) {
    if (compactView) return;
    const activeId = String(event.active.id);
    const [, dragType] = activeId.match(/^(seat|bucket|table-seat):(.+)$/) ?? [];
    setActiveDragType(
      dragType === "seat" || dragType === "bucket" || dragType === "table-seat"
        ? dragType
        : null
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragType(null);

    if (compactView || readOnly || !event.over) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const [, dragType, draggedId] = activeId.match(/^(seat|bucket|table-seat):(.+)$/) ?? [];

    if (dragType === "table-seat") {
      if (!layoutEditing || !overId.startsWith("layout-target:")) {
        return;
      }

      const [, rail, order] = overId.match(/^layout-target:(top|right|bottom|left):(\d+)$/) ?? [];
      const seatIndex = Number.parseInt(draggedId, 10);
      const targetOrder = Number.parseInt(order, 10);

      if (!rail || Number.isNaN(seatIndex) || Number.isNaN(targetOrder)) {
        return;
      }

      dispatch({
        type: "move_table_seat",
        seatIndex,
        rail: rail as SeatRail,
        order: targetOrder
      });
      return;
    }

    if (!overId.startsWith("seat-slot:")) {
      return;
    }

    const targetSeatIndex = Number.parseInt(overId.replace("seat-slot:", ""), 10);
    const targetPlayer = playerBySeatIndex.get(targetSeatIndex);

    if (!dragType || !draggedId || Number.isNaN(targetSeatIndex)) {
      return;
    }

    if (dragType === "seat") {
      const movingPlayer = activePlayers.find((player) => player.id === draggedId);

      if (!movingPlayer || movingPlayer.seatIndex === targetSeatIndex) {
        return;
      }

      snapshotPlayerSeatRects();
      dispatch({
        type: "move_player_to_seat",
        playerId: draggedId,
        seatIndex: targetSeatIndex
      });
    }

    if (dragType === "bucket" && targetPlayer && draggedId !== targetPlayer.id) {
      openTransfer(draggedId, targetPlayer.id);
    }
  }

  return { sensors, activeDragType, setActiveDragType, handleDragStart, handleDragEnd };
}
