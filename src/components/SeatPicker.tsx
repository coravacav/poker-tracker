import { Check, Smartphone } from "lucide-react";
import type { SeatOption } from "../session/types";

/** Seats a phone can take right now: not the host's, and not held by another phone. */
export function openSeats(seats: SeatOption[] | undefined): SeatOption[] {
  return (seats ?? []).filter((seat) => !seat.claimed && !seat.isHost);
}

/**
 * "Who are you?": one row per seat. Open seats can be selected; the host's
 * seat and seats another phone holds are shown but disabled.
 */
export function SeatPicker({
  seats,
  selectedPlayerId,
  onSelect
}: {
  seats: SeatOption[];
  selectedPlayerId: string | null;
  onSelect: (playerId: string) => void;
}) {
  return (
    <div className="seat-picker" role="group" aria-label="Seats">
      {seats.map((seat) => {
        const unavailable = seat.isHost || seat.claimed;
        const selected = !unavailable && seat.playerId === selectedPlayerId;
        return (
          <button
            key={seat.playerId}
            className={`seat-option${seat.isHost ? " is-host" : seat.claimed ? " is-claimed" : ""}${selected ? " is-selected" : ""}`}
            type="button"
            disabled={unavailable}
            aria-pressed={unavailable ? undefined : selected}
            onClick={() => onSelect(seat.playerId)}
          >
            <span className="seat-option-avatar" aria-hidden="true">
              {seat.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="seat-option-name">{seat.name}</span>
            {seat.isHost ? (
              <span className="seat-option-badge">Host</span>
            ) : seat.claimed ? (
              <span className="seat-option-status">
                <Smartphone size={14} aria-hidden="true" /> Joined on another phone
              </span>
            ) : (
              <span className="seat-option-check" aria-hidden="true">
                {selected ? <Check size={16} strokeWidth={3} /> : null}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
