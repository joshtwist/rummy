import { useEffect, useRef, useState } from "react";
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

export function useGameState(lastMessage: ServerMessage | null) {
  const [gameState, setGameState] = useState<GameState>({
    state: null,
    dealing: null,
    gameComplete: null,
    lobbyInfo: null,
    error: null,
  });

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case "state":
        setGameState((prev) => ({
          ...prev,
          state: lastMessage,
          // Clear dealing once we get a playing state
          dealing:
            lastMessage.phase === "playing" || lastMessage.phase === "complete"
              ? null
              : prev.dealing,
        }));
        break;

      case "dealing":
        setGameState((prev) => ({
          ...prev,
          dealing: lastMessage,
        }));
        break;

      case "lobby_info":
        setGameState((prev) => ({
          ...prev,
          lobbyInfo: lastMessage,
        }));
        break;

      case "game_complete":
        setGameState((prev) => ({
          ...prev,
          gameComplete: lastMessage,
        }));
        break;

      case "error":
        // Clear any existing timer
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        setGameState((prev) => ({
          ...prev,
          error: lastMessage.message,
        }));
        // Auto-clear error after 3s
        errorTimerRef.current = setTimeout(() => {
          setGameState((prev) => ({ ...prev, error: null }));
        }, 3000);
        break;

      case "player_joined":
        setGameState((prev) => {
          if (!prev.state) return prev;
          const exists = prev.state.players.some(
            (p) => p.playerId === lastMessage.player.playerId
          );
          if (exists) return prev;
          return {
            ...prev,
            state: {
              ...prev.state,
              players: [...prev.state.players, lastMessage.player],
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
                (p) => p.playerId !== lastMessage.playerId
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
                p.playerId === lastMessage.playerId
                  ? { ...p, connected: true }
                  : p
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
                p.playerId === lastMessage.playerId
                  ? { ...p, connected: false }
                  : p
              ),
            },
          };
        });
        break;
    }
  }, [lastMessage]);

  // Cleanup error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return gameState;
}
