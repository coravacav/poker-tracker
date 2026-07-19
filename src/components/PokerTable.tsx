import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch } from "react";
import { centsToInputValue, formatCurrency, parseMoneyToCents } from "../domain/money";
import type {
  Player,
  PlayerId,
  PlayerLedgerSummary,
  SeatRail,
  TableSeatPlacement,
  TableShape,
  Transaction
} from "../domain/pokerTypes";
import {
  getLayoutInsertionSlots,
  getSeatSlots,
  getTableLayoutMetrics,
  type TableSeatSlot
} from "../domain/tableLayout";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { PlayerSeat } from "./PlayerSeat";
import { LedgerImpactPreview, TransferPreview } from "./TransferPreview";
import { TransferQuickAmountButtons } from "./TransferQuickAmountButtons";

type PokerTableProps = {
  activePlayers: Player[];
  bankBalanceCents: number;
  defaultBuyInCents: number;
  dispatch: Dispatch<GameAction>;
  layoutEditing: boolean;
  onAddTransaction: (transaction: Transaction) => boolean;
  readOnly: boolean;
  tableSeatPlacements: TableSeatPlacement[];
  tableShape: TableShape;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
};

type TransferDraft = {
  mode: "give_chips" | "cover_buy_in";
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountInput: string;
  note: string;
};

type PartialCashOutDraft = {
  playerId: PlayerId;
  amountInput: string;
  note: string;
};

type RenameDraft = {
  playerId: PlayerId;
  nameInput: string;
};

const SHAPES: Array<{ shape: TableShape; label: string }> = [
  { shape: "rectangle", label: "Rectangle" },
  { shape: "oval", label: "Oval" },
  { shape: "round", label: "Round" }
];
const CARD_REARRANGE_ANIMATION_MS = 240;
const pokerTableCollisionDetection: CollisionDetection = (args) =>
  String(args.active.id).startsWith("table-seat:")
    ? pointerWithin(args)
    : rectIntersection(args);

function positionFor(slot: TableSeatSlot): CSSProperties {
  return {
    left: `${slot.leftPercent}%`,
    top: `${slot.topPercent}%`
  };
}

type SeatSlotProps = {
  layoutEditing: boolean;
  isSeatDragging: boolean;
  player?: Player;
  readOnly: boolean;
  slot: TableSeatSlot;
  summary?: PlayerLedgerSummary;
  onBuyIn: (player: Player) => void;
  onCashOut: (player: Player) => void;
  onEdit: (player: Player) => void;
  onSeatElementChange: (playerId: PlayerId, element: HTMLElement | null) => void;
  onStartTransfer: (fromPlayer: Player) => void;
};

function SeatSlot({
  layoutEditing,
  isSeatDragging,
  player,
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
    disabled: readOnly || layoutEditing
  });

  return (
    <div
      ref={drop.setNodeRef}
      className={`seat-slot ${drop.isOver ? "is-over" : ""}`}
      style={positionFor(slot)}
    >
      {player ? (
        <PlayerSeat
          layoutEditing={layoutEditing}
          player={player}
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

function LayoutInsertionTarget({ target }: LayoutInsertionTargetProps) {
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

function buildInsertionTargets(
  tableShape: TableShape,
  placements: TableSeatPlacement[]
): InsertionTarget[] {
  return getLayoutInsertionSlots(tableShape, placements).map((slot) => ({
    id: `layout-target:${slot.rail}:${slot.order}`,
    ...slot
  }));
}

export function PokerTable({
  activePlayers,
  bankBalanceCents,
  defaultBuyInCents,
  dispatch,
  layoutEditing,
  onAddTransaction,
  readOnly,
  tableSeatPlacements,
  tableShape,
  summaryByPlayerId
}: PokerTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [partialCashOutDraft, setPartialCashOutDraft] =
    useState<PartialCashOutDraft | null>(null);
  const [partialCashOutError, setPartialCashOutError] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<
    "seat" | "bucket" | "table-seat" | null
  >(null);
  const playerSeatElementsRef = useRef(new Map<PlayerId, HTMLElement>());
  const previousPlayerRectsRef = useRef(new Map<PlayerId, DOMRect>());
  const cardAnimationsRef = useRef(new Map<PlayerId, Animation>());

  const seatSlots = useMemo(
    () => getSeatSlots(tableShape, tableSeatPlacements),
    [tableSeatPlacements, tableShape]
  );
  const layoutMetrics = useMemo(
    () => getTableLayoutMetrics(tableSeatPlacements),
    [tableSeatPlacements]
  );
  const insertionTargets = useMemo(
    () => buildInsertionTargets(tableShape, tableSeatPlacements),
    [tableSeatPlacements, tableShape]
  );
  const playerBySeatIndex = useMemo(
    () =>
      new Map(activePlayers.map((player) => [player.seatIndex, player] as const)),
    [activePlayers]
  );

  const setPlayerSeatElement = useCallback(
    (playerId: PlayerId, element: HTMLElement | null) => {
      if (element) {
        playerSeatElementsRef.current.set(playerId, element);
        return;
      }

      playerSeatElementsRef.current.delete(playerId);
    },
    []
  );

  function snapshotPlayerSeatRects() {
    previousPlayerRectsRef.current = new Map(
      Array.from(playerSeatElementsRef.current.entries()).map(([playerId, element]) => [
        playerId,
        element.getBoundingClientRect()
      ])
    );
  }

  useLayoutEffect(() => {
    const previousRects = previousPlayerRectsRef.current;

    if (previousRects.size === 0) {
      return;
    }

    previousPlayerRectsRef.current = new Map();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      return;
    }

    for (const player of activePlayers) {
      const element = playerSeatElementsRef.current.get(player.id);
      const previousRect = previousRects.get(player.id);

      if (!element || !previousRect || typeof element.animate !== "function") {
        continue;
      }

      const currentRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        continue;
      }

      cardAnimationsRef.current.get(player.id)?.cancel();
      element.classList.add("is-rearranging");

      const animation = element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: CARD_REARRANGE_ANIMATION_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        }
      );

      cardAnimationsRef.current.set(player.id, animation);

      const clearAnimation = () => {
        if (cardAnimationsRef.current.get(player.id) !== animation) {
          return;
        }

        cardAnimationsRef.current.delete(player.id);
        element.classList.remove("is-rearranging");
      };

      animation.addEventListener("finish", clearAnimation);
      animation.addEventListener("cancel", clearAnimation);
    }
  }, [activePlayers]);

  function playerName(playerId: PlayerId): string {
    return activePlayers.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function openTransfer(fromPlayerId: PlayerId, toPlayerId?: PlayerId) {
    const fallbackToPlayerId =
      toPlayerId ??
      activePlayers.find((player) => player.id !== fromPlayerId)?.id ??
      fromPlayerId;

    setTransferDraft({
      mode: "give_chips",
      fromPlayerId,
      toPlayerId: fallbackToPlayerId,
      amountInput: centsToInputValue(defaultBuyInCents),
      note: ""
    });
    setTransferError(null);
  }

  function handleDragStart(event: DragStartEvent) {
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

    if (readOnly || !event.over) {
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

  function quickBuyIn(player: Player) {
    onAddTransaction({
      id: createId("transaction"),
      type: "bank_buy_in",
      createdAt: new Date().toISOString(),
      amountCents: defaultBuyInCents,
      toPlayerId: player.id,
      note: "Default buy-in"
    });
  }

  function openPartialCashOut(player: Player) {
    setPartialCashOutDraft({
      playerId: player.id,
      amountInput: centsToInputValue(defaultBuyInCents),
      note: ""
    });
    setPartialCashOutError(null);
  }

  function confirmPartialCashOut() {
    if (!partialCashOutDraft) return;
    const amountCents = parseMoneyToCents(partialCashOutDraft.amountInput);
    if (!amountCents || amountCents <= 0) {
      setPartialCashOutError("Enter a positive cash-out amount.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "bank_cash_out",
      cashOutKind: "partial",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: partialCashOutDraft.playerId,
      note: partialCashOutDraft.note.trim() || undefined
    });

    if (added) {
      setPartialCashOutDraft(null);
      setPartialCashOutError(null);
    }
  }

  function editPlayerName(player: Player) {
    setRenameDraft({
      playerId: player.id,
      nameInput: player.name
    });
    setRenameError(null);
  }

  function confirmTransfer() {
    if (!transferDraft) {
      return;
    }

    const amountCents = parseMoneyToCents(transferDraft.amountInput);
    if (transferDraft.fromPlayerId === transferDraft.toPlayerId) {
      setTransferError("Choose two different players.");
      return;
    }

    if (!amountCents || amountCents <= 0) {
      setTransferError("Enter a positive transfer amount.");
      return;
    }

    const added = onAddTransaction(
      transferDraft.mode === "cover_buy_in"
        ? {
            id: createId("transaction"),
            type: "bank_buy_in",
            createdAt: new Date().toISOString(),
            amountCents,
            toPlayerId: transferDraft.toPlayerId,
            coveredByPlayerId: transferDraft.fromPlayerId,
            note: transferDraft.note.trim() || undefined
          }
        : {
            id: createId("transaction"),
            type: "player_transfer",
            createdAt: new Date().toISOString(),
            amountCents,
            fromPlayerId: transferDraft.fromPlayerId,
            toPlayerId: transferDraft.toPlayerId,
            category: "poker",
            note: transferDraft.note.trim() || undefined
          }
    );

    if (added) {
      setTransferDraft(null);
      setTransferError(null);
    }
  }

  function confirmRename() {
    if (!renameDraft) {
      return;
    }

    const name = renameDraft.nameInput.trim();
    if (!name) {
      setRenameError("Enter a player name.");
      return;
    }

    dispatch({ type: "rename_player", playerId: renameDraft.playerId, name });
    setRenameDraft(null);
    setRenameError(null);
  }

  const transferPreviewAmountCents = transferDraft
    ? parseMoneyToCents(transferDraft.amountInput)
    : null;
  const showTransferPreview =
    !!transferDraft &&
    !!transferPreviewAmountCents &&
    transferPreviewAmountCents > 0 &&
    transferDraft.fromPlayerId !== transferDraft.toPlayerId;
  const transferFromCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.fromPlayerId)?.netCents ?? 0
    : 0;
  const transferToCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.toPlayerId)?.netCents ?? 0
    : 0;
  const partialCashOutAmountCents = partialCashOutDraft
    ? parseMoneyToCents(partialCashOutDraft.amountInput)
    : null;
  const partialCashOutPlayerNet = partialCashOutDraft
    ? summaryByPlayerId.get(partialCashOutDraft.playerId)?.netCents ?? 0
    : 0;
  const tableShapeClass =
    tableShape === "rectangle"
      ? "layout-rectangle"
      : tableShape === "round"
        ? "layout-round"
        : "layout-oval";
  const tableClassName = [
    "poker-table",
    tableShapeClass,
    layoutEditing ? "is-layout-editing" : "",
    activeDragType === "seat" ? "is-seat-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="poker-table-panel">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Drag seats to rearrange</p>
          <h2>Table Layout</h2>
        </div>
        <div className="table-toolbar-controls">
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

      <DndContext
        sensors={sensors}
        collisionDetection={pokerTableCollisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDragType(null)}
        onDragEnd={handleDragEnd}
      >
        <div
          className={tableClassName}
          aria-label="Poker seating"
          style={{
            minWidth: `${layoutMetrics.minWidthPx}px`,
            minHeight: `${layoutMetrics.minHeightPx}px`
          }}
        >
          <div className="felt-center">
            <span>{activePlayers.length}</span>
            <small>players</small>
          </div>
          {layoutEditing
            ? insertionTargets.map((target) => (
                <LayoutInsertionTarget key={target.id} target={target} />
              ))
            : null}
          {seatSlots.map((slot) => {
            const player = playerBySeatIndex.get(slot.seatIndex);

            return (
              <SeatSlot
                key={slot.seatIndex}
                layoutEditing={layoutEditing}
                isSeatDragging={activeDragType === "seat"}
                player={player}
                readOnly={readOnly}
                slot={slot}
                summary={player ? summaryByPlayerId.get(player.id) : undefined}
                onBuyIn={quickBuyIn}
                onCashOut={openPartialCashOut}
                onEdit={editPlayerName}
                onSeatElementChange={setPlayerSeatElement}
                onStartTransfer={(fromPlayer) => openTransfer(fromPlayer.id)}
              />
            );
          })}
        </div>
      </DndContext>

      {partialCashOutDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal table-action-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Partial cash-out"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Partial cash-out</p>
                <h2>Cash out {playerName(partialCashOutDraft.playerId)}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setPartialCashOutDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>

            <p className="muted">
              Record a during-game payout without marking this player finished for the night.
            </p>

            <div className="form-grid two">
              <label>
                <span>Amount</span>
                <input
                  inputMode="decimal"
                  value={partialCashOutDraft.amountInput}
                  onChange={(event) => {
                    setPartialCashOutDraft({
                      ...partialCashOutDraft,
                      amountInput: event.currentTarget.value
                    });
                    setPartialCashOutError(null);
                  }}
                />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={partialCashOutDraft.note}
                  placeholder="Optional"
                  onChange={(event) =>
                    setPartialCashOutDraft({
                      ...partialCashOutDraft,
                      note: event.currentTarget.value
                    })
                  }
                />
              </label>
            </div>

            <div className="quick-amounts">
              <TransferQuickAmountButtons
                defaultBuyInCents={defaultBuyInCents}
                onSelect={(amountCents) => {
                  setPartialCashOutDraft({
                    ...partialCashOutDraft,
                    amountInput: centsToInputValue(amountCents)
                  });
                  setPartialCashOutError(null);
                }}
              />
            </div>

            {partialCashOutAmountCents !== null && partialCashOutAmountCents > 0 ? (
              <LedgerImpactPreview
                ariaLabel="Partial cash-out preview"
                impacts={[
                  {
                    currentCents: partialCashOutPlayerNet,
                    deltaCents: partialCashOutAmountCents,
                    name: playerName(partialCashOutDraft.playerId),
                    role: "Player net"
                  },
                  {
                    currentCents: bankBalanceCents,
                    deltaCents: -partialCashOutAmountCents,
                    name: "Chip Pool",
                    role: "In play"
                  }
                ]}
              />
            ) : null}

            {partialCashOutError ? (
              <div className="notice notice-warning">{partialCashOutError}</div>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setPartialCashOutDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmPartialCashOut}>
                Record partial cash-out
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {transferDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Player transfer">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">
                  {transferDraft.mode === "cover_buy_in" ? "Covered buy-in" : "Player transfer"}
                </p>
                <h2>
                  {playerName(transferDraft.toPlayerId)} receives from{" "}
                  {playerName(transferDraft.fromPlayerId)}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setTransferDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>

            <div className="shape-segments transfer-mode-segments" aria-label="Transfer action">
              <button
                type="button"
                aria-pressed={transferDraft.mode === "give_chips"}
                onClick={() =>
                  setTransferDraft({ ...transferDraft, mode: "give_chips" })
                }
              >
                Give chips
              </button>
              <button
                type="button"
                aria-pressed={transferDraft.mode === "cover_buy_in"}
                onClick={() =>
                  setTransferDraft({ ...transferDraft, mode: "cover_buy_in" })
                }
              >
                Cover buy-in
              </button>
            </div>

            <div className="form-grid two">
              <label>
                <span>{transferDraft.mode === "cover_buy_in" ? "Covered by" : "From"}</span>
                <select
                  value={transferDraft.fromPlayerId}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      fromPlayerId: event.currentTarget.value
                    })
                  }
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{transferDraft.mode === "cover_buy_in" ? "Chips to" : "To"}</span>
                <select
                  value={transferDraft.toPlayerId}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      toPlayerId: event.currentTarget.value
                    })
                  }
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
              {showTransferPreview && transferDraft ? (
                transferDraft.mode === "cover_buy_in" ? (
                  <div className="covered-buy-in-preview">
                    <LedgerImpactPreview
                      ariaLabel="Covered buy-in preview"
                      impacts={[
                        {
                          currentCents: transferFromCurrentNet,
                          deltaCents: -(transferPreviewAmountCents ?? 0),
                          name: playerName(transferDraft.fromPlayerId),
                          role: "Coverer"
                        },
                        {
                          currentCents: bankBalanceCents,
                          deltaCents: transferPreviewAmountCents ?? 0,
                          name: "Chip Pool",
                          role: "In play"
                        }
                      ]}
                    />
                    <p className="muted transfer-recipient-note">
                      {playerName(transferDraft.toPlayerId)} receives {formatCurrency(transferPreviewAmountCents ?? 0)} in chips; their net is unchanged.
                    </p>
                  </div>
                ) : (
                  <TransferPreview
                    amountCents={transferPreviewAmountCents ?? 0}
                    fromCurrentNetCents={transferFromCurrentNet}
                    fromName={playerName(transferDraft.fromPlayerId)}
                    toCurrentNetCents={transferToCurrentNet}
                    toName={playerName(transferDraft.toPlayerId)}
                  />
                )
              ) : null}
            </div>

            <div className="form-grid transfer-detail-grid">
              <label>
                <span>Amount</span>
                <input
                  inputMode="decimal"
                  value={transferDraft.amountInput}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      amountInput: event.currentTarget.value
                    })
                  }
                />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={transferDraft.note}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      note: event.currentTarget.value
                    })
                  }
                />
              </label>
            </div>

            <div className="quick-amounts">
              <TransferQuickAmountButtons
                defaultBuyInCents={defaultBuyInCents}
                onSelect={(amountCents) =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(amountCents)
                  })
                }
              />
            </div>

            {transferError ? <div className="notice notice-warning">{transferError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setTransferDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmTransfer}>
                {transferDraft.mode === "cover_buy_in"
                  ? "Record covered buy-in"
                  : "Record chip transfer"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {renameDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal table-action-modal" role="dialog" aria-modal="true" aria-label="Rename player">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Seat action</p>
                <h2>Rename {playerName(renameDraft.playerId)}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setRenameDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>
            <label>
              <span>Player name</span>
              <input
                value={renameDraft.nameInput}
                onChange={(event) =>
                  setRenameDraft({
                    ...renameDraft,
                    nameInput: event.currentTarget.value
                  })
                }
              />
            </label>
            {renameError ? <div className="notice notice-warning">{renameError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setRenameDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmRename}>
                Save name
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
