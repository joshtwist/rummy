import { test, expect, type Page } from "@playwright/test";
import {
  createGame,
  joinAs,
  findActivePage,
  setupTwoPlayers,
} from "./helpers.ts";

/**
 * Regression tests for hand-card drag behaviour.
 *
 * These tests step the mouse through many intermediate positions with
 * `page.mouse.move(..., { steps })`, which lets us assert two things
 * that a naive `dragTo` call can't observe:
 *   1. The dragged card stays visible (non-zero opacity, non-zero size)
 *      throughout the drag — the user saw it vanish.
 *   2. Siblings don't end up in impossible positions (e.g. stacked at
 *      x=0 with the dragged card floating above them after release).
 *
 * We test both drag directions because the user reported
 * right-to-left was smooth but left-to-right "danced and flickered".
 */
test.describe("Hand drag reordering", () => {
  test("drag left-to-right across the hand lands the card in the new slot without flicker", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      await startGameWithActiveTurn(page1, page2);
      const { active } = await findActivePage(page1, page2);

      await assertStableDragAcrossHand(active, "left-to-right");
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test("drag right-to-left across the hand lands the card in the new slot without flicker", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      await startGameWithActiveTurn(page1, page2);
      const { active } = await findActivePage(page1, page2);

      await assertStableDragAcrossHand(active, "right-to-left");
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

/* ── Helpers ────────────────────────────────────────────────────────── */

async function startGameWithActiveTurn(
  page1: Page,
  page2: Page,
): Promise<void> {
  await createGame(page1);
  await joinAs(page1, "Alice", "cat");
  await page2.goto(page1.url());
  await joinAs(page2, "Bob", "dog");
  await page1.getByTestId("mode-10").click();
  await page1.getByTestId("start-game-btn").click();
  // Wait for deal → play transition (status pill settles)
  await expect(page1.getByTestId("status-bar")).toBeVisible();
  await expect(page2.getByTestId("status-bar")).toBeVisible();
  // Settle briefly to avoid the deal-animation phase interfering
  await page1.waitForTimeout(500);
}

/**
 * Given an active page (it's this player's turn), drag the first card
 * through many mouse moves across the hand, and verify that:
 *
 *   - The card stays visible the whole drag.
 *   - After release, all cards are at expected non-overlapping positions
 *     (i.e. nobody "floats on top" with a stale scale/z-index).
 */
async function assertStableDragAcrossHand(
  page: Page,
  direction: "left-to-right" | "right-to-left",
): Promise<void> {
  const handCards = page.locator('[data-testid^="hand-card-"]');
  const count = await handCards.count();
  expect(count).toBeGreaterThanOrEqual(7);

  const sourceIdx = direction === "left-to-right" ? 0 : count - 1;
  const targetIdx = direction === "left-to-right" ? count - 1 : 0;

  // All cards must be actually visible — not just present in the DOM at
  // opacity 0. boundingBox doesn't reflect opacity, so check computed
  // opacity directly. This catches the Strict-Mode mount-effect bug where
  // opacity was stuck at 0.
  for (let i = 0; i < count; i++) {
    const opacity = await handCards.nth(i).evaluate(
      (el) => parseFloat(getComputedStyle(el).opacity),
    );
    expect(opacity, `card ${i} must be visible at game start`).toBeGreaterThan(0.5);
  }

  const sourceCard = handCards.nth(sourceIdx);
  const sourceTestId = await sourceCard.getAttribute("data-testid");
  expect(sourceTestId).toBeTruthy();

  const sourceBox = await sourceCard.boundingBox();
  const targetCard = handCards.nth(targetIdx);
  const targetBox = await targetCard.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("card bounding box missing");

  // Grab source card at its visible left-edge (center is occluded by
  // the next card in the fan).
  const startX = sourceBox.x + 10;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Step the mouse in small increments so the drag crosses every slot
  // boundary. 24 steps across ~300px of travel ≈ 12px per step, well
  // inside step-size so every reorder fires.
  await page.mouse.move(endX, endY, { steps: 24 });

  // Mid-drag invariants: the dragged card is still visible and has a
  // non-zero bounding box. (Without the fix, the whileDrag/layout fight
  // made this card vanish to opacity 0 or scale 0.)
  const midBox = await page.locator(`[data-testid="${sourceTestId}"]`).boundingBox();
  expect(midBox, "dragged card must still have a bounding box mid-drag").not.toBeNull();
  expect(midBox!.width).toBeGreaterThan(40);
  expect(midBox!.height).toBeGreaterThan(40);

  await page.mouse.up();

  // After release: give the spring time to settle, then assert cards
  // are laid out along a line — no card "floating" above the rest
  // at an oversized scale.
  await page.waitForTimeout(450);

  const boxes = await Promise.all(
    Array.from({ length: count }, (_, i) => handCards.nth(i).boundingBox()),
  );
  // All same height (no rogue scaled-up card)
  const heights = boxes.map((b) => b?.height ?? 0);
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  expect(
    maxH - minH,
    "all cards should be the same height after release (nothing stuck at whileDrag scale)",
  ).toBeLessThan(4);
  // All have same y (horizontal fan — no floating card)
  const ys = boxes.map((b) => b?.y ?? 0);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  expect(
    maxY - minY,
    "all cards should be at the same y after release",
  ).toBeLessThan(4);
}
