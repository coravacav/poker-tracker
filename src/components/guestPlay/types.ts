import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AgreementKind,
  AgreementProposal,
  AgreementResult,
  GuestAgreements,
  RoomAgreement,
  SeatOption
} from "../../session/types";

/**
 * What a seated guest's Table · Chips · Inbox needs, in a room where players
 * confirm each other's chips. Present only for a guest holding a seat there.
 */
export type PeerGuestControls = {
  seatPlayerId: string;
  agreements: GuestAgreements;
  /** Every seat, to tell which ones no phone holds (the host confirms for those). */
  seats: SeatOption[];
  ended: boolean;
  onPropose: (proposal: AgreementProposal & { clientRequestId: string }) => Promise<string | null>;
  onAnswer: (agreementId: Id<"roomAgreements">, answer: "confirm" | "not_right") => Promise<AgreementResult | null>;
  onCancel: (agreementId: Id<"roomAgreements">) => Promise<AgreementResult | null>;
  onDismiss: (agreementId: Id<"roomAgreements">) => Promise<AgreementResult | null>;
};

/** A Chips entry to start from: Edit & resend of a bounced one. */
export type ChipsDraft = {
  kind: AgreementKind;
  counterpartyPlayerId?: string;
  witnessPlayerId?: string;
  amountCents?: number;
  /** The bounced entry this replaces, cleared once the new one is sent. */
  resendOf?: RoomAgreement["id"];
};
