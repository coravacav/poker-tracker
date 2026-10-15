import { ConvexError } from "convex/values";
import { CREATION_LIMITED_CODE } from "../../src/session/creationLimits";

export type RoomErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CAPABILITY"
  | "ROOM_NOT_FOUND"
  | "ROOM_NOT_ACTIVE"
  | "ROOM_ENDED"
  | "VERSION_CONFLICT"
  | "DUPLICATE_CONTROLLER"
  | "ROOM_LIMIT_REACHED"
  | typeof CREATION_LIMITED_CODE;

export function fail(code: RoomErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
