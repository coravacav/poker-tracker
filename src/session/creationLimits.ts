// Creation-limit error contract shared by the browser and the Convex backend.
// Keep this module free of browser or Convex dependencies.

/** Error code for server-side creation limits (rate limits and capacity caps). */
export const CREATION_LIMITED_CODE = "RATE_LIMITED";
export const ROOM_CREATION_LIMITED_MESSAGE =
  "Too many new shared rooms right now. Try again in a few minutes.";
export const PROFILE_CREATION_LIMITED_MESSAGE =
  "Too many new friend profiles right now. Try again in a few minutes.";
