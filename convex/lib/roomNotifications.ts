// Per-recipient activity feed and notification read cursors.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireGuest, requireHost } from "./roomAccess";
import type { AuditEventKind } from "./roomAudit";
import { fail } from "./roomErrors";

export const HOST_RECIPIENT_KEY = "host";
const MAX_PUBLIC_SHARED_AUDIT_EVENTS = 200;

function notificationTitle(kind: AuditEventKind): string {
  if (kind === "transaction") return "Transaction recorded";
  if (kind === "cash_out") return "Cash-out updated";
  if (kind === "correction") return "Ledger correction";
  return "Shared game updated";
}

export async function activityForRecipient(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
  recipientKey: string
) {
  const events = await ctx.db
    .query("roomAuditEvents")
    .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", room._id))
    .order("desc")
    .take(MAX_PUBLIC_SHARED_AUDIT_EVENTS);
  const cursor = await ctx.db
    .query("roomNotificationCursors")
    .withIndex("by_room_id_and_recipient_key", (index) =>
      index.eq("roomId", room._id).eq("recipientKey", recipientKey)
    )
    .unique();
  const lastReadVersion = cursor?.lastReadVersion ?? 0;
  const publicEvents = events.map((event) => ({
    id: event.eventId,
    version: event.version,
    actionType: event.actionType,
    kind: event.kind,
    summary: event.summary,
    transactionIds: event.transactionIds,
    playerIds: event.playerIds,
    actorLabel: event.actorLabel,
    createdAt: event.createdAt,
    notify: event.notify
  }));
  const notifications = events
    .filter((event) => event.notify)
    .map((event) => ({
      id: `notification_${event.eventId}`,
      eventId: event.eventId,
      title: notificationTitle(event.kind),
      summary: event.summary,
      playerIds: event.playerIds,
      createdAt: event.createdAt,
      version: event.version,
      read: event.version <= lastReadVersion
    }));

  return {
    events: publicEvents,
    notifications,
    unreadNotificationCount: notifications.filter((notification) => !notification.read).length
  };
}

export async function acknowledgeHostNotificationsForRoom(
  ctx: MutationCtx,
  args: { publicId: string; hostSecret: string; throughVersion: number }
) {
  const room = await requireHost(ctx, args.publicId, args.hostSecret);
  if (!Number.isSafeInteger(args.throughVersion) || args.throughVersion < 0) {
    fail("INVALID_ARGUMENT", "Notification version is invalid.");
  }
  const throughVersion = Math.min(args.throughVersion, room.version);
  const cursor = await ctx.db
    .query("roomNotificationCursors")
    .withIndex("by_room_id_and_recipient_key", (index) =>
      index.eq("roomId", room._id).eq("recipientKey", HOST_RECIPIENT_KEY)
    )
    .unique();
  const now = Date.now();
  if (cursor) {
    await ctx.db.patch(cursor._id, {
      lastReadVersion: Math.max(cursor.lastReadVersion, throughVersion),
      updatedAt: now
    });
  } else {
    await ctx.db.insert("roomNotificationCursors", {
      roomId: room._id,
      recipientKey: HOST_RECIPIENT_KEY,
      lastReadVersion: throughVersion,
      updatedAt: now
    });
  }
  return null;
}

export async function acknowledgeGuestNotificationsForRoom(
  ctx: MutationCtx,
  args: { publicId: string; guestSecret: string; throughVersion: number }
) {
  const { room, guest } = await requireGuest(ctx, args.publicId, args.guestSecret);
  if (!Number.isSafeInteger(args.throughVersion) || args.throughVersion < 0) {
    fail("INVALID_ARGUMENT", "Notification version is invalid.");
  }
  const throughVersion = Math.min(args.throughVersion, room.version);
  const recipientKey = String(guest._id);
  const cursor = await ctx.db
    .query("roomNotificationCursors")
    .withIndex("by_room_id_and_recipient_key", (index) =>
      index.eq("roomId", room._id).eq("recipientKey", recipientKey)
    )
    .unique();
  const now = Date.now();
  if (cursor) {
    await ctx.db.patch(cursor._id, {
      lastReadVersion: Math.max(cursor.lastReadVersion, throughVersion),
      updatedAt: now
    });
  } else {
    await ctx.db.insert("roomNotificationCursors", {
      roomId: room._id,
      recipientKey,
      lastReadVersion: throughVersion,
      updatedAt: now
    });
  }
  return null;
}
