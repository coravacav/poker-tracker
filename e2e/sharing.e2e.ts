import { devices, expect, test } from "@playwright/test";
import { buyIn, chipPool, openMode, sharingConfigured, startGame } from "./helpers";

// One host on a desktop and one guest on a phone, against the Convex dev deployment.
test.skip(!sharingConfigured(), "needs VITE_CONVEX_URL in .env.local (run `bunx convex dev`)");

test("a guest follows a shared game live, through a dropped connection, and keeps it afterwards", async ({ browser, page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the test opens its own phone guest");
  test.setTimeout(120_000);

  await startGame(host, ["Alex", "Blair"]);
  await host.getByRole("button", { name: "Share game" }).click();
  const invite = await host.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(invite).toMatch(/#\/join\//);
  await host.getByRole("dialog", { name: "Share game" }).getByRole("button", { name: "Close" }).click();

  const guestContext = await browser.newContext({ ...devices["Pixel 7"] });
  // Keeps the page's sockets reachable, so the test can cut the realtime connection itself.
  await guestContext.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = sockets;
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        sockets.push(this);
      }
    };
  });
  const guest = await guestContext.newPage();
  await guest.goto(invite);
  await guest.getByRole("textbox", { name: "Display name" }).fill("Casey");
  await guest.getByRole("button", { name: "Join game" }).click();
  await expect(guest.getByText("Viewing as Casey")).toBeVisible();

  // Host edits reach the guest.
  await openMode(host, "Play");
  await buyIn(host, "Alex");
  await openMode(guest, "Play");
  await expect(chipPool(guest).getByRole("definition").first()).toHaveText("$20.00");
  await expect(guest.getByRole("region", { name: "Chip key" })).toContainText("White$1");

  // The guest's connection drops while the host keeps going; it reconnects, catches up, and stays responsive.
  await guestContext.setOffline(true);
  await guest.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.forEach((socket) => socket.close()));
  await expect(guest.getByText("Reconnecting")).toBeVisible({ timeout: 30_000 });
  await buyIn(host, "Blair");
  await expect(chipPool(host).getByRole("definition").first()).toHaveText("$40.00");
  await guestContext.setOffline(false);
  await expect(guest.getByText("Viewing as Casey")).toBeVisible({ timeout: 30_000 });
  await expect(chipPool(guest).getByRole("definition").first()).toHaveText("$40.00", { timeout: 30_000 });
  // Guests have Play and Settle only.
  await openMode(guest, "Settle");
  await openMode(guest, "Play");

  // A guest's request waits, counted on the host's sharing button, until the host approves it.
  await guest.getByRole("button", { name: "Request transaction" }).click();
  await guest.getByRole("button", { name: "Send request" }).click();
  await expect(guest.getByText("Request sent to the host for approval.")).toBeVisible();
  await host.getByRole("button", { name: "Sharing live, 1 guest request waiting" }).click();
  await host.getByRole("dialog", { name: "Share game" }).getByRole("button", { name: "Approve" }).click();
  await host.getByRole("dialog", { name: "Share game" }).getByRole("button", { name: "Close" }).click();
  await expect(host.getByRole("button", { name: "Sharing live" })).toBeVisible();
  await expect(chipPool(guest).getByRole("definition").first()).toHaveText("$60.00", { timeout: 30_000 });

  // The host ends the room; the guest keeps the final game in their own Player History.
  await host.getByRole("button", { name: "Sharing live" }).click();
  host.once("dialog", (dialog) => void dialog.accept());
  await host.getByRole("button", { name: "Stop sharing" }).click();
  await expect(guest.getByText("Session ended")).toBeVisible({ timeout: 30_000 });
  await guest.getByRole("button", { name: "Save to Player History" }).click();
  await expect(guest.getByRole("button", { name: "Update in Player History" })).toBeVisible();
  // With no game of its own, the guest's device goes Home on leaving; Player History is
  // under Setup, which a new game opens on.
  await guest.getByRole("button", { name: "Leave" }).click();
  await expect(guest.getByRole("heading", { name: "Ready for poker night?" })).toBeVisible();
  await guest.getByRole("button", { name: "Start new game" }).click();
  await openMode(guest, "Setup");
  const history = guest.getByRole("region", { name: "Session history" });
  await expect(history.getByText("Alex", { exact: true })).toBeVisible();
  await expect(history.getByText("Blair", { exact: true })).toBeVisible();

  await guestContext.close();
});

test("a watcher follows the table live from the watch link, with no way to send requests", async ({ browser, page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the test opens its own phone watcher");
  test.setTimeout(90_000);

  await startGame(host, ["Alex", "Blair"]);
  await host.getByRole("button", { name: "Share game" }).click();
  const share = host.getByRole("dialog", { name: "Share game" });
  await share.getByRole("button", { name: "Watchers" }).click();
  await share.getByRole("button", { name: "Turn on watch link" }).click();
  const watchLink = await share.getByRole("textbox", { name: "Watch link" }).inputValue();
  expect(watchLink).toMatch(/#\/watch\//);
  const invite = await share.getByRole("button", { name: "Players" }).click().then(() =>
    share.getByRole("textbox", { name: "Invite link" }).inputValue()
  );
  // The two links carry different secrets.
  expect(watchLink.split("/").pop()).not.toBe(invite.split("/").pop());

  const watcherContext = await browser.newContext({ ...devices["Pixel 7"] });
  const watcher = await watcherContext.newPage();
  await watcher.goto(watchLink);
  await expect(watcher.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(watcher.getByText(/^Spectating/)).toBeVisible();
  await expect(watcher.getByRole("textbox", { name: "Display name" })).toHaveCount(0);

  // The host sees the watcher arrive.
  await share.getByRole("button", { name: "Watchers" }).click();
  await expect(share.getByText("1 watching")).toBeVisible({ timeout: 30_000 });
  await share.getByRole("button", { name: "Close" }).click();

  // A host buy-in reaches the watcher's table and feed.
  await openMode(host, "Play");
  await buyIn(host, "Alex");
  await expect(chipPool(watcher).getByRole("definition").first()).toHaveText("$20.00", { timeout: 30_000 });
  await expect(watcher.getByRole("region", { name: "Live feed" })).toContainText("Alex bought in for $20.00");
  await expect(watcher.getByRole("region", { name: "Chip key" })).toContainText("White$1");

  // Read-only: no requests, no Activity bell, no Setup.
  await expect(watcher.getByRole("button", { name: "Request transaction" })).toHaveCount(0);
  await expect(watcher.getByRole("button", { name: /Shared notifications/ })).toHaveCount(0);
  await expect(watcher.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
  await expect(watcher.getByTitle("Record default buy-in")).toHaveCount(0);

  // Turning the link off closes the watcher's view.
  await host.getByRole("button", { name: "Sharing live" }).click();
  await share.getByRole("button", { name: "Watchers" }).click();
  await share.getByRole("button", { name: "Turn off" }).click();
  await expect(share.getByRole("button", { name: "Turn on watch link" })).toBeVisible();
  await expect(watcher.getByRole("heading", { name: "Watch link unavailable" })).toBeVisible({ timeout: 30_000 });
  await watcher.getByRole("button", { name: "Back to Home" }).click();
  await expect(watcher.getByRole("heading", { name: "Ready for poker night?" })).toBeVisible();

  await watcherContext.close();
});
