import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ServerMessage,
  StateMessage,
  DealingMessage,
  GameCompleteMessage,
  LobbyInfoMessage,
} from "../../shared/protocol.ts";

interface GameState {
  state: StateMessage | null;
  dealing: DealingMessage | null;
  gameComplete: GameCompleteMessage | null;
  lobbyInfo: LobbyInfoMessage | null;
  error: string | null;
}

/**
 * Manages client-side game state derived from server messages.
 *
 * Returns a stable `processMessage` callback that should be called
 * directly from the WebSocket `onmessage` handler — NOT via an
 * intermediate `lastMessage` state. Using a state intermediary loses
 * messages when React batches rapid-fire updates (e.g. the server
 * sends both a `state` and `game_complete` message in the same
 * broadcast). Functional `setGameState(prev => ...)` updates are
 * immune to batching because each updater runs against the latest
 * state, in order.
 */
export function useGameState() {
  const [gameState, setGameState] = useState<GameState>({
    state: null,
    dealing: null,
    gameComplete: null,
    lobbyInfo: null,
    error: null,
  });

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const processMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "state":
        setGameState((prev) => ({
          ...prev,
          state: msg,
          dealing:
            msg.phase === "playing" || msg.phase === "complete"
              ? null
              : prev.dealing,
        }));
        break;

      case "dealing":
        setGameState((prev) => ({
          ...prev,
          dealing: msg,
        }));
        break;

      case "lobby_info":
        setGameState((prev) => ({
          ...prev,
          lobbyInfo: msg,
        }));
        break;

      case "game_complete":
        setGameState((prev) => ({
          ...prev,
          gameComplete: msg,
        }));
        break;

      case "error":
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        setGameState((prev) => ({
          ...prev,
          error: msg.message,
        }));
        errorTimerRef.current = setTimeout(() => {
          setGameState((prev) => ({ ...prev, error: null }));
        }, 3000);
        break;

      case "player_joined":
        setGameState((prev) => {
          if (!prev.state) return prev;
          const exists = prev.state.players.some(
            (p) => p.playerId === msg.player.playerId,
          );
          if (exists) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: [...prev.state.players, msg.player],
            },
          };
        });
        break;

      case "player_left":
        setGameState((prev) => {
          if (!prev.state) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: prev.state.players.filter(
                (p) => p.playerId !== msg.playerId,
              ),
            },
          };
        });
        break;

      case "player_reconnected":
        setGameState((prev) => {
          if (!prev.state) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: prev.state.players.map((p) =>
                p.playerId === msg.playerId
                  ? { ...p, connected: true }
                  : p,
              ),
            },
          };
        });
        break;

      case "player_disconnected":
        setGameState((prev) => {
          if (!prev.state) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: prev.state.players.map((p) =>
                p.playerId === msg.playerId
                  ? { ...p, connected: false }
                  : p,
              ),
            },
          };
        });
        break;
    }
  }, []);

  return { ...gameState, processMessage };
}
