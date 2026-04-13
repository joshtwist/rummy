import { test } from "@playwright/test";
import { createGame, joinAs, setupTwoPlayers } from "./helpers.ts";

/**
 * Captures screenshots of key mobile screens for visual review.
 * Disabled by default (only run with `pnpm test e2e/screenshot.spec.ts`).
 */
test.describe("Visual capture", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "iphone screenshots only");
  });

  test("mobile gameplay screenshot", async ({ browser }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      const { gameUrl } = await createGame(page1);
      await joinAs(page1, "Alice", "cat");
      await page2.goto(gameUrl);
      await joinAs(page2, "Bob", "dog");

      await page1.getByTestId("mode-10").click();
      await page1.getByTestId("start-game-btn").click();

      await page1
        .getByTestId("player-hand")
        .waitFor({ state: "visible", timeout: 15_000 });
      await page2
        .getByTestId("player-hand")
        .waitFor({ state: "visible", timeout: 15_000 });

      // Wait a moment for any animations to settle
      await page1.waitForTimeout(500);

      // Find the active player and take screenshots of both
      const p1Status = await page1.getByTestId("status-bar").textContent();
      const isP1Active = /your turn/i.test(p1Status ?? "");

      const activePage = isP1Active ? page1 : page2;
      const waitingPage = isP1Active ? page2 : page1;

      await activePage.screenshot({
        path: "test-results/mobile-active-player.png",
        fullPage: false,
      });
      await waitingPage.screenshot({
        path: "test-results/mobile-waiting-player.png",
        fullPage: false,
      });

      // Active player draws -> discard phase, captures the "drag here" hint
      await activePage.getByTestId("deck").click();
      await activePage.waitForTimeout(300);
      await activePage.screenshot({
        path: "test-results/mobile-discard-phase.png",
        fullPage: false,
      });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
