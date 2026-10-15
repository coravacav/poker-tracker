import { Presence } from "@convex-dev/presence";
import { components } from "../_generated/api";

export const presence = new Presence(components.presence);

// The presence component expires a session after 2.5x this value. Guests still
// send every 30 seconds, leaving a five-minute grace period for mobile sleep.
export const GUEST_PRESENCE_INTERVAL_MS = 2 * 60 * 1000;
