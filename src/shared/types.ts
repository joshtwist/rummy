export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GameMode = 7 | 10;

export type GamePhase = "lobby" | "dealing" | "playing" | "complete";

export type TurnPhase = "draw" | "discard";

export const PLAYER_ICONS = [
  "cat",
  "dog",
  "bird",
  "fish",
  "rabbit",
  "snail",
  "bug",
  "flame",
  "zap",
  "star",
  "moon",
  "sun",
  "heart",
  "skull",
  "ghost",
  "rocket",
  "crown",
  "gem",
  "anchor",
  "gamepad-2",
] as const;

export type PlayerIcon = (typeof PLAYER_ICONS)[number];

export const MAX_PLAYERS = 4;

export const CARD_VALUES: Record<Rank, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
};

/**
 * Ordinal rank position used for detecting runs. Different from CARD_VALUES,
 * which collapses J/Q/K to 10 for scoring. A run must have consecutive
 * positions, so we need distinct values for J=11, Q=12, K=13. Aces are
 * low (A=1): the run A-2-3 is valid, K-A-2 is not.
 */
export const RANK_ORDER: Record<Rank, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
};
