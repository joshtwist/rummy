import type {
  Card,
  GameMode,
  GamePhase,
  TurnPhase,
  PlayerIcon,
} from "../shared/types.ts";
import { MAX_PLAYERS } from "../shared/types.ts";
import type {
  StateMessage,
  DealingMessage,
  PlayerView,
  SelfView,
} from "../shared/protocol.ts";
import { createDeck, shuffle, deal, scoreHand } from "./deck.ts";
import { canMeldHand } from "./melds.ts";

// ── State types ────────────────────────────────────────────────────

export interface Player {
  playerId: string;
  name: string;
  icon: PlayerIcon;
  connected: boolean;
}

export interface RematchInfo {
  gameId: string;
  creatorId: string;
  creatorName: string;
}

export interface GameState {
  gameId: string;
  phase: GamePhase;
  mode: GameMode | null;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  hands: Record<string, Card[]>;
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  creatorId: string;
  /**
   * Set after the game completes when someone opens a rematch. Other
   * players see this and can choose to hop into the new game at their
   * leisure. Null while the game is running or before anyone creates
   * a rematch. Once set, it sticks — the completed game acts as a
   * lobby pointer to the new one.
   */
  rematch: RematchInfo | null;
  /**
   * Picked by the DO when the game transitions to complete. Stored on
   * state so a player who reconnects after the win still sees the same
   * celebration GIF.
   */
  celebrationGif: string | null;
  /**
   * The player who completed their hand. Recorded at the moment the
   * game transitions to "complete"; before that it's null. Stored so
   * the win screen has a stable answer for "who won" without relying
   * on a hand-emptiness heuristic (Rummy wins keep cards in hand).
   */
  winnerId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function getPlayerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.playerId === playerId);
}

function assertPlayer(state: GameState, playerId: string): void {
  if (getPlayerIndex(state, playerId) === -1) {
    throw new Error("You are not in this game");
  }
}

// ── Public API (all pure) ──────────────────────────────────────────

/** Create a fresh game in lobby phase. No creator yet -- they join like everyone else. */
export function createGame(gameId: string): GameState {
  return {
    gameId,
    phase: "lobby",
    mode: null,
    players: [],
    deck: [],
    discardPile: [],
    hands: {},
    currentPlayerIndex: 0,
    turnPhase: "draw",
    creatorId: "",
    rematch: null,
    celebrationGif: null,
    winnerId: null,
  };
}

/** Add a player to the lobby. The first player to join becomes the creator. */
export function addPlayer(
  state: GameState,
  playerId: string,
  name: string,
  icon: PlayerIcon,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Cannot join: the game has already started");
  }
  if (state.players.length >= MAX_PLAYERS) {
    throw new Error(`Cannot join: the game is full (max ${MAX_PLAYERS} players)`);
  }
  if (state.players.some((p) => p.playerId === playerId)) {
    throw new Error("You have already joined this game");
  }

  const newPlayers = [
    ...state.players,
    { playerId, name, icon, connected: true },
  ];
  const creatorId = state.creatorId || playerId;

  return { ...state, players: newPlayers, creatorId };
}

/** Remove a player from the lobby. Only allowed before the game starts. */
export function removePlayer(
  state: GameState,
  playerId: string,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Cannot leave: the game has already started");
  }
  assertPlayer(state, playerId);

  const newPlayers = state.players.filter((p) => p.playerId !== playerId);

  // If the creator left, assign the next player (or clear if nobody remains)
  let { creatorId } = state;
  if (creatorId === playerId) {
    creatorId = newPlayers.length > 0 ? newPlayers[0].playerId : "";
  }

  return { ...state, players: newPlayers, creatorId };
}

/**
 * Start the game. Only the creator may call this.
 * Shuffles the deck, deals cards, flips the first discard.
 * Sets phase to "dealing" -- the DO will transition to "playing" after a delay.
 */
export function startGame(
  state: GameState,
  playerId: string,
  mode: GameMode,
): GameState {
  if (state.phase !== "lobby") {
    throw new Error("Game has already started");
  }
  if (state.creatorId !== playerId) {
    throw new Error("Only the game creator can start the game");
  }
  if (state.players.length < 2) {
    throw new Error("Need at least 2 players to start");
  }

  const shuffled = shuffle(createDeck());
  const playerIds = state.players.map((p) => p.playerId);
  const { hands, remaining } = deal(shuffled, playerIds, mode);

  // Flip the top card of the remaining deck onto the discard pile
  const firstDiscard = remaining.shift()!;

  // Randomise the starting player so the host doesn't always go first.
  const randBuf = new Uint32Array(1);
  crypto.getRandomValues(randBuf);
  const startingIndex = randBuf[0] % state.players.length;

  return {
    ...state,
    phase: "dealing",
    mode,
    deck: remaining,
    discardPile: [firstDiscard],
    hands,
    currentPlayerIndex: startingIndex,
    turnPhase: "draw",
  };
}

/**
 * Active player draws a card from the deck or the discard pile.
 * If the deck is empty, the discard pile (minus its top card) is reshuffled
 * into the deck before drawing.
 */
export function drawCard(
  state: GameState,
  playerId: string,
  source: "deck" | "discard",
): GameState {
  if (state.phase !== "playing") {
    throw new Error("Cannot draw: the game is not in progress");
  }
  if (state.turnPhase !== "draw") {
    throw new Error("Cannot draw: it is the discard phase");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) {
    throw new Error("It is not your turn");
  }

  let deck = [...state.deck];
  let discardPile = [...state.discardPile];
  let drawn: Card;

  if (source === "discard") {
    if (discardPile.length === 0) {
      throw new Error("The discard pile is empty");
    }
    drawn = discardPile.pop()!;
  } else {
    // source === "deck"
    if (deck.length === 0) {
      // Reshuffle: keep the top discard, shuffle the rest back into the deck
      if (discardPile.length <= 1) {
        throw new Error("No cards left to draw");
      }
      const topDiscard = discardPile.pop()!;
      deck = shuffle(discardPile);
      discardPile = [topDiscard];
    }
    drawn = deck.shift()!;
  }

  const hand = [...(state.hands[playerId] ?? []), drawn];

  return {
    ...state,
    deck,
    discardPile,
    hands: { ...state.hands, [playerId]: hand },
    turnPhase: "discard",
  };
}

/**
 * Active player discards a card from their hand. Either transitions the
 * game to "complete" (if the remaining hand can be fully partitioned
 * into valid Rummy melds) or advances to the next player in "draw"
 * phase.
 */
export function discardCard(
  state: GameState,
  playerId: string,
  card: Card,
): GameState {
  if (state.phase !== "playing") {
    throw new Error("Cannot discard: the game is not in progress");
  }
  if (state.turnPhase !== "discard") {
    throw new Error("Cannot discard: you must draw first");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) {
    throw new Error("It is not your turn");
  }

  const hand = state.hands[playerId] ?? [];
  const idx = hand.findIndex((c) => cardsEqual(c, card));
  if (idx === -1) {
    throw new Error("That card is not in your hand");
  }

  const newHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  const newDiscardPile = [...state.discardPile, card];

  // Win condition (Rummy): the remaining hand can be fully partitioned
  // into valid melds (sets or runs). The discard itself is the card
  // that "completes" the hand — everything left must be meldable.
  if (canMeldHand(newHand)) {
    return {
      ...state,
      hands: { ...state.hands, [playerId]: newHand },
      discardPile: newDiscardPile,
      phase: "complete",
      winnerId: playerId,
    };
  }

  // Advance to next player
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  return {
    ...state,
    hands: { ...state.hands, [playerId]: newHand },
    discardPile: newDiscardPile,
    currentPlayerIndex: nextIndex,
    turnPhase: "draw",
  };
}

/**
 * Attach a rematch pointer to a completed game. After this, every
 * connected client sees the rematch info in their state and can choose
 * to join the new game at their leisure (the UI surfaces a "Join X's
 * New Game" button).
 *
 * First caller wins: if a rematch is already set, this throws. That
 * keeps the state machine simple — there's exactly one rematch per
 * completed game.
 */
export function createRematch(
  state: GameState,
  playerId: string,
  newGameId: string,
): GameState {
  if (state.phase !== "complete") {
    throw new Error("Can only create a rematch after the game ends");
  }
  if (state.rematch) {
    throw new Error("A rematch has already been created for this game");
  }
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) {
    throw new Error("You are not in this game");
  }
  return {
    ...state,
    rematch: {
      gameId: newGameId,
      creatorId: playerId,
      creatorName: player.name,
    },
  };
}

/** Build the personalised StateMessage that one specific player should receive. */
export function getPlayerView(
  state: GameState,
  playerId: string,
): StateMessage {
  const selfPlayer = state.players.find((p) => p.playerId === playerId);
  if (!selfPlayer) {
    throw new Error("Player not found in game");
  }

  const you: SelfView = {
    playerId: selfPlayer.playerId,
    name: selfPlayer.name,
    icon: selfPlayer.icon,
    hand: state.hands[playerId] ?? [],
    isCreator: state.creatorId === playerId,
  };

  const players: PlayerView[] = state.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    icon: p.icon,
    cardCount: (state.hands[p.playerId] ?? []).length,
    connected: p.connected,
  }));

  const currentPlayerId =
    state.phase === "playing"
      ? state.players[state.currentPlayerIndex]?.playerId ?? null
      : null;

  const discardTop =
    state.discardPile.length > 0
      ? state.discardPile[state.discardPile.length - 1]
      : null;

  return {
    type: "state",
    phase: state.phase,
    mode: state.mode,
    turnPhase: state.phase === "playing" ? state.turnPhase : null,
    you,
    players,
    currentPlayerId,
    discardTop,
    deckCount: state.deck.length,
    rematch: state.rematch,
  };
}

/** Build the personalised DealingMessage for the dealing animation phase. */
export function getDealingView(
  state: GameState,
  playerId: string,
): DealingMessage {
  if (state.mode === null) {
    throw new Error("Game mode is not set");
  }

  const discardTop =
    state.discardPile.length > 0
      ? state.discardPile[state.discardPile.length - 1]
      : null;

  if (!discardTop) {
    throw new Error("No discard card available for dealing view");
  }

  return {
    type: "dealing",
    mode: state.mode,
    playerOrder: state.players.map((p) => p.playerId),
    hand: state.hands[playerId] ?? [],
    discardTop,
    deckCount: state.deck.length,
  };
}

/**
 * Build the game-complete result including scores.
 * The winner is recorded on state at the moment the hand goes Rummy
 * (see discardCard); we just look it up here. Other players' final
 * hands are sent so everyone can see how close they were.
 */
export function getGameCompleteResult(state: GameState): {
  winnerId: string;
  winnerName: string;
  scores: {
    playerId: string;
    name: string;
    icon: PlayerIcon;
    score: number;
    hand: Card[];
  }[];
} {
  const winner = state.winnerId
    ? state.players.find((p) => p.playerId === state.winnerId)
    : null;
  if (!winner) {
    throw new Error("No winner recorded for completed game");
  }

  const scores = state.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    icon: p.icon,
    // Winner scores 0 (they went Rummy). Others tally remaining cards.
    score:
      p.playerId === winner.playerId ? 0 : scoreHand(state.hands[p.playerId] ?? []),
    hand: state.hands[p.playerId] ?? [],
  }));

  // Sort: winner first, then by ascending score (lower = closer to winning)
  scores.sort((a, b) => {
    if (a.playerId === winner.playerId) return -1;
    if (b.playerId === winner.playerId) return 1;
    return a.score - b.score;
  });

  return {
    winnerId: winner.playerId,
    winnerName: winner.name,
    scores,
  };
}

/**
 * Mark a player as connected or disconnected.
 * Used by the DO when WebSocket connections open/close.
 */
export function setPlayerConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  const newPlayers = state.players.map((p) =>
    p.playerId === playerId ? { ...p, connected } : p,
  );
  return { ...state, players: newPlayers };
}

/** Transition from dealing to playing phase. Called by the DO alarm after the dealing delay. */
export function finishDealing(state: GameState): GameState {
  if (state.phase !== "dealing") {
    throw new Error("Game is not in the dealing phase");
  }
  return { ...state, phase: "playing" };
}
