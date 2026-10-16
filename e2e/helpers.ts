import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** Whether `.env.local` points the dev server at a Convex deployment, which the sharing tests need. */
export function sharingConfigured(): boolean {
  try {
    return /^VITE_CONVEX_URL=\S+/m.test(readFileSync(".env.local", "utf8"));
  } catch {
    return false;
  }
}

export function modes(page: Page) {
  return page.getByRole("navigation", { name: "Poker tracker modes" });
}

export async function openMode(page: Page, mode: "Setup" | "Play" | "Cash Out" | "Settle") {
  await modes(page).getByRole("button", { name: mode, exact: true }).click();
  await expect(modes(page).getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
}

export function seat(page: Page, name: string) {
  return page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

export function chipPool(page: Page) {
  return page.getByRole("region", { name: "Chip pool" });
}

/** Starts a fresh local game with the given players (the rest of the default seats removed) and a $1 chip. */
export async function startGame(page: Page, players: string[]) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game" }).click();
  const names = page.getByRole("textbox", { name: "Player name" });
  await expect(names).toHaveCount(6);
  for (const [index, name] of players.entries()) await names.nth(index).fill(name);
  const remove = page.getByRole("button", { name: "Archive empty player" });
  for (let count = 6; count > players.length; count -= 1) {
    await remove.nth(count - 1).click();
    await expect(names).toHaveCount(count - 1);
  }
  await page.getByRole("button", { name: "Add chip" }).click();
  await page.getByRole("textbox", { name: "Chip color name" }).fill("White");
  await page.getByPlaceholder("0.25").fill("1");
  await page.getByRole("button", { name: "Save chip key" }).click();
}

export async function buyIn(page: Page, name: string) {
  // Named "Record default buy-in" on the table and "Buy in" in the phone list; both carry the title.
  await seat(page, name).getByTitle("Record default buy-in").click();
}

export async function cashOut(page: Page, name: string, chips: number) {
  await page.getByRole("textbox", { name: `${name} White chip count` }).fill(String(chips));
  await seat(page, name).getByRole("button", { name: "Record cash-out" }).click();
}
