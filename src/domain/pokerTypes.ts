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
  currencyCode: "USD";
  defaultBuyInCents: number;
  tableShape: TableShape;
  tableSeatPlacements: TableSeatPlacement[];
  chipDenominations: ChipDenomination[];
  createdAt: string;
};

export type TransactionType =
  | "bank_buy_in"
  | "bank_cash_out"
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
  debtCoveredByOthersCents: number;
  debtCoveredForOthersCents: number;
  netCents: number;
};

export type BankSummary = {
  incomingCents: number;
  outgoingCents: number;
  balanceCents: number;
};

export type PersistedGameState = {
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
