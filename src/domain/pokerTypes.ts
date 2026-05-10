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

export type TableSeatLayout = "top_bottom" | "left_right";

export type GameSettings = {
  gameName: string;
  currencyCode: "USD";
  defaultBuyInCents: number;
  tableSeatLayout: TableSeatLayout;
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
  schemaVersion: 1;
  settings: GameSettings;
  players: Player[];
  transactions: Transaction[];
};

export type GameState = PersistedGameState;

export type SettlementPayment = {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
};
