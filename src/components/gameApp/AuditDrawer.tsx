import { X } from "lucide-react";
import type { Dispatch } from "react";
import type { GameState } from "../../domain/pokerTypes";
import type { SharedActivity } from "../../session/types";
import type { GameAction } from "../../state/gameReducer";
import { TransactionTable } from "../TransactionTable";
import { useDialogFocus } from "../useDialogFocus";

type AuditDrawerProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  guest: boolean;
  readOnly: boolean;
  sharedActivity?: SharedActivity;
  setAuditDrawerOpen: (open: boolean) => void;
};

export function AuditDrawer({
  state,
  dispatch,
  guest,
  readOnly,
  sharedActivity,
  setAuditDrawerOpen
}: AuditDrawerProps) {
  const dialogRef = useDialogFocus<HTMLElement>(true, () => setAuditDrawerOpen(false));
  return (
    <div className="drawer-backdrop" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="drawer-panel drawer-panel-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Transaction audit"
      >
        <div className="drawer-heading">
          <h2>Transaction Audit</h2>
          <button
            className="icon-button"
            type="button"
            onClick={() => setAuditDrawerOpen(false)}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>
        <TransactionTable
          dispatch={dispatch}
          hideActions={guest}
          players={state.players}
          readOnly={readOnly}
          sharedEvents={sharedActivity?.events}
          transactions={state.transactions}
          variant="compact"
        />
      </section>
    </div>
  );
}
