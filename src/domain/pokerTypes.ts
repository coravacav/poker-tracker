import type { CurrencyCode } from "./money";

export type PlayerId = string;
export type TransactionId = string;

export type ChipDenomination = {
  id: string;
  label: string;
  colorHex: string;
  valueCents: number;
};

export type ChipCountLine = {
  denominationId: string;
  label: string;
  colorHex: string;
  valueCents: number;
  count: number;
};

export type CashOutDraft = {
  playerId: PlayerId;
  lines: ChipCountLine[];
  correctingTransactionId?: TransactionId;
};

export type SeatPosition = {
  index: number;
};

export type Player = {
  id: PlayerId;
  name: string;
  seatIndex: number;
  isActive: boolean;
  /**
   * Optional link to a person in this device's people directory (see domain/people.ts).
   * Additive and optional, so it needs no schema bump: older builds ignore it.
   */
  personId?: string;
  /**
   * People this player was explicitly marked as not being (set when a link is
   * corrected in Player History). Without a usable personId, the exact
   * name/alias match never links the player to these people (or anyone merged
   * with them). Optional and additive like personId; unusable ids are dropped on load.
   */
  notPersonIds?: string[];
  /**
   * Venmo username (without @) that settlement pay links send money to.
   * Optional and additive like personId; values this build cannot use are dropped on load.
   */
  venmoHandle?: string;
};

export type TableSeatLayout = "top_bottom" | "left_right" | "rectangle" | "round";
export type TableShape = "rectangle" | "oval" | "round";
export type SeatRail = "top" | "right" | "bottom" | "left";

export type TableSeatPlacement = {
  seatIndex: number;
  rail: SeatRail;
  order: number;
};

export type GameSettings = {
  gameName: string;
  /**
   * Label for every amount in the game. All supported currencies use two minor
   * digits, so amounts stay integer cents whatever the code. Anything but USD
   * makes the save schema 8 (see CURRENT_SCHEMA_VERSION in state/persistence.ts).
   */
  currencyCode: CurrencyCode;
  defaultBuyInCents: number;
  tableShape: TableShape;
  tableSeatPlacements: TableSeatPlacement[];
  chipDenominations: ChipDenomination[];
  createdAt: string;
};

export type TransactionType =
  | "bank_buy_in"
  | "bank_cash_out"
  | "player_gave"
  | "player_owes"
  /** @deprecated Legacy tapes are normalized when they are loaded. */
  | "player_transfer"
  | "debt_coverage"
  | "manual_bank_adjustment";

export type BankDirection = "incoming" | "outgoing";
export type TransactionCategory = "poker" | "food";
export type CashOutKind = "partial" | "final";

export type Transaction = {
  id: TransactionId;
  type: TransactionType;
  createdAt: string;
  amountCents: number;
  fromPlayerId?: PlayerId;
  toPlayerId?: PlayerId;
  coveredByPlayerId?: PlayerId;
  coveredPlayerId?: PlayerId;
  bankDirection?: BankDirection;
  category?: TransactionCategory;
  cashOutKind?: CashOutKind;
  note?: string;
  flippedFromTransactionId?: TransactionId;
  chipCountBreakdown?: ChipCountLine[];
  correctsTransactionId?: TransactionId;
  voidedAt?: string;
  voidReason?: string;
};

export type PlayerLedgerSummary = {
  playerId: PlayerId;
  bankBuyInsCents: number;
  bankCashOutsCents: number;
  sentToPlayersCents: number;
  receivedFromPlayersCents: number;
  owedToPlayersCents: number;
  owedByPlayersCents: number;
  debtCoveredByOthersCents: number;
  debtCoveredForOthersCents: number;
  netCents: number;
};

export type BankSummary = {
  incomingCents: number;
  outgoingCents: number;
  balanceCents: number;
};

/**
 * Saves carry the lowest schema that describes them: 7 for US dollar games
 * (readable by every build since v7) and 8 for any other currency, so builds
 * from before per-game currencies report "saved by a newer version" instead
 * of quietly showing euros as dollars. See schemaVersionForCurrency.
 */
export type GameSchemaVersion = 7 | 8;

export type PersistedGameState = {
  schemaVersion: GameSchemaVersion;
  localGameId: string;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
  cashOutDrafts: CashOutDraft[];
  /**
   * Settlement payments the host fixed in place (see domain/settlement.ts).
   * Additive and optional, so it needs no schema bump: older builds ignore it.
   * Absent rather than empty when there are none.
   */
  settlementPins?: SettlementPin[];
};

export type LegacyPersistedGameStateV6 = {
  schemaVersion: 6;
  localGameId: string;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
  cashOutDrafts: CashOutDraft[];
};

export type LegacyPersistedGameStateV5 = {
  schemaVersion: 5;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
  cashOutDrafts: CashOutDraft[];
};

export type LegacyPersistedGameStateV4 = {
  schemaVersion: 4;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
  cashOutDrafts: CashOutDraft[];
};

export type LegacyGameSettings = Omit<
  GameSettings,
  "tableShape" | "tableSeatPlacements" | "chipDenominations"
> & {
  tableSeatLayout?: TableSeatLayout;
  tableIncludeCornerSeats?: boolean;
};

export type LegacyPersistedGameState = {
  schemaVersion: 1;
  settings: LegacyGameSettings;
  players: Player[];
  transactions: Transaction[];
};

export type LegacyPersistedGameStateV2 = {
  schemaVersion: 2;
  settings: Omit<GameSettings, "chipDenominations">;
  players: Player[];
  transactions: Transaction[];
};

export type LegacyPersistedGameStateV3 = {
  schemaVersion: 3;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
  cashOutDrafts: CashOutDraft[];
};

export type AnyPersistedGameState =
  | PersistedGameState
  | LegacyPersistedGameStateV6
  | LegacyPersistedGameStateV5
  | LegacyPersistedGameStateV4
  | LegacyPersistedGameStateV3
  | LegacyPersistedGameStateV2
  | LegacyPersistedGameState;

export type GameState = PersistedGameState;

export type SettlementPayment = {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
};

/**
 * "locked": the players agreed on this payment; "paid": it already happened.
 * Either way it stays fixed and the remaining payments are computed around it.
 */
export type SettlementPinStatus = "locked" | "paid";

export type SettlementPin = SettlementPayment & {
  id: string;
  status: SettlementPinStatus;
};
