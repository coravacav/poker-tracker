import { expect, test } from "@playwright/test";
import { buyIn, cashOut, chipPool, openMode, startGame } from "./helpers";

test("plays a local game from setup to a settled payment", async ({ page }) => {
  await startGame(page, ["Alex", "Blair"]);
  await openMode(page, "Play");
  await buyIn(page, "Alex");
  await buyIn(page, "Blair");
  await expect(chipPool(page).getByRole("definition").first()).toHaveText("$40.00");

  await openMode(page, "Cash Out");
  await cashOut(page, "Alex", 32);
  await cashOut(page, "Blair", 8);

  await openMode(page, "Settle");
  const paid = page.getByRole("checkbox", { name: "Mark Blair to Alex $12.00 as paid" });
  await expect(paid).not.toBeChecked();
  await paid.click();
  // Once paid, the checkbox offers the reverse.
  await expect(page.getByRole("checkbox", { name: "Mark Blair to Alex $12.00 as unpaid" })).toBeChecked();
  await expect(page.getByText("1 of 1 payments settled")).toBeVisible();

  // The game survives a reload, and Home offers to continue it.
  await page.reload();
  await page.getByRole("button", { name: /^Continue / }).click();
  await openMode(page, "Settle");
  await expect(page.getByRole("checkbox", { name: "Mark Blair to Alex $12.00 as unpaid" })).toBeChecked();
});

test("keeps keyboard focus inside an open dialog", async ({ page, isMobile }) => {
  test.skip(isMobile, "Tab focus is a keyboard behavior");
  await startGame(page, ["Alex", "Blair"]);
  await openMode(page, "Play");
  await page.getByRole("article").first().getByRole("button", { name: "Rename player" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename player" });
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("fits the screen without sideways scrolling in every mode", async ({ page }) => {
  await startGame(page, ["Alex", "Blair", "Casey"]);
  for (const mode of ["Setup", "Play", "Cash Out", "Settle"] as const) {
    await openMode(page, mode);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${mode} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test("uses the phone header and Undo snackbar on tablets in portrait and short landscape screens", async ({ page, isMobile }) => {
  test.skip(isMobile, "resizes one desktop page through the sizes, which is enough for the layout");
  await startGame(page, ["Alex", "Blair", "Casey"]);
  await openMode(page, "Play");
  await buyIn(page, "Alex");
  const undo = page.getByRole("button", { name: "Undo recent transaction action" });
  const sizes = [
    { name: "tablet portrait", width: 810, height: 1080, compact: true },
    { name: "phone landscape", width: 915, height: 412, compact: true },
    { name: "tablet landscape", width: 1024, height: 768, compact: false },
    { name: "desktop", width: 1280, height: 720, compact: false }
  ];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openMode(page, "Play");
    // The phone shell: Undo is a snackbar naming the entry, and Home is just its icon.
    await expect(undo, size.name).toHaveCSS("position", size.compact ? "fixed" : "static");
    await expect(undo.getByText("Alex bought in"), size.name).toBeVisible({ visible: size.compact });
    await expect(page.getByRole("button", { name: "Home" }).getByText("Home"), size.name).toBeVisible({ visible: !size.compact });
    for (const mode of ["Setup", "Play", "Cash Out", "Settle"] as const) {
      await openMode(page, mode);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${mode} scrolls sideways at ${size.name}`).toBeLessThanOrEqual(0);
    }
  }
});

test("removes a seat with one tap right after typing a name", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game" }).click();
  const names = page.getByRole("textbox", { name: "Player name" });
  await names.nth(1).fill("Blair");
  await expect(page.getByText("New to Player History")).toBeVisible();
  // The name field still has focus; its Player History hint must not move the rows under the tap.
  // Phones get a real touch tap, whose events arrive in a different order from a mouse click.
  const remove = page.getByRole("button", { name: "Archive empty player" }).nth(5);
  if (isMobile) await remove.tap();
  else await remove.click();
  await expect(names).toHaveCount(5);
  await expect(names.nth(1)).toHaveValue("Blair");
  await expect(page.getByText("New to Player History")).toBeHidden();
});

test("keeps a name's hint when its field is focused again right after a press elsewhere", async ({ page, isMobile }) => {
  test.skip(isMobile, "uses a right-click, which never clicks");
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game" }).click();
  const blair = page.getByRole("textbox", { name: "Player name" }).nth(1);
  await blair.fill("Blair");
  await page.getByRole("button", { name: "Add player" }).click({ button: "right" });
  await blair.click();
  // Past the press window: a close left over from the right-click must not hide the hint.
  await page.waitForTimeout(1300);
  await expect(page.getByText("New to Player History")).toBeVisible();
});

test("hides a name's hint at once when the keyboard moves focus, even right after a right-click", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard focus");
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game" }).click();
  const blair = page.getByRole("textbox", { name: "Player name" }).nth(1);
  await blair.fill("Blair");
  await blair.click({ button: "right" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.getByText("New to Player History")).toBeHidden({ timeout: 300 });
});
