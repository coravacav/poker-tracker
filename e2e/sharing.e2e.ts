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

  // The host ends the room; the guest keeps the final game in their own Player History.
  await host.getByRole("button", { name: "Sharing live" }).click();
  host.once("dialog", (dialog) => void dialog.accept());
  await host.getByRole("button", { name: "Stop sharing" }).click();
  await expect(guest.getByText("Session ended")).toBeVisible({ timeout: 30_000 });
  await guest.getByRole("button", { name: "Save to Player History" }).click();
  await expect(guest.getByRole("button", { name: "Update in Player History" })).toBeVisible();
  // Player History lives in the guest's own games, under Setup.
  await guest.getByRole("button", { name: "Leave" }).click();
  await openMode(guest, "Setup");
  const history = guest.getByRole("region", { name: "Session history" });
  await expect(history.getByText("Alex", { exact: true })).toBeVisible();
  await expect(history.getByText("Blair", { exact: true })).toBeVisible();

  await guestContext.close();
});
