import type { Card } from "../shared/types.ts";
import { RANK_ORDER } from "../shared/types.ts";

/**
 * Rummy meld rules:
 * - A SET is 3 or 4 cards of the same rank, all different suits
 *   (e.g. ♥5 ♦5 ♣5, or ♥5 ♦5 ♣5 ♠5).
 * - A RUN is 3 or more cards of the same suit in consecutive rank
 *   order (e.g. ♠A ♠2 ♠3, or ♦9 ♦10 ♦J ♦Q). Aces are LOW — K-A-2
 *   does not wrap.
 *
 * A hand "goes Rummy" when every card can be placed into some meld
 * with no leftovers. This module exports pure predicates (trivial to
 * unit-test) plus a backtracking partition check used by the game
 * engine to detect wins.
 */

export function isSet(cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = cards[0].rank;
  const suitsSeen = new Set<string>();
  for (const c of cards) {
    if (c.rank !== rank) return false;
    if (suitsSeen.has(c.suit)) return false;
    suitsSeen.add(c.suit);
  }
  return true;
}

export function isRun(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const suit = cards[0].suit;
  for (const c of cards) if (c.suit !== suit) return false;
  const values = cards.map((c) => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

/**
 * Returns true if the given hand can be fully partitioned into valid
 * melds (every card used). The algorithm:
 *
 *   1. Sort the hand canonically (by suit, then rank ascending).
 *   2. The first card MUST belong to some meld. Enumerate every meld
 *      that includes it — sets with cards of the same rank, runs
 *      walking upward in its suit.
 *   3. For each candidate, remove those cards and recurse on the rest.
 *
 * Canonical ordering keeps the search well-defined and avoids
 * exploring the same partition from multiple directions. Hand sizes
 * are small (≤ 10 in practice) so the exponential worst case is fine.
 */
export function canMeldHand(cards: Card[]): boolean {
  if (cards.length === 0) return true;
  if (cards.length < 3) return false;
  const sorted = [...cards].sort(compareCards);
  return canMeldSorted(sorted);
}

function compareCards(a: Card, b: Card): number {
  if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
  return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
}

function canMeldSorted(cards: Card[]): boolean {
  if (cards.length === 0) return true;
  if (cards.length < 3) return false;

  const first = cards[0];
  const candidates: Set<number>[] = [];

  // ── Set candidates: first card + 2 or 3 same-rank, different-suit cards.
  const sameRankIdxs: number[] = [];
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].rank === first.rank && cards[i].suit !== first.suit) {
      sameRankIdxs.push(i);
    }
  }
  for (let a = 0; a < sameRankIdxs.length; a++) {
    for (let b = a + 1; b < sameRankIdxs.length; b++) {
      // 3-card set
      candidates.push(new Set([0, sameRankIdxs[a], sameRankIdxs[b]]));
      for (let c = b + 1; c < sameRankIdxs.length; c++) {
        // 4-card set
        candidates.push(
          new Set([0, sameRankIdxs[a], sameRankIdxs[b], sameRankIdxs[c]]),
        );
      }
    }
  }

  // ── Run candidates: first card + consecutive higher ranks in same suit.
  // Because we sorted by (suit, rank), `first` is the lowest card of its
  // suit in the hand — so runs containing `first` must have `first` as
  // the lowest element of the run. This is what makes the canonical
  // ordering cover every partition.
  const firstVal = RANK_ORDER[first.rank];
  const chain: number[] = [0];
  let expected = firstVal + 1;
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].suit !== first.suit) continue;
    const val = RANK_ORDER[cards[i].rank];
    if (val === expected) {
      chain.push(i);
      expected += 1;
    } else if (val > expected) {
      break; // ranks continue, but not consecutive — stop
    }
  }
  // Every prefix of length ≥ 3 starting at 0 is a valid run meld.
  for (let len = 3; len <= chain.length; len++) {
    candidates.push(new Set(chain.slice(0, len)));
  }

  for (const used of candidates) {
    const remaining: Card[] = [];
    for (let i = 0; i < cards.length; i++) {
      if (!used.has(i)) remaining.push(cards[i]);
    }
    // `remaining` is still canonically sorted (we preserved relative order).
    if (canMeldSorted(remaining)) return true;
  }

  return false;
}
