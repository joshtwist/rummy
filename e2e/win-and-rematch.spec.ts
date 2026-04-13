import { test, expect } from "@playwright/test";
import {
  createGame,
  joinAs,
  findActivePage,
  setupTwoPlayers,
} from "./helpers.ts";
import type { Card } from "../src/shared/types.ts";

/**
 * End-to-end exercise of the full game-end state machine:
 *
 *   lobby → dealing → playing → (Rummy!) → complete → rematch lobby
 *
 * We can't realistically rely on a random shuffle to deal one player a
 * winnable hand within a test budget, so we use the dev-only
 * `_test_force_hand` WebSocket message (gated by TEST_HOOKS=1 in
 * wrangler dev) to overwrite the active player's hand with a known
 * Rummy combo + one extra card to discard.
 *
 * After the win, we verify:
 *   - Both clients see the GameComplete screen with all hands.
 *   - The winner clicks "Create New Game" and is auto-navigated.
 *   - The other player sees a "Join {winner}'s New Game" CTA and can
 *     follow at their own pace — no forced redirect.
 *   - Both end up in the new lobby.
 */
test("7-card game played to a Rummy win, then rematch", async ({
  browser,
}) => {
  const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);

  try {
    // ── Setup a 7-card game ─────────────────────────────────────────
    const { gameUrl: oldGameUrl } = await createGame(page1);
    await joinAs(page1, "Alice", "cat");
    await page2.goto(oldGameUrl);
    await joinAs(page2, "Bob", "dog");
    await page1.getByTestId("mode-7").click();
    await page1.getByTestId("start-game-btn").click();

    // Wait for deal animation to settle into the playing phase
    await expect(page1.getByTestId("status-bar")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page2.getByTestId("status-bar")).toBeVisible({
      timeout: 10_000,
    });
    await page1.waitForTimeout(600);

    // Whoever's turn it is goes first. We give that player the win.
    const { active, waiting } = await findActivePage(page1, page2);
    const winnerName = active === page1 ? "Alice" : "Bob";
    const loserName = active === page1 ? "Bob" : "Alice";

    // ── Draw a card (active goes from 7 → 8 cards, enters discard phase) ─
    await active.getByTestId("deck").click();
    await expect(active.locator('[data-testid^="hand-card-"]')).toHaveCount(
      8,
      { timeout: 5_000 },
    );

    // ── Inject a winning hand: 8♦ to discard + a 3-run + a 4-set ───
    // After tossing 8♦, the remaining 7 cards split as:
    //   - run: A♣ 2♣ 3♣
    //   - set: 5♥ 5♦ 5♣ 5♠
    // canMeldHand returns true → game transitions to "complete".
    const winningHand: Card[] = [
      { suit: "diamonds", rank: "8" },
      { suit: "clubs", rank: "A" },
      { suit: "clubs", rank: "2" },
      { suit: "clubs", rank: "3" },
      { suit: "hearts", rank: "5" },
      { suit: "diamonds", rank: "5" },
      { suit: "clubs", rank: "5" },
      { suit: "spades", rank: "5" },
    ];
    await active.evaluate((hand) => {
      const ws = (window as unknown as { __ws?: WebSocket }).__ws;
      if (!ws) throw new Error("dev __ws hook missing — TEST_HOOKS not enabled?");
      ws.send(JSON.stringify({ type: "_test_force_hand", hand }));
    }, winningHand);

    // Wait for the forced 8♦ to actually appear in the active hand
    await expect(active.getByTestId("hand-card-diamonds-8")).toBeVisible({
      timeout: 5_000,
    });
    // And give the framer-motion mount/exit cycle a beat to settle so the
    // old cards are unmounted (avoids dragTo picking up a card mid-exit).
    await active.waitForTimeout(300);

    // ── Drag the 8♦ onto the discard pile to trigger the win ───────
    const discard = active.getByTestId("discard");
    const eightDiamonds = active.getByTestId("hand-card-diamonds-8");
    await eightDiamonds.dragTo(discard, {
      sourcePosition: { x: 8, y: 40 },
    });

    // ── Both clients see GameComplete ───────────────────────────────
    await expect(active.getByTestId("winner-banner")).toBeVisible({
      timeout: 8_000,
    });
    await expect(waiting.getByTestId("winner-banner")).toBeVisible({
      timeout: 8_000,
    });
    await expect(active.getByTestId("winner-banner")).toContainText(
      /you won/i,
    );
    await expect(waiting.getByTestId("winner-banner")).toContainText(
      new RegExp(`${winnerName} wins`, "i"),
    );

    // Both should see the final hands panel (i.e. the other player's
    // cards are visible — that was an explicit user requirement).
    await expect(active.getByTestId("final-scores")).toBeVisible();
    await expect(waiting.getByTestId("final-scores")).toBeVisible();
    await expect(
      waiting.getByTestId(`score-row-${winnerName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`score-row-${loserName}`),
    ).toBeVisible();

    // ── Winner clicks "Create New Game"; auto-navigates over ───────
    await active.getByTestId("create-rematch-btn").click();

    // Active player should land in the new lobby
    await active.waitForURL(
      (u) => u.pathname !== new URL(oldGameUrl).pathname,
      { timeout: 8_000 },
    );
    await expect(active.getByText("Lobby")).toBeVisible({ timeout: 8_000 });
    await expect(
      active.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();

    // ── Loser sees the "Join X's New Game" button (no auto-redirect) ─
    await expect(waiting.getByTestId("join-rematch-btn")).toBeVisible({
      timeout: 5_000,
    });
    await expect(waiting.getByTestId("join-rematch-btn")).toContainText(
      new RegExp(winnerName, "i"),
    );
    // And critically: this player has NOT been navigated yet.
    expect(waiting.url()).toBe(oldGameUrl);

    // ── Loser clicks the join button; ends up in the new lobby ──────
    await waiting.getByTestId("join-rematch-btn").click();
    await waiting.waitForURL(
      (u) => u.pathname !== new URL(oldGameUrl).pathname,
      { timeout: 8_000 },
    );
    await expect(waiting.getByText("Lobby")).toBeVisible({ timeout: 8_000 });

    // Both players should now be visible in the new lobby on both pages
    await expect(
      active.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();
    await expect(
      active.getByTestId(`lobby-player-${loserName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`lobby-player-${winnerName}`),
    ).toBeVisible();
    await expect(
      waiting.getByTestId(`lobby-player-${loserName}`),
    ).toBeVisible();

    // The new lobby is ready to play — Start Game becomes enabled
    // (at least on whichever page is now the host).
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
