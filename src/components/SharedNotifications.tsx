import { Bell, CheckCheck, X } from "lucide-react";
import { useState } from "react";
import type { Player } from "../domain/pokerTypes";
import type { SharedActivity, SharedNotification } from "../session/types";

type SharedNotificationsProps = {
  activity: SharedActivity;
  players: Player[];
  onMarkRead: () => void;
};

function notificationTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function affectedPlayerNames(notification: SharedNotification, players: Player[]): string[] {
  return notification.playerIds
    .map((playerId) => players.find((player) => player.id === playerId)?.name)
    .filter((name): name is string => !!name);
}

export function SharedNotifications({
  activity,
  players,
  onMarkRead
}: SharedNotificationsProps) {
  const [open, setOpen] = useState(false);
  const unreadCount = activity.unreadNotificationCount;

  return (
    <div className="shared-notifications">
      <button
        className={`notification-button ${open ? "is-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `${unreadCount} unread shared notifications` : "Shared notifications"}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={16} />
        <span>Activity</span>
        {unreadCount > 0 ? <strong className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</strong> : null}
      </button>

      {open ? (
        <section className="notification-popover" role="dialog" aria-label="Shared notifications">
          <div className="notification-heading">
            <div>
              <p className="eyebrow">Shared room</p>
              <h2>Activity</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close shared notifications"
              title="Close"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className="notification-toolbar">
            <span className="muted">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </span>
            <button
              className="text-button"
              type="button"
              disabled={unreadCount === 0}
              onClick={onMarkRead}
            >
              <CheckCheck size={15} /> Mark read
            </button>
          </div>

          <div className="notification-list">
            {activity.notifications.length === 0 ? (
              <p className="muted notification-empty">Transfers, cash-outs, and corrections will appear here.</p>
            ) : (
              activity.notifications.map((notification) => {
                const names = affectedPlayerNames(notification, players);
                return (
                  <article
                    className={`notification-item ${notification.read ? "is-read" : "is-unread"}`}
                    key={notification.id}
                  >
                    <div className="notification-item-heading">
                      <strong>{notification.title}</strong>
                      <time dateTime={new Date(notification.createdAt).toISOString()}>
                        {notificationTime(notification.createdAt)}
                      </time>
                    </div>
                    <p>{notification.summary}</p>
                    <div className="notification-item-meta">
                      {names.length > 0 ? <span>{names.join(" · ")}</span> : null}
                      {!notification.read ? <span className="notification-new">New</span> : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
