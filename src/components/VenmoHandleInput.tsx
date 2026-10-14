import type { KeyboardEvent } from "react";
import { VENMO_HANDLE_MAX_LENGTH } from "../domain/venmo";

type VenmoHandleInputProps = {
  value: string;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/** An optional Venmo username field; settlement offers pay links to players who have one. */
export function VenmoHandleInput({ value, error, autoFocus, disabled, onChange, onKeyDown }: VenmoHandleInputProps) {
  return (
    <label className="venmo-handle-field">
      <span>Venmo username (optional)</span>
      <input
        type="text"
        value={value}
        placeholder="@username"
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        // Room for a leading @ or a pasted venmo.com link, which are trimmed on save.
        maxLength={VENMO_HANDLE_MAX_LENGTH + 40}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <span className="inline-error" role="alert">
          {error}
        </span>
      ) : (
        <span className="venmo-field-hint">Used for “Pay with Venmo” links when settling up.</span>
      )}
    </label>
  );
}
