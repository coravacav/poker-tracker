import type { Dispatch } from "react";
import type { GameState, Player } from "../../domain/pokerTypes";
import type { RoomHistoryProjection } from "../../session/types";
import type { GameAction } from "../../state/gameReducer";
import { ChipDenominationPanel } from "../ChipDenominationPanel";
import { PlayerDrawer } from "../PlayerDrawer";
import { SessionHistoryPanel } from "../SessionHistoryPanel";
import { TableSetupPanel } from "../TableSetupPanel";

type SetupModeProps = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  readOnly: boolean;
  setReadOnly: (readOnly: boolean) => void;
  activePlayers: Player[];
  roomHistory: RoomHistoryProjection[];
};

/** Setup mode: table settings, players, chip denominations, and Player History. */
export function SetupMode({
  state,
  dispatch,
  readOnly,
  setReadOnly,
  activePlayers,
  roomHistory
}: SetupModeProps) {
  return (
    <div className="setup-mode">
      <TableSetupPanel
        dispatch={dispatch}
        readOnly={readOnly}
        setReadOnly={setReadOnly}
        state={state}
      />
      <PlayerDrawer
        dispatch={dispatch}
        fastEntryDisabled={
          state.transactions.length > 0 || state.cashOutDrafts.length > 0
        }
        players={activePlayers}
        readOnly={readOnly}
        transactions={state.transactions}
      />
      <ChipDenominationPanel
        denominations={state.settings.chipDenominations}
        dispatch={dispatch}
        readOnly={readOnly}
      />
      <SessionHistoryPanel sharedRooms={roomHistory} />
    </div>
  );
}
