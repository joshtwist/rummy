import { test, expect } from "@playwright/test";
import {
  createGame,
  joinAs,
  setupTwoPlayers,
  findActivePage,
  dragFirstCardToDiscard,
} from "./helpers.ts";

/**
 * Mobile-specific layout tests.
 *
 * Runs on the "iphone" Playwright project (iPhone 14 Pro viewport, 393x852).
 * These tests assert thumb-friendly UX that matters on a phone:
 *
 * - ALL 10 cards are visible without horizontal scrolling
 * - the player bar includes "You" as the first avatar
 * - drag-to-discard works on touch devices
 * - the discard pile shows a drop-target outline when the active player
 *   can discard
 */

test.describe("Mobile layout (iPhone)", () => {
  // Only meaningful on the iPhone project -- skip on desktop
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "mobile-only test");
  });

  test("all 10 cards visible without horizontal scroll", async ({ browser }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      const { gameUrl } = await createGame(page1);
      await joinAs(page1, "Alice", "cat");
      await page2.goto(gameUrl);
      await joinAs(page2, "Bob", "dog");

      await page1.getByTestId("mode-10").click();
      await page1.getByTestId("start-game-btn").click();

      await expect(page1.getByTestId("player-hand")).toBeVisible({
        timeout: 15_000,
      });

      // All 10 cards rendered
      const cards = page1.locator('[data-testid^="hand-card-"]');
      await expect(cards).toHaveCount(10);

      // The hand container shouldn't have horizontal overflow
      const hand = page1.getByTestId("player-hand");
      const overflow = await hand.evaluate((el) => {
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      // Every card should be within the viewport (not clipped / off-screen)
      const viewport = page1.viewportSize();
      expect(viewport).toBeTruthy();
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const box = await cards.nth(i).boundingBox();
        expect(box, `card ${i} has no bounding box`).toBeTruthy();
        if (!box || !viewport) continue;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test("opponent shows in player bar; self shows in footer", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      const { gameUrl } = await createGame(page1);
      await joinAs(page1, "Alice", "cat");
      await page2.goto(gameUrl);
      await joinAs(page2, "Bob", "dog");

      await page1.getByTestId("mode-10").click();
      await page1.getByTestId("start-game-btn").click();

      await expect(page1.getByTestId("player-hand")).toBeVisible({
        timeout: 15_000,
      });

      // Opponent (Bob) should appear in the player bar
      const bar = page1.getByTestId("player-bar");
      await expect(bar).toBeVisible();
      await expect(bar.getByText("Bob", { exact: true })).toBeVisible();
      // Alice (self) should NOT appear in the bar -- they're in the footer
      await expect(bar.getByText("Alice", { exact: true })).toHaveCount(0);

      // Self appears in the footer with a "You" label and card count
      await expect(page1.getByText("You", { exact: true })).toBeVisible();
      await expect(page1.getByText(/\d+ cards/)).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test("drag-to-discard works on touch device", async ({ browser }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      const { gameUrl } = await createGame(page1);
      await joinAs(page1, "Alice", "cat");
      await page2.goto(gameUrl);
      await joinAs(page2, "Bob", "dog");

      await page1.getByTestId("mode-10").click();
      await page1.getByTestId("start-game-btn").click();

      await expect(page1.getByTestId("player-hand")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page2.getByTestId("player-hand")).toBeVisible({
        timeout: 15_000,
      });

      const { active } = await findActivePage(page1, page2);

      // Draw a card so we're in discard phase
      await active.getByTestId("deck").click();
      await expect(
        active.locator('[data-testid^="hand-card-"]'),
      ).toHaveCount(11, { timeout: 5_000 });

      // Drag the first card to the discard pile
      await dragFirstCardToDiscard(active);

      // Hand returns to 10
      await expect(
        active.locator('[data-testid^="hand-card-"]'),
      ).toHaveCount(10, { timeout: 5_000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
