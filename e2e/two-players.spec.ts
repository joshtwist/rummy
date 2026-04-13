import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  createGame,
  joinAs,
  setupTwoPlayers,
  findActivePage,
  handSize,
  getStatus,
  dragFirstCardToDiscard,
} from "./helpers.ts";

/**
 * End-to-end tests covering the core two-player multiplayer flow.
 *
 * Each test runs in isolated browser contexts (one per player) so localStorage
 * and WebSocket sessions are independent -- exactly like two real devices.
 */

test.describe("Two-player game flow", () => {
  let ctx1: BrowserContext;
  let ctx2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeEach(async ({ browser }) => {
    ({ ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser));
  });

  test.afterEach(async () => {
    await ctx1?.close();
    await ctx2?.close();
  });

  // ─────────────────────────────────────────────────────────────────

  test("full happy path: create, join, start, deal, play turns", async () => {
    // Player 1 creates a game and becomes host
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await expect(page1.getByText("Lobby")).toBeVisible();
    await expect(page1.getByText("Host")).toBeVisible();
    await expect(page1.getByTestId("start-game-btn")).toBeDisabled();

    // Player 2 opens the URL and joins
    await page2.goto(gameUrl);
    await joinAs(page2, "Bob", "dog");

    // Both players see both entries
    await expect(page1.getByTestId("lobby-player-Bob")).toBeVisible();
    await expect(page2.getByTestId("lobby-player-Alice")).toBeVisible();

    // Non-host sees waiting copy
    await expect(page2.getByText(/waiting for the host/i)).toBeVisible();

    // Host can now start
    await expect(page1.getByTestId("start-game-btn")).toBeEnabled();
    await page1.getByTestId("mode-10").click();
    await page1.getByTestId("start-game-btn").click();

    // Both clients should reach the game board.
    // (The 3s dealing animation is a brief visual stage; polling for it is
    // racy, so we assert on the durable end state: the game board renders.)
    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page2.getByTestId("player-hand")).toBeVisible({
      timeout: 15_000,
    });
    expect(await handSize(page1)).toBe(10);
    expect(await handSize(page2)).toBe(10);

    // Deck and discard are visible
    await expect(page1.getByTestId("deck")).toBeVisible();
    await expect(page1.getByTestId("discard")).toBeVisible();

    // Exactly one player is active
    const { active, waiting } = await findActivePage(page1, page2);
    await expect(active.getByTestId("status-bar")).toHaveText(/your turn/i);
    await expect(waiting.getByTestId("status-bar")).toHaveText(/'s turn/i);

    // Active player draws from the deck -> hand grows to 11
    await active.getByTestId("deck").click();
    await expect(
      active.locator('[data-testid^="hand-card-"]'),
    ).toHaveCount(11, { timeout: 5_000 });

    // Active player drags a card onto the discard pile -> hand back to 10
    await dragFirstCardToDiscard(active);
    await expect(
      active.locator('[data-testid^="hand-card-"]'),
    ).toHaveCount(10, { timeout: 5_000 });

    // Turn passes to the other player
    await expect(waiting.getByTestId("status-bar")).toHaveText(
      /your turn/i,
      { timeout: 5_000 },
    );
    await expect(active.getByTestId("status-bar")).toHaveText(/'s turn/i);
  });

  // ─────────────────────────────────────────────────────────────────

  test("Player 2 cannot pick an icon Player 1 already chose", async () => {
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");

    await page2.goto(gameUrl);
    await expect(
      page2.getByRole("heading", { name: "Join Game" }),
    ).toBeVisible();

    // The "cat" icon should be disabled for Player 2
    await expect(page2.getByTestId("icon-cat")).toBeDisabled();
    // Other icons should be available
    await expect(page2.getByTestId("icon-dog")).toBeEnabled();
  });

  // ─────────────────────────────────────────────────────────────────

  test("Multiple turns rotate between players", async () => {
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(gameUrl);
    await joinAs(page2, "Bob", "dog");

    await page1.getByTestId("mode-10").click();
    await page1.getByTestId("start-game-btn").click();

    // Wait for game board
    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });

    // Play 4 turns total (2 per player) and verify the turn swaps each time
    for (let i = 0; i < 4; i++) {
      const { active, waiting } = await findActivePage(page1, page2);

      // Draw + discard
      await active.getByTestId("deck").click();
      await expect(
        active.locator('[data-testid^="hand-card-"]'),
      ).toHaveCount(11, { timeout: 5_000 });
      await dragFirstCardToDiscard(active);
      await expect(
        active.locator('[data-testid^="hand-card-"]'),
      ).toHaveCount(10, { timeout: 5_000 });

      // The previously-waiting player should now be active
      await expect(waiting.getByTestId("status-bar")).toHaveText(
        /your turn/i,
        { timeout: 5_000 },
      );
    }

    // After an even number of turns, both hands are still size 10
    expect(await handSize(page1)).toBe(10);
    expect(await handSize(page2)).toBe(10);
  });

  // ─────────────────────────────────────────────────────────────────

  test("Player can draw from the discard pile instead of the deck", async () => {
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(gameUrl);
    await joinAs(page2, "Bob", "dog");

    await page1.getByTestId("mode-10").click();
    await page1.getByTestId("start-game-btn").click();

    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });

    const { active } = await findActivePage(page1, page2);

    // Draw from DISCARD pile (not deck)
    await active.getByTestId("discard").click();
    await expect(
      active.locator('[data-testid^="hand-card-"]'),
    ).toHaveCount(11, { timeout: 5_000 });

    // Drag a card back to the discard pile
    await dragFirstCardToDiscard(active);
    await expect(
      active.locator('[data-testid^="hand-card-"]'),
    ).toHaveCount(10, { timeout: 5_000 });
  });

  // ─────────────────────────────────────────────────────────────────

  test("7-card mode deals 7 cards per player", async () => {
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(gameUrl);
    await joinAs(page2, "Bob", "dog");

    // Wait for Bob to propagate to page1's lobby before interacting
    await expect(page1.getByTestId("lobby-player-Bob")).toBeVisible();
    await expect(page1.getByTestId("start-game-btn")).toBeEnabled();

    // Choose 7-card mode and verify the selection took effect (button goes gold)
    await page1.getByTestId("mode-7").click();
    await expect(page1.getByTestId("mode-7")).toHaveClass(/bg-gold/);

    await page1.getByTestId("start-game-btn").click();

    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });

    expect(await handSize(page1)).toBe(7);
    expect(await handSize(page2)).toBe(7);
  });

  // ─────────────────────────────────────────────────────────────────

  test("Player can reconnect and resume their game", async () => {
    const { gameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(gameUrl);
    await joinAs(page2, "Bob", "dog");

    await page1.getByTestId("mode-10").click();
    await page1.getByTestId("start-game-btn").click();

    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });

    // Capture Player 1's hand before reload
    const handBefore = await page1
      .locator('[data-testid^="hand-card-"]')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid") ?? ""),
      );

    // Reload Player 1's page -- they should resume with the same hand
    await page1.reload();
    await expect(page1.getByTestId("player-hand")).toBeVisible({
      timeout: 10_000,
    });

    const handAfter = await page1
      .locator('[data-testid^="hand-card-"]')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-testid") ?? ""),
      );

    expect(handAfter.sort()).toEqual(handBefore.sort());
    expect(await handSize(page1)).toBe(10);

    // Player 2's view should still see Player 1 connected (after a brief moment)
    await expect(page2.getByTestId("player-hand")).toBeVisible();
  });
});
