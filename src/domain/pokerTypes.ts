export type PlayerId = string;
export type TransactionId = string;

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
  createdAt: string;
};

export type TransactionType =
  | "bank_buy_in"
  | "bank_cash_out"
  | "player_transfer"
  | "manual_bank_adjustment";

export type BankDirection = "incoming" | "outgoing";
export type TransactionCategory = "poker" | "food";

export type Transaction = {
  id: TransactionId;
  type: TransactionType;
  createdAt: string;
  amountCents: number;
  fromPlayerId?: PlayerId;
  toPlayerId?: PlayerId;
  bankDirection?: BankDirection;
  category?: TransactionCategory;
  note?: string;
  flippedFromTransactionId?: TransactionId;
  voidedAt?: string;
  voidReason?: string;
};

export type PlayerLedgerSummary = {
  playerId: PlayerId;
  bankBuyInsCents: number;
  bankCashOutsCents: number;
  sentToPlayersCents: number;
  receivedFromPlayersCents: number;
  netCents: number;
};

export type BankSummary = {
  incomingCents: number;
  outgoingCents: number;
  balanceCents: number;
};

export type PersistedGameState = {
  schemaVersion: 2;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
};

export type LegacyGameSettings = Omit<
  GameSettings,
  "tableShape" | "tableSeatPlacements"
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

export type AnyPersistedGameState = PersistedGameState | LegacyPersistedGameState;

export type GameState = PersistedGameState;

export type SettlementPayment = {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
};
