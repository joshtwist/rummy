import { DurableObject } from "cloudflare:workers";
import type { Card } from "../shared/types.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import {
  createGame,
  addPlayer,
  removePlayer,
  startGame,
  drawCard,
  discardCard,
  createRematch,
  getPlayerView,
  getDealingView,
  getGameCompleteResult,
  setPlayerConnected,
  finishDealing,
} from "./game-engine.ts";
import type { GameState } from "./game-engine.ts";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  /** "1" to enable test-only messages like _test_force_hand. */
  TEST_HOOKS?: string;
}

const CELEBRATION_GIFS = [
  "https://i.giphy.com/media/KEVNWkmWm6dm8/giphy.gif",
  "https://i.giphy.com/media/3kD720zFVu22rfIA0s/giphy.gif",
  "https://i.giphy.com/media/dtxA3U6yLPRW569tCu/giphy.gif",
  "https://i.giphy.com/media/o75ajIFH0QnQC3nCeD/giphy.gif",
  "https://i.giphy.com/media/RPwrO4b46mOdy/giphy.gif",
  "https://i.giphy.com/media/yoJC2JaiEMoxIhQhY4/giphy.gif",
  "https://i.giphy.com/media/lZTvTGEGKU6gnQ2wBr/giphy.gif",
  "https://i.giphy.com/media/S2jPUl8fNnydeNZD0g/giphy.gif",
  "https://i.giphy.com/media/hzqkBHPKL3z07ORokF/giphy.gif",
  "https://i.giphy.com/media/lMameLIF8voLu8HxWV/giphy.gif",
  "https://i.giphy.com/media/K3RxMSrERT8iI/giphy.gif",
  "https://i.giphy.com/media/lnlAifQdenMxW/giphy.gif",
  "https://i.giphy.com/media/BylKa7s0D8BTMnBaSH/giphy.gif",
  "https://i.giphy.com/media/d7fKljD4WRftoHF031/giphy.gif",
  "https://i.giphy.com/media/fUQ4rhUZJYiQsas6WD/giphy.gif",
  "https://i.giphy.com/media/pa37AAGzKXoek/giphy.gif",
  "https://i.giphy.com/media/9wcu6Tr1ecmxa/giphy.gif",
  "https://i.giphy.com/media/15BuyagtKucHm/giphy.gif",
  "https://i.giphy.com/media/TcKmUDTdICRwY/giphy.gif",
  "https://i.giphy.com/media/3oFzm6XsCKxVRbZDLq/giphy.gif",
];

const DEALING_DELAY_MS = 3000;

export class GameRoom extends DurableObject<Env> {
  private gameState: GameState | null = null;

  // ── State persistence ────────────────────────────────────────────

  private async loadState(): Promise<GameState> {
    if (this.gameState) return this.gameState;

    const stored = await this.ctx.storage.get<GameState>("state");
    if (stored) {
      this.gameState = stored;
      return this.gameState;
    }

    // First access: create an empty lobby. The gameId will be set from the
    // URL path on the first fetch() call.
    this.gameState = createGame("");
    return this.gameState;
  }

  private async saveState(newState: GameState): Promise<void> {
    this.gameState = newState;
    await this.ctx.storage.put("state", newState);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private getPlayerIdFromSocket(ws: WebSocket): string | null {
    const tags = this.ctx.getTags(ws);
    return tags.length > 0 ? tags[0] : null;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket may have closed between check and send; swallow.
    }
  }

  /** Build the LobbyInfoMessage that non-player sockets receive. */
  private lobbyInfo(state: GameState): ServerMessage {
    return {
      type: "lobby_info",
      phase: state.phase,
      players: state.players.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        icon: p.icon,
      })),
    };
  }

  /**
   * Broadcast to every connected socket:
   * - Players receive their personalised StateMessage.
   * - Non-players (viewing the join form) receive a LobbyInfoMessage so the
   *   UI can show which names/icons are already taken.
   * - If the game has completed, every connected client also gets a
   *   GameCompleteMessage with the persisted celebration GIF + final
   *   hands. Sending it on every broadcast (not just the discard that
   *   triggers the win) means a reconnecting client always lands on
   *   the win screen with the same data.
   */
  private broadcastState(state: GameState): void {
    const info = this.lobbyInfo(state);
    const completeMsg = this.buildCompleteMessage(state);
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      const playerId = tags[0];
      if (!playerId) continue;

      const isPlayer = state.players.some((p) => p.playerId === playerId);
      if (isPlayer) {
        this.send(ws, getPlayerView(state, playerId));
      } else {
        this.send(ws, info);
      }
      if (completeMsg) this.send(ws, completeMsg);
    }
  }

  private buildCompleteMessage(state: GameState): ServerMessage | null {
    if (state.phase !== "complete" || !state.celebrationGif) return null;
    const result = getGameCompleteResult(state);
    return {
      type: "game_complete",
      winnerId: result.winnerId,
      winnerName: result.winnerName,
      scores: result.scores,
      celebrationGif: state.celebrationGif,
    };
  }

  /** Send the same message to every connected socket. */
  private broadcastToAll(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, msg);
    }
  }

  // ── HTTP handler (WebSocket upgrade) ─────────────────────────────
  //
  // The client ALWAYS connects with ?playerId=<uuid> in the URL.
  // - New players: client generates a UUID first, connects, then sends a
  //   "join" message with name + icon.
  // - Returning players: client reads the UUID from localStorage, connects
  //   with it, and sends a "reconnect" message.
  //
  // This means every accepted WebSocket is tagged with a playerId from the
  // start, which keeps the hibernation API usage clean.

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Extract game ID from URL and ensure state is initialised
    const pathMatch = url.pathname.match(/\/api\/game\/([a-z0-9]+)\/ws/);
    const gameId = pathMatch ? pathMatch[1] : "";
    let state = await this.loadState();
    if (!state.gameId) {
      state = { ...state, gameId };
      await this.saveState(state);
    }

    // playerId is required in the query string
    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      return new Response("Missing playerId query parameter", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Always tag the socket with the playerId
    this.ctx.acceptWebSocket(server, [playerId]);

    // If this player already exists in the game, mark them connected and
    // push the current state immediately so the client doesn't flash empty.
    const existingPlayer = state.players.some(
      (p) => p.playerId === playerId,
    );
    if (existingPlayer) {
      state = setPlayerConnected(state, playerId, true);
      await this.saveState(state);
      this.send(server, getPlayerView(state, playerId));
      this.broadcastToAll({ type: "player_reconnected", playerId });
    } else {
      // New (non-player) socket -- send the lobby info so the join form
      // knows which names/icons are already taken.
      this.send(server, this.lobbyInfo(state));
    }

    // Whether or not they're a player, if the game is already complete,
    // send the game-complete payload so the win screen shows up
    // immediately (e.g. someone reopens the URL after the game ended).
    const completeMsg = this.buildCompleteMessage(state);
    if (completeMsg) this.send(server, completeMsg);

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation event handlers ───────────────────────────────────

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      await this.handleMessage(ws, msg);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      this.send(ws, { type: "error", message: errMsg });
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) return;

    const state = await this.loadState();
    const playerExists = state.players.some((p) => p.playerId === playerId);
    if (!playerExists) return;

    // Only mark disconnected if this was the player's last socket
    const remaining = this.ctx.getWebSockets(playerId).filter((s) => s !== ws);
    if (remaining.length === 0) {
      const newState = setPlayerConnected(state, playerId, false);
      await this.saveState(newState);
      this.broadcastToAll({ type: "player_disconnected", playerId });
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1006, "error", false);
  }

  // ── Alarm handler (dealing -> playing transition) ────────────────

  async alarm(): Promise<void> {
    let state = await this.loadState();
    if (state.phase !== "dealing") return;

    state = finishDealing(state);
    await this.saveState(state);
    this.broadcastState(state);
  }

  // ── Message dispatch ─────────────────────────────────────────────

  private async handleMessage(
    ws: WebSocket,
    msg: ClientMessage,
  ): Promise<void> {
    switch (msg.type) {
      case "ping":
        this.send(ws, { type: "pong" });
        return;

      case "join":
        await this.handleJoin(ws, msg.playerId, msg.name, msg.icon);
        return;

      case "reconnect":
        await this.handleReconnect(ws, msg.playerId);
        return;

      case "start_game":
        await this.handleStartGame(ws, msg.mode);
        return;

      case "draw":
        await this.handleDraw(ws, msg.source);
        return;

      case "discard":
        await this.handleDiscard(ws, msg.card);
        return;

      case "create_rematch":
        await this.handleCreateRematch(ws);
        return;

      case "_test_force_hand": {
        const pid = this.getPlayerIdFromSocket(ws);
        if (pid) await this.handleTestForceHand(pid, msg.hand);
        return;
      }

      default:
        this.send(ws, { type: "error", message: "Unknown message type" });
    }
  }

  // ── Individual handlers ──────────────────────────────────────────

  private async handleJoin(
    _ws: WebSocket,
    playerId: string,
    name: string,
    icon: string,
  ): Promise<void> {
    let state = await this.loadState();

    // The socket is already tagged with this playerId from fetch().
    state = addPlayer(state, playerId, name, icon as any);
    await this.saveState(state);

    // Broadcast personalised state to everyone (including the joiner).
    // This is simpler and always correct compared to sending player_joined
    // deltas -- each client always has the full view.
    this.broadcastState(state);
  }

  private async handleReconnect(
    ws: WebSocket,
    playerId: string,
  ): Promise<void> {
    let state = await this.loadState();

    const playerExists = state.players.some((p) => p.playerId === playerId);
    if (!playerExists) {
      this.send(ws, {
        type: "error",
        message: "Player not found. Please join as a new player.",
      });
      return;
    }

    state = setPlayerConnected(state, playerId, true);
    await this.saveState(state);

    // Send full state to the reconnected player
    this.send(ws, getPlayerView(state, playerId));

    // Notify everyone
    this.broadcastToAll({ type: "player_reconnected", playerId });
  }

  private async handleStartGame(
    ws: WebSocket,
    mode: 7 | 10,
  ): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) {
      this.send(ws, { type: "error", message: "Not identified" });
      return;
    }

    let state = await this.loadState();
    state = startGame(state, playerId, mode);
    await this.saveState(state);

    // Broadcast state (phase: "dealing") first so clients switch UI.
    // Then send the personalised dealing view with animation data.
    this.broadcastState(state);
    for (const player of state.players) {
      const sockets = this.ctx.getWebSockets(player.playerId);
      const dealingView = getDealingView(state, player.playerId);
      for (const s of sockets) {
        this.send(s, dealingView);
      }
    }

    // After the dealing animation, transition to "playing"
    await this.ctx.storage.setAlarm(Date.now() + DEALING_DELAY_MS);
  }

  private async handleDraw(
    ws: WebSocket,
    source: "deck" | "discard",
  ): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) {
      this.send(ws, { type: "error", message: "Not identified" });
      return;
    }

    let state = await this.loadState();
    state = drawCard(state, playerId, source);
    await this.saveState(state);
    this.broadcastState(state);
  }

  private async handleDiscard(ws: WebSocket, card: Card): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) {
      this.send(ws, { type: "error", message: "Not identified" });
      return;
    }

    let state = await this.loadState();
    state = discardCard(state, playerId, card);

    // If this discard ended the game, pick a celebration GIF and pin
    // it to the state so reconnecting clients see the same one.
    if (state.phase === "complete" && !state.celebrationGif) {
      const gifIndex = Math.floor(Math.random() * CELEBRATION_GIFS.length);
      state = { ...state, celebrationGif: CELEBRATION_GIFS[gifIndex] };
    }

    await this.saveState(state);
    this.broadcastState(state);
  }

  /**
   * Player opened a rematch from the win screen. We:
   *   1. Generate a new gameId and attach it to the completed state.
   *   2. Broadcast updated state to all connected clients so they
   *      see the "Join X's New Game" CTA.
   *   3. The creator still gets a client-side navigate to the new
   *      game (they initiated it); others choose at their leisure.
   *
   * Calling this twice on the same game is a no-op for the 2nd caller
   * — `createRematch()` throws if a rematch already exists. The error
   * propagates back as a normal error message, which the client UI
   * can surface if it wants to.
   */
  private async handleCreateRematch(ws: WebSocket): Promise<void> {
    const playerId = this.getPlayerIdFromSocket(ws);
    if (!playerId) {
      this.send(ws, { type: "error", message: "Not identified" });
      return;
    }

    let state = await this.loadState();
    const newGameId = generateGameId();
    state = createRematch(state, playerId, newGameId);
    await this.saveState(state);
    this.broadcastState(state);
  }

  /**
   * Test-only hook. Replaces a player's hand with the supplied cards.
   * Used by the e2e suite to set up "one discard away from Rummy"
   * scenarios deterministically instead of shuffle-gambling for them.
   * Ignored unless TEST_HOOKS is explicitly enabled in the worker env.
   */
  private async handleTestForceHand(
    playerId: string,
    hand: Card[],
  ): Promise<void> {
    if (this.env.TEST_HOOKS !== "1") return;
    const state = await this.loadState();
    const newState: GameState = {
      ...state,
      hands: { ...state.hands, [playerId]: hand },
    };
    await this.saveState(newState);
    this.broadcastState(newState);
  }
}

// ── Utility ────────────────────────────────────────────────────────

const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateGameId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += ALPHANUM[buf[i] % ALPHANUM.length];
  }
  return id;
}
