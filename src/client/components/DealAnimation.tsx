import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { DealingMessage, StateMessage } from "../../shared/protocol.ts";
import { Card } from "./Card.tsx";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";

interface DealAnimationProps {
  dealing: DealingMessage;
  state: StateMessage;
}

/**
 * Animates cards being dealt from a central deck out to each player in
 * round-robin order. The active user's cards are dealt face-up; everyone
 * else's are dealt face-down.
 *
 * The animation is purely visual -- the server has already dealt the hand.
 * After ~3s the server transitions to "playing" and the parent swaps us out.
 */
export function DealAnimation({ dealing, state }: DealAnimationProps) {
  const [dealtCount, setDealtCount] = useState(0);
  const numPlayers = dealing.playerOrder.length;
  const totalCards = numPlayers * dealing.mode;
  const dealIntervalMs = Math.max(2500 / totalCards, 50);

  useEffect(() => {
    if (dealtCount >= totalCards) return;
    const t = setTimeout(() => setDealtCount((n) => n + 1), dealIntervalMs);
    return () => clearTimeout(t);
  }, [dealtCount, totalCards, dealIntervalMs]);

  const selfIndex = dealing.playerOrder.indexOf(state.you.playerId);

  // Pre-compute position per player slot as percentages
  const positions = dealing.playerOrder.map((_, i) => {
    if (i === selfIndex) {
      // Self is at the bottom center
      return { xPct: 50, yPct: 85 };
    }
    // Other players distributed across the top
    const others = numPlayers - 1;
    const otherIndex = i < selfIndex ? i : i - 1;
    const xPct = others === 1 ? 50 : 20 + (60 * otherIndex) / (others - 1);
    return { xPct, yPct: 15 };
  });

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Player labels at the top */}
      <div className="flex justify-center gap-3 px-4 py-3">
        {dealing.playerOrder.map((pid, i) => {
          if (pid === state.you.playerId) return null;
          const player = state.players.find((p) => p.playerId === pid);
          if (!player) return null;
          const Icon = ICON_MAP[player.icon];
          const color = ICON_COLORS[i % ICON_COLORS.length];
          return (
            <div key={pid} className="flex flex-col items-center gap-1">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${color}`}
              >
                <Icon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs text-slate-300">{player.name}</span>
            </div>
          );
        })}
      </div>

      {/* Deck sits in the center */}
      <div className="flex-1 relative flex items-center justify-center">
        <div className="absolute inset-0 pointer-events-none">
          {/* Animated cards flying from the deck to each player */}
          {Array.from({ length: dealtCount }).map((_, i) => {
            const round = Math.floor(i / numPlayers);
            const slot = i % numPlayers;
            const pos = positions[slot];
            const isSelf = slot === selfIndex;
            // Only reveal actual card values for the user; others get face-down
            const card =
              isSelf && dealing.hand[round] ? dealing.hand[round] : undefined;

            return (
              <motion.div
                key={i}
                initial={{
                  left: "50%",
                  top: "50%",
                  x: "-50%",
                  y: "-50%",
                  opacity: 1,
                  rotateY: 0,
                }}
                animate={{
                  left: `${pos.xPct}%`,
                  top: `${pos.yPct}%`,
                  x: "-50%",
                  y: "-50%",
                  opacity: 1,
                }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute"
              >
                <Card
                  card={card}
                  faceDown={!isSelf}
                  size="md"
                />
              </motion.div>
            );
          })}
        </div>

        {/* The "deck" cards stack in the center until dealt */}
        <div className="relative">
          <Card faceDown size="lg" />
        </div>
      </div>

      {/* Bottom area is empty space for self's cards */}
      <div className="h-32" />

      {/* Status text */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mt-40 text-center pointer-events-none">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-gold font-bold text-lg"
        >
          Dealing...
        </motion.div>
      </div>
    </div>
  );
}
