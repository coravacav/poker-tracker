import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties, Dispatch } from "react";
import { centsToInputValue, formatCurrency, parseMoneyToCents } from "../domain/money";
import type {
  Player,
  PlayerId,
  PlayerLedgerSummary,
  TableSeatLayout,
  TransactionCategory,
  Transaction
} from "../domain/pokerTypes";
import { getSeatPositionPercent } from "../domain/tableLayout";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { PlayerSeat } from "./PlayerSeat";
import { TransferPreview } from "./TransferPreview";

type PokerTableProps = {
  activePlayers: Player[];
  defaultBuyInCents: number;
  dispatch: Dispatch<GameAction>;
  onAddTransaction: (transaction: Transaction) => boolean;
  readOnly: boolean;
  seatLayout: TableSeatLayout;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
};

type TransferDraft = {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountInput: string;
  category: TransactionCategory;
  note: string;
};

function positionFor(index: number, count: number, layout: TableSeatLayout): CSSProperties {
  const position = getSeatPositionPercent(index, count, layout);

  return {
    left: `${position.leftPercent}%`,
    top: `${position.topPercent}%`
  };
}

export function PokerTable({
  activePlayers,
  defaultBuyInCents,
  dispatch,
  onAddTransaction,
  readOnly,
  seatLayout,
  summaryByPlayerId
}: PokerTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  const activePlayerIds = useMemo(
    () => activePlayers.map((player) => player.id),
    [activePlayers]
  );

  function playerName(playerId: PlayerId): string {
    return activePlayers.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function openTransfer(fromPlayerId: PlayerId, toPlayerId?: PlayerId) {
    const fallbackToPlayerId =
      toPlayerId ??
      activePlayers.find((player) => player.id !== fromPlayerId)?.id ??
      fromPlayerId;

    setTransferDraft({
      fromPlayerId,
      toPlayerId: fallbackToPlayerId,
      amountInput: centsToInputValue(defaultBuyInCents),
      category: "poker",
      note: ""
    });
    setTransferError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (readOnly || !event.over) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (!overId.startsWith("player:")) {
      return;
    }

    const [, dragType, draggedPlayerId] = activeId.match(/^(seat|bucket):(.+)$/) ?? [];
    const targetPlayerId = overId.replace("player:", "");

    if (!dragType || !draggedPlayerId || draggedPlayerId === targetPlayerId) {
      return;
    }

    if (dragType === "seat") {
      const oldIndex = activePlayerIds.indexOf(draggedPlayerId);
      const newIndex = activePlayerIds.indexOf(targetPlayerId);
      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      dispatch({
        type: "reorder_players",
        orderedPlayerIds: arrayMove(activePlayerIds, oldIndex, newIndex)
      });
    }

    if (dragType === "bucket") {
      openTransfer(draggedPlayerId, targetPlayerId);
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

  function quickCashOut(player: Player) {
    const rawAmount = window.prompt(
      `Final chip value for ${player.name}`,
      centsToInputValue(summaryByPlayerId.get(player.id)?.bankCashOutsCents ?? 0)
    );
    if (rawAmount === null) {
      return;
    }

    const amountCents = parseMoneyToCents(rawAmount);
    if (amountCents === null) {
      return;
    }

    onAddTransaction({
      id: createId("transaction"),
      type: "bank_cash_out",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: player.id,
      note: "Quick chip count"
    });
  }

  function editPlayerName(player: Player) {
    const name = window.prompt("Player name", player.name);
    if (name?.trim()) {
      dispatch({ type: "rename_player", playerId: player.id, name });
    }
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

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "player_transfer",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: transferDraft.fromPlayerId,
      toPlayerId: transferDraft.toPlayerId,
      category: transferDraft.category,
      note: transferDraft.note
    });

    if (added) {
      setTransferDraft(null);
      setTransferError(null);
    }
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

  return (
    <section className="poker-table-panel">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Drag seats to rearrange</p>
          <h2>Table Layout</h2>
        </div>
        <span className="default-buy-in">
          Default buy-in {formatCurrency(defaultBuyInCents)}
        </span>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="poker-table" aria-label="Poker seating">
          <div className="felt-center">
            <span>{activePlayers.length}</span>
            <small>players</small>
          </div>
          {activePlayers.map((player, index) => (
            <PlayerSeat
              key={player.id}
              player={player}
              positionStyle={positionFor(index, activePlayers.length, seatLayout)}
              readOnly={readOnly}
              summary={summaryByPlayerId.get(player.id)}
              onBuyIn={quickBuyIn}
              onCashOut={quickCashOut}
              onEdit={editPlayerName}
              onStartTransfer={(fromPlayer) => openTransfer(fromPlayer.id)}
            />
          ))}
        </div>
      </DndContext>

      {transferDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Player transfer">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Rebuy transfer</p>
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

            <div className="form-grid two">
              <label>
                <span>From</span>
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
                <span>To</span>
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
                <TransferPreview
                  amountCents={transferPreviewAmountCents ?? 0}
                  fromCurrentNetCents={transferFromCurrentNet}
                  fromName={playerName(transferDraft.fromPlayerId)}
                  toCurrentNetCents={transferToCurrentNet}
                  toName={playerName(transferDraft.toPlayerId)}
                />
              ) : null}
            </div>

            <div className="form-grid transfer-detail-grid">
              <label>
                <span>Category</span>
                <select
                  value={transferDraft.category}
                  onChange={(event) => {
                    const nextCategory = event.currentTarget.value as TransactionCategory;
                    setTransferDraft({
                      ...transferDraft,
                      category: nextCategory
                    });
                  }}
                >
                  <option value="poker">Poker / rebuy</option>
                  <option value="food">Food</option>
                </select>
              </label>
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
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(Math.round(defaultBuyInCents / 2))
                  })
                }
              >
                Half
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(defaultBuyInCents)
                  })
                }
              >
                Buy-in
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(defaultBuyInCents * 2)
                  })
                }
              >
                Double
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    category: "food"
                  })
                }
              >
              Food
              </button>
            </div>

            {transferError ? <div className="notice notice-warning">{transferError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setTransferDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmTransfer}>
                Record transfer
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
