import { expect, type Page, type BrowserContext } from "@playwright/test";
import type { PlayerIcon } from "../src/shared/types.ts";

/**
 * Shared helpers for two-player game tests.
 *
 * Each helper is tight, well-named, and exports only what's needed for
 * composition. Tests should read as prose, with the helpers doing the work.
 */

/** Create a fresh game via the homepage and return its game ID + URL. */
export async function createGame(page: Page): Promise<{
  gameId: string;
  gameUrl: string;
}> {
  await page.goto("/");
  await page.getByTestId("create-game-btn").click();
  await page.waitForURL(/\/[a-z0-9]{4,8}$/, { timeout: 10_000 });
  const gameUrl = page.url();
  const gameId = new URL(gameUrl).pathname.slice(1);
  return { gameId, gameUrl };
}

/** Fill in the join form and submit. */
export async function joinAs(
  page: Page,
  name: string,
  icon: PlayerIcon,
): Promise<void> {
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId(`icon-${icon}`).click();
  await page.getByTestId("join-btn").click();
  // Wait for lobby to render (we should see ourselves listed)
  await expect(page.getByTestId(`lobby-player-${name}`)).toBeVisible({
    timeout: 5_000,
  });
}

/** Read the status bar text on the game board. */
export async function getStatus(page: Page): Promise<string> {
  return (await page.getByTestId("status-bar").textContent()) ?? "";
}

/** Return true if this page currently has an active turn. */
export async function isActivePlayer(page: Page): Promise<boolean> {
  const status = await getStatus(page);
  return /your turn/i.test(status);
}

/** Return the page whose player is currently active. */
export async function findActivePage(
  page1: Page,
  page2: Page,
): Promise<{ active: Page; waiting: Page }> {
  const p1Active = await isActivePlayer(page1);
  const p2Active = await isActivePlayer(page2);
  if (p1Active && !p2Active) return { active: page1, waiting: page2 };
  if (p2Active && !p1Active) return { active: page2, waiting: page1 };
  throw new Error(
    `Expected exactly one active player. p1Active=${p1Active} p2Active=${p2Active}`,
  );
}

/** Drag the first card in hand onto the discard pile. */
export async function dragFirstCardToDiscard(page: Page): Promise<void> {
  // The hand fans cards with heavy overlap, so only the leftmost sliver of
  // each card (except the last) is uncovered. Grab the card at its visible
  // left-edge rather than the default center so Playwright doesn't hit the
  // card that's overlapping on top of it.
  const card = page.locator('[data-testid^="hand-card-"]').first();
  const discard = page.getByTestId("discard");
  await card.dragTo(discard, { sourcePosition: { x: 8, y: 40 } });
}

/** Play a single turn: draw from deck, drag first card to discard pile. */
export async function playTurn(activePage: Page): Promise<void> {
  await activePage.getByTestId("deck").click();
  await dragFirstCardToDiscard(activePage);
}

/** Count cards in a player's hand. */
export async function handSize(page: Page): Promise<number> {
  return page.locator('[data-testid^="hand-card-"]').count();
}

/** Attach error logging so failures surface console errors. */
export function attachErrorLogging(page: Page, label: string): void {
  page.on("pageerror", (err) => {
    console.log(`[${label} pageerror]`, err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[${label} console]`, msg.text());
    }
  });
}

/** Create two isolated contexts + pages for a two-player test. */
export async function setupTwoPlayers(browser: {
  newContext: () => Promise<BrowserContext>;
}): Promise<{
  ctx1: BrowserContext;
  ctx2: BrowserContext;
  page1: Page;
  page2: Page;
}> {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();
  attachErrorLogging(page1, "P1");
  attachErrorLogging(page2, "P2");
  return { ctx1, ctx2, page1, page2 };
}
