/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as friendProfiles from "../friendProfiles.js";
import type * as lib_capabilities from "../lib/capabilities.js";
import type * as lib_creationLimits from "../lib/creationLimits.js";
import type * as lib_friendDiscovery from "../lib/friendDiscovery.js";
import type * as lib_roomAccess from "../lib/roomAccess.js";
import type * as lib_roomActions from "../lib/roomActions.js";
import type * as lib_roomAudit from "../lib/roomAudit.js";
import type * as lib_roomErrors from "../lib/roomErrors.js";
import type * as lib_roomGuests from "../lib/roomGuests.js";
import type * as lib_roomHosting from "../lib/roomHosting.js";
import type * as lib_roomLifecycle from "../lib/roomLifecycle.js";
import type * as lib_roomNotifications from "../lib/roomNotifications.js";
import type * as lib_roomPresence from "../lib/roomPresence.js";
import type * as lib_roomValidators from "../lib/roomValidators.js";
import type * as lib_roomViews from "../lib/roomViews.js";
import type * as rooms from "../rooms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  friendProfiles: typeof friendProfiles;
  "lib/capabilities": typeof lib_capabilities;
  "lib/creationLimits": typeof lib_creationLimits;
  "lib/friendDiscovery": typeof lib_friendDiscovery;
  "lib/roomAccess": typeof lib_roomAccess;
  "lib/roomActions": typeof lib_roomActions;
  "lib/roomAudit": typeof lib_roomAudit;
  "lib/roomErrors": typeof lib_roomErrors;
  "lib/roomGuests": typeof lib_roomGuests;
  "lib/roomHosting": typeof lib_roomHosting;
  "lib/roomLifecycle": typeof lib_roomLifecycle;
  "lib/roomNotifications": typeof lib_roomNotifications;
  "lib/roomPresence": typeof lib_roomPresence;
  "lib/roomValidators": typeof lib_roomValidators;
  "lib/roomViews": typeof lib_roomViews;
  rooms: typeof rooms;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
