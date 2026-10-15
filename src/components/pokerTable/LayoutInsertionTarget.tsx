import { useDroppable } from "@dnd-kit/core";
import type { SeatRail, TableSeatPlacement, TableShape } from "../../domain/pokerTypes";
import { getLayoutInsertionSlots } from "../../domain/tableLayout";

type InsertionTarget = {
  id: string;
  rail: SeatRail;
  order: number;
  leftPercent: number;
  topPercent: number;
};

type LayoutInsertionTargetProps = {
  target: InsertionTarget;
};

export function LayoutInsertionTarget({ target }: LayoutInsertionTargetProps) {
  const drop = useDroppable({ id: target.id });

  return (
    <button
      ref={drop.setNodeRef}
      className={`layout-drop-target layout-drop-${target.rail} ${
        drop.isOver ? "is-over" : ""
      }`}
      style={{
        left: `${target.leftPercent}%`,
        top: `${target.topPercent}%`
      }}
      type="button"
      aria-label={`Move seat to ${target.rail} position ${target.order + 1}`}
    />
  );
}

export function buildInsertionTargets(
  tableShape: TableShape,
  placements: TableSeatPlacement[]
): InsertionTarget[] {
  return getLayoutInsertionSlots(tableShape, placements).map((slot) => ({
    id: `layout-target:${slot.rail}:${slot.order}`,
    ...slot
  }));
}
