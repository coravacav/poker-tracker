import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { buyIn, chipPool, openGuestTab, openMode, scrollsSideways, sharingConfigured, startGame } from "./helpers";

// One host on a desktop and one guest on a phone, against the Convex dev deployment.
test.skip(!sharingConfigured(), "needs VITE_CONVEX_URL in .env.local (run `bunx convex dev`)");

test("a guest follows a shared game live, through a dropped connection, and keeps it afterwards", async ({ browser, page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the test opens its own phone guest");
  test.setTimeout(120_000);

  await startGame(host, ["Alex", "Blair"]);
  await host.getByRole("button", { name: "Share game" }).click();
  const invite = await host.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(invite).toMatch(/#\/join\//);
  // The host marks their own seat, so no guest can take it.
  const seats = host.getByRole("dialog", { name: "Share game" }).getByRole("region", { name: "Seats" });
  await seats.getByRole("combobox", { name: "Your seat" }).selectOption({ label: "Alex" });
  await expect(seats.getByText("You (host)")).toBeVisible();
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
  // "Who are you?": the guest picks their seat; the host's is taken.
  await expect(guest.getByRole("heading", { name: "Who are you?" })).toBeVisible();
  await expect(guest.getByRole("textbox", { name: "Display name" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /Alex.*Host/ })).toBeDisabled();
  await guest.getByRole("button", { name: /Blair/ }).click();
  await guest.getByRole("button", { name: "Join as Blair" }).click();
  await expect(guest.getByText("Playing as Blair")).toBeVisible();

  // Host edits reach the guest, whose seat gives them Table · Chips · Inbox.
  await openMode(host, "Play");
  await buyIn(host, "Alex");
  await openGuestTab(guest, "Table");
  await expect(chipPool(guest).getByRole("definition").first()).toHaveText("$20.00");
  await expect(guest.getByRole("region", { name: "Chip key" })).toContainText("White$1");

  // The guest's connection drops while the host keeps going; it reconnects, catches up, and stays responsive.
  await guestContext.setOffline(true);
  await guest.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.forEach((socket) => socket.close()));
  await expect(guest.getByText("Reconnecting")).toBeVisible({ timeout: 30_000 });
  await buyIn(host, "Blair");
  await expect(chipPool(host).getByRole("definition").first()).toHaveText("$40.00");
  await guestContext.setOffline(false);
  await expect(guest.getByText("Playing as Blair")).toBeVisible({ timeout: 30_000 });
  await expect(chipPool(guest).getByRole("definition").first()).toHaveText("$40.00", { timeout: 30_000 });
  // A seated guest has Table, Chips, and Inbox; nothing is ready to settle yet.
  await openGuestTab(guest, "Inbox");
  await expect(guest.getByText("Nothing waiting on you.")).toBeVisible();
  await expect(guest.getByRole("navigation", { name: "Poker tracker modes" }).getByRole("button", { name: "Settle" })).toHaveCount(0);

  // Anything other than chips between players is a request: it waits, counted on the host's
  // sharing button, until the host approves it.
  await openGuestTab(guest, "Chips");
  await guest.getByRole("button", { name: "Something else? Ask the host" }).click();
  await guest.getByRole("button", { name: "Send request" }).click();
  await expect(guest.getByText("Request sent to the host for approval.")).toBeVisible();
  await host.getByRole("button", { name: "Sharing live, 1 guest request waiting" }).click();
  // The host's seat list shows which phone holds Blair's seat.
  await expect(
    host.getByRole("dialog", { name: "Share game" }).getByRole("region", { name: "Seats" })
  ).toContainText("Blair’s phone · online");
  await host.getByRole("dialog", { name: "Share game" }).getByRole("button", { name: "Approve" }).click();
  await host.getByRole("dialog", { name: "Share game" }).getByRole("button", { name: "Close" }).click();
  await expect(host.getByRole("button", { name: "Sharing live" })).toBeVisible();
  await openGuestTab(guest, "Table");
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

/** A phone at 390px wide (the narrowest common one) that has joined on `seatName`. */
async function joinOnPhone(browser: Browser, invite: string, seatName: string): Promise<Page> {
  const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(invite);
  await page.getByRole("button", { name: new RegExp(seatName) }).click();
  await page.getByRole("button", { name: `Join as ${seatName}` }).click();
  await expect(page.getByText(`Playing as ${seatName}`)).toBeVisible();
  return page;
}

test("players record chips between themselves when the other player confirms", async ({ browser, page: host }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the test opens its own phone guests");
  test.setTimeout(150_000);

  await startGame(host, ["Alex", "Blair", "Casey"]);
  await host.getByRole("button", { name: "Share game" }).click();
  const share = host.getByRole("dialog", { name: "Share game" });
  const invite = await share.getByRole("textbox", { name: "Invite link" }).inputValue();
  await expect(share.getByRole("checkbox", { name: /Players confirm each other/ })).toBeChecked();
  await share.getByRole("region", { name: "Seats" }).getByRole("combobox", { name: "Your seat" }).selectOption({ label: "Alex" });
  await expect(share.getByText("You (host)")).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  const blair = await joinOnPhone(browser, invite, "Blair");
  const casey = await joinOnPhone(browser, invite, "Casey");
  for (const phone of [blair, casey]) {
    await expect(phone.getByRole("region", { name: "You" })).toBeVisible();
    expect(await scrollsSideways(phone)).toBe(false);
  }

  // Blair gives Casey $20 in chips; nothing is recorded until Casey confirms.
  await openGuestTab(blair, "Chips");
  expect(await scrollsSideways(blair)).toBe(false);
  await blair.getByRole("group", { name: "Player" }).getByRole("button", { name: /Casey/ }).click();
  await blair.getByRole("button", { name: "$20" }).click();
  await expect(blair.getByText("You give Casey $20 in chips. You'll get that back at settle-up.")).toBeVisible();
  await blair.getByRole("button", { name: "Send to Casey to confirm" }).click();
  await expect(blair.getByText("Sent. Waiting on Casey to confirm.")).toBeVisible();
  await expect(blair.getByText("You gave Casey $20 in chips")).toBeVisible();

  await expect(casey.getByRole("button", { name: "Inbox, 1 waiting" })).toBeVisible({ timeout: 30_000 });
  await expect(casey.getByRole("button", { name: /1 waiting on you/ })).toBeVisible();
  await openGuestTab(casey, "Inbox");
  expect(await scrollsSideways(casey)).toBe(false);
  const card = casey.getByRole("article", { name: "Blair gave you $20 in chips" });
  await expect(card).toContainText("You'll pay for them at settle-up.");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(casey.getByText("Nothing waiting on you.")).toBeVisible({ timeout: 30_000 });
  await expect(casey.getByText(/you confirmed ·/)).toBeVisible();

  // The host and Blair see the entry, with who confirmed it.
  await openGuestTab(blair, "Table");
  await expect(blair.getByRole("region", { name: "Recent activity" })).toContainText("Blair · confirmed by Casey", { timeout: 30_000 });
  await expect(blair.getByRole("region", { name: "You" })).toContainText("Gave $20 to Casey");
  await openMode(host, "Play");
  await host.getByRole("button", { name: "Transaction Audit" }).click();
  const audit = host.getByRole("dialog");
  await expect(audit.getByRole("region", { name: "Shared audit history" })).toContainText("Blair · confirmed by Casey", { timeout: 30_000 });
  await expect(audit).toContainText("Confirmed by Casey");
  await host.keyboard.press("Escape");

  // Casey says they bought $10 from Blair; Blair says it's not right.
  await openGuestTab(casey, "Chips");
  await casey.getByRole("button", { name: "Buy from" }).click();
  await casey.getByRole("group", { name: "Player" }).getByRole("button", { name: /Blair/ }).click();
  await casey.getByRole("button", { name: "$10" }).click();
  await expect(casey.getByText("You get $10 in chips from Blair. You'll pay for them at settle-up.")).toBeVisible();
  await casey.getByRole("button", { name: "Send to Blair to confirm" }).click();
  await expect(casey.getByText("Sent. Waiting on Blair to confirm.")).toBeVisible();

  await openGuestTab(blair, "Inbox");
  const buy = blair.getByRole("article", { name: "Casey bought $10 in chips from you" });
  await expect(buy).toBeVisible({ timeout: 30_000 });
  await buy.getByRole("button", { name: "Not right" }).click();
  await expect(blair.getByText("Nothing waiting on you.")).toBeVisible({ timeout: 30_000 });

  // It bounces back to Casey, and lands in the host's Needs you.
  await expect(casey.getByText("Blair said not right")).toBeVisible({ timeout: 30_000 });
  await expect(casey.getByRole("button", { name: "Edit & resend" })).toBeVisible();
  expect(await scrollsSideways(casey)).toBe(false);
  await host.getByRole("button", { name: "Sharing live, 1 entry needs you" }).click({ timeout: 30_000 });
  const needs = share.getByRole("region", { name: /Needs you/ });
  await expect(needs).toContainText("Blair said not right: Casey bought $10 in chips from Blair");
  await expect(needs.getByRole("button", { name: "Record anyway" })).toBeVisible();

  await blair.context().close();
  await casey.context().close();
});
