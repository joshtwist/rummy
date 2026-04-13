import { test, expect, type BrowserContext } from "@playwright/test";
import { createGame, joinAs, setupTwoPlayers } from "./helpers.ts";

/**
 * Verifies the end-to-end share → join flow that real users actually do:
 *
 * 1. Player 1 creates a game and joins
 * 2. Player 1 clicks the Share button
 * 3. We capture the EXACT payload that navigator.share would receive
 * 4. Player 2 navigates to the captured URL
 * 5. Player 2 sees the join form (NOT stuck on "Connecting...")
 *
 * Catches regressions where:
 * - The share URL is malformed or carries extra junk text
 * - The recipient client gets stuck on the connecting screen
 */
test.describe("Share → join flow", () => {
  test("clicking Share produces a clean URL that opens the join form", async ({
    browser,
  }) => {
    const { ctx1, ctx2, page1, page2 } = await setupTwoPlayers(browser);
    try {
      // Capture whatever navigator.share is called with on page1
      let sharedPayload: { title?: string; text?: string; url?: string } | null =
        null;
      await ctx1.exposeFunction(
        "__capturedShare",
        (data: { title?: string; text?: string; url?: string }) => {
          sharedPayload = data;
        },
      );
      await ctx1.addInitScript(() => {
        (window.navigator as unknown as { share: unknown }).share = async (
          data: unknown,
        ) => {
          await (window as unknown as { __capturedShare: (d: unknown) => void })
            .__capturedShare(data);
        };
      });

      // Player 1 creates and joins, lands in the lobby
      await createGame(page1);
      await joinAs(page1, "Alice", "cat");

      // Click the Share / Invite Friends CTA -- the stub captures the payload
      await page1.getByRole("button", { name: /invite|share|copy/i }).click();

      await expect(async () => {
        expect(sharedPayload).not.toBeNull();
      }).toPass({ timeout: 5_000 });

      const payload = sharedPayload!;
      expect(payload.url).toBeTruthy();

      // The URL must be a clean game URL, no extra prefix/suffix
      const parsed = new URL(payload.url!);
      expect(parsed.pathname).toMatch(/^\/[a-z0-9]{4,8}$/);

      // Recipient opens the URL and must see the join form quickly --
      // not stuck on "Connecting..."
      await page2.goto(payload.url!);
      await expect(
        page2.getByRole("heading", { name: "Join Game" }),
      ).toBeVisible({ timeout: 8_000 });

      // And they should be able to actually join
      await joinAs(page2, "Bob", "dog");
      await expect(page1.getByTestId("lobby-player-Bob")).toBeVisible();
      await expect(page2.getByTestId("lobby-player-Alice")).toBeVisible();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test("connection failure surfaces a retry button (never infinite spinner)", async ({
    browser,
  }) => {
    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // Override the WebSocket constructor so every connection attempt
      // synchronously fails. Playwright's page.route doesn't intercept the
      // WebSocket protocol upgrade, but a constructor override does.
      await page.addInitScript(() => {
        class FailingWebSocket {
          readyState = 3; // CLOSED
          onopen: ((e: unknown) => void) | null = null;
          onclose: ((e: unknown) => void) | null = null;
          onerror: ((e: unknown) => void) | null = null;
          onmessage: ((e: unknown) => void) | null = null;
          constructor() {
            // Fire onclose on next tick so the hook can attach handlers first
            setTimeout(() => {
              if (this.onerror) this.onerror({});
              if (this.onclose) this.onclose({});
            }, 0);
          }
          send() {}
          close() {}
          addEventListener() {}
          removeEventListener() {}
        }
        (window as unknown as { WebSocket: unknown }).WebSocket =
          FailingWebSocket;
      });

      await page.goto("/badgame");

      // 3 attempts × {1s + 2s} backoff ≈ 3-7s before failed flag flips
      await expect(page.getByTestId("connection-failed")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("retry-btn")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
