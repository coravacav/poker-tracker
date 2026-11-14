import { Armchair, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { SeatOption } from "../../session/types";
import { openSeats, SeatPicker } from "../SeatPicker";
import { useDialogFocus } from "../useDialogFocus";

/** What a guest's Play screen needs to know and do about their own seat. */
export type GuestSeatControls = {
  seatPlayerId: string | null;
  seats: SeatOption[];
  /** Resolves to whether the seat was taken. */
  onClaimSeat: (playerId: string) => Promise<boolean>;
};

function SeatDialog({
  seats,
  onClaimSeat,
  onClose
}: Pick<GuestSeatControls, "seats" | "onClaimSeat"> & { onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const selectedSeat = openSeats(seats).find((seat) => seat.playerId === selectedPlayerId) ?? null;
  return (
    <div className="drawer-backdrop sharing-backdrop" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="share-dialog seat-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Pick your seat"
      >
        <div className="drawer-heading">
          <div>
            <p className="eyebrow">Who are you?</p>
            <h2>Pick your seat</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={17} />
          </button>
        </div>
        <SeatPicker seats={seats} selectedPlayerId={selectedSeat?.playerId ?? null} onSelect={setSelectedPlayerId} />
        <button
          className="primary-button"
          type="button"
          disabled={!selectedSeat || claiming}
          onClick={async () => {
            if (!selectedSeat) return;
            setClaiming(true);
            const claimed = await onClaimSeat(selectedSeat.playerId);
            setClaiming(false);
            if (claimed) onClose();
          }}
        >
          {claiming ? "Saving…" : selectedSeat ? `I'm ${selectedSeat.name}` : "Pick your seat"}
        </button>
      </section>
    </div>
  );
}

/** Shown on Play to a guest who joined without a seat, while a seat is open. */
export function GuestSeatPrompt({ seatPlayerId, seats, onClaimSeat }: GuestSeatControls) {
  const [open, setOpen] = useState(false);
  if (seatPlayerId !== null || openSeats(seats).length === 0) return null;
  return (
    <>
      <div className="notice guest-seat-prompt">
        <Armchair size={18} aria-hidden="true" />
        <span>You haven’t picked a seat yet.</span>
        <button className="text-button" type="button" onClick={() => setOpen(true)}>
          Pick your seat
        </button>
      </div>
      {open
        ? createPortal(
            <SeatDialog seats={seats} onClaimSeat={onClaimSeat} onClose={() => setOpen(false)} />,
            document.body
          )
        : null}
    </>
  );
}
