import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Trophy, Sparkles, LogIn } from "lucide-react";
import type {
  GameCompleteMessage,
  StateMessage,
  ClientMessage,
  RematchInfoView,
} from "../../shared/protocol.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";
import { Card } from "./Card.tsx";

interface GameCompleteProps {
  state: StateMessage;
  result: GameCompleteMessage;
  send: (msg: ClientMessage) => void;
  onJoinRematch: (rematch: RematchInfoView) => void;
}

/**
 * End-of-game screen. Three possible CTAs, chosen from state:
 *
 * 1. `state.rematch == null`: show a big "Create New Game" button for
 *    whoever wants to move things along.
 * 2. `state.rematch != null` AND I'm the rematch creator: the very act
 *    of creating it auto-navigates me over (see effect below). We'd
 *    normally have already left this screen by the time this runs, but
 *    the fallback CTA says "Go to the new game" in case the navigate
 *    raced with the re-render.
 * 3. `state.rematch != null` AND I'm NOT the creator: show "Join
 *    {creatorName}'s New Game" — they choose to follow at their
 *    leisure. No forced redirect.
 *
 * The completed game persists in the Durable Object, so re-visiting
 * the URL (or a disconnect + reconnect) always lands back on this
 * screen with the same rematch info until one is created.
 */
export function GameComplete({
  state,
  result,
  send,
  onJoinRematch,
}: GameCompleteProps) {
  const isWinner = result.winnerId === state.you.playerId;
  const rematch = state.rematch;
  const amCreator = rematch?.creatorId === state.you.playerId;

  // If I created the rematch, jump me over automatically. Non-creators
  // get a button; they decide when to move.
  const autoJumpedRef = useRef(false);
  useEffect(() => {
    if (!rematch || !amCreator || autoJumpedRef.current) return;
    autoJumpedRef.current = true;
    onJoinRematch(rematch);
  }, [rematch, amCreator, onJoinRematch]);

  function handleCreateRematch() {
    send({ type: "create_rematch" });
  }

  function handleJoinRematch() {
    if (rematch) onJoinRematch(rematch);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 flex-col items-center px-6 py-8 overflow-y-auto"
    >
      {/* Winner banner */}
      <motion.div
        initial={{ scale: 0.9, y: -20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="flex flex-col items-center gap-3 mb-6"
      >
        <Trophy className="w-12 h-12 text-gold" fill="currentColor" />
        <h1 className="text-4xl font-bold text-center" data-testid="winner-banner">
          {isWinner ? "You Won!" : `${result.winnerName} Wins!`}
        </h1>
        <p className="text-slate-400 text-sm">Rummy!</p>
      </motion.div>

      {/* Celebration GIF */}
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 150, damping: 15, delay: 0.2 }}
        className="mb-6 rounded-2xl overflow-hidden shadow-2xl max-w-sm w-full"
      >
        <img
          src={result.celebrationGif}
          alt="Celebration"
          className="w-full h-auto block"
        />
      </motion.div>

      {/* Hands — everyone sees everyone's final cards */}
      <div
        className="w-full max-w-md bg-slate-800/60 border border-slate-700 rounded-2xl p-4 mb-6"
        data-testid="final-scores"
      >
        <h2 className="text-center text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Final Hands
        </h2>
        <div className="flex flex-col gap-3">
          {result.scores.map((score, i) => {
            const Icon = ICON_MAP[score.icon];
            const colorIndex = state.players.findIndex(
              (p) => p.playerId === score.playerId,
            );
            const color =
              ICON_COLORS[
                (colorIndex >= 0 ? colorIndex : i) % ICON_COLORS.length
              ];
            const isWinnerRow = score.playerId === result.winnerId;

            return (
              <div
                key={score.playerId}
                data-testid={`score-row-${score.name}`}
                className={`rounded-xl p-3 ${
                  isWinnerRow
                    ? "bg-gold/10 border border-gold/40"
                    : "bg-slate-900/60 border border-slate-800"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {score.name}
                      {isWinnerRow && (
                        <Sparkles className="w-4 h-4 text-gold" />
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {isWinnerRow
                        ? "Went Rummy"
                        : `${score.score} points in hand`}
                    </div>
                  </div>
                </div>
                {score.hand.length > 0 && (
                  <div className="flex flex-wrap gap-1 pl-1">
                    {score.hand.map((card, ci) => (
                      <Card key={ci} card={card} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      {rematch == null ? (
        <button
          onClick={handleCreateRematch}
          data-testid="create-rematch-btn"
          className="w-full max-w-sm py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-500 text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5" />
          Create New Game
        </button>
      ) : (
        <button
          onClick={handleJoinRematch}
          data-testid="join-rematch-btn"
          className="w-full max-w-sm py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-500 text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2"
        >
          <LogIn className="w-5 h-5" />
          {amCreator
            ? "Go to your new game"
            : `Join ${rematch.creatorName}'s New Game`}
        </button>
      )}
    </motion.div>
  );
}
