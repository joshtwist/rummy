import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Play } from "lucide-react";
import type { StateMessage, ClientMessage } from "../../shared/protocol.ts";
import type { GameMode } from "../../shared/types.ts";
import { MAX_PLAYERS } from "../../shared/types.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";
import { ShareButton } from "./ShareButton.tsx";

interface LobbyProps {
  state: StateMessage;
  gameId: string;
  send: (msg: ClientMessage) => void;
}

export function Lobby({ state, gameId, send }: LobbyProps) {
  const [mode, setMode] = useState<GameMode>(10);
  const { you, players } = state;
  const canStart = players.length >= 2;

  function handleStart() {
    if (!canStart) return;
    send({ type: "start_game", mode });
  }

  return (
    <div className="flex flex-1 flex-col px-6 py-8 max-w-lg w-full mx-auto">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold">Lobby</h1>
        <p className="text-slate-400 mt-1">Waiting for players to join</p>
      </div>

      {/* Player list */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3 text-slate-300">
          <Users className="w-4 h-4" />
          <span className="text-sm font-medium">
            Players ({players.length}/{MAX_PLAYERS})
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {players.map((player, i) => {
            const Icon = ICON_MAP[player.icon];
            const color = ICON_COLORS[i % ICON_COLORS.length];
            const isYou = player.playerId === you.playerId;
            const isCreator = i === 0;
            return (
              <motion.div
                key={player.playerId}
                data-testid={`lobby-player-${player.name}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 bg-slate-900/60 rounded-xl p-3"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}
                >
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="font-medium flex-1">
                  {player.name}
                  {isYou && (
                    <span className="text-slate-400 text-sm ml-1">(you)</span>
                  )}
                </span>
                {isCreator && (
                  <span className="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded-full">
                    Host
                  </span>
                )}
                {!player.connected && (
                  <span className="text-xs text-slate-500">offline</span>
                )}
              </motion.div>
            );
          })}
          {Array.from({ length: MAX_PLAYERS - players.length }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex items-center gap-3 bg-slate-900/30 border border-dashed border-slate-700 rounded-xl p-3"
            >
              <div className="w-10 h-10 rounded-full bg-slate-800 flex-shrink-0" />
              <span className="text-slate-500 text-sm">Waiting...</span>
            </div>
          ))}
        </div>
      </div>

      {/* Share link -- primary CTA while there aren't enough players yet,
          secondary once Start Game becomes actionable. */}
      <div className="mb-3">
        <ShareButton
          gameId={gameId}
          emphasis={canStart ? "secondary" : "primary"}
        />
      </div>
      {!canStart && (
        <p className="text-center text-slate-400 text-sm mb-6">
          Tap above to invite friends — need at least 2 players to start
        </p>
      )}
      {canStart && <div className="mb-3" />}

      {/* Host controls */}
      {you.isCreator ? (
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-slate-300 block mb-2">
              Game Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([7, 10] as GameMode[]).map((m) => (
                <button
                  key={m}
                  data-testid={`mode-${m}`}
                  onClick={() => setMode(m)}
                  className={`py-3 px-4 rounded-xl font-semibold text-center transition-all duration-200 cursor-pointer ${
                    mode === m
                      ? "bg-gold text-slate-900 shadow-md"
                      : "bg-slate-900 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {m} cards
                </button>
              ))}
            </div>
          </div>

          <button
            data-testid="start-game-btn"
            onClick={handleStart}
            disabled={!canStart}
            className="w-full py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5" fill="currentColor" />
            {canStart
              ? "Start Game"
              : `Need ${2 - players.length} more player${2 - players.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : (
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 text-center">
          <p className="text-slate-400">
            Waiting for the host to start the game...
          </p>
        </div>
      )}
    </div>
  );
}
