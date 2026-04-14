import { motion } from "framer-motion";
import type { GameMode } from "../../shared/types.ts";
import type { PlayerView } from "../../shared/protocol.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";

interface PlayerBarProps {
  players: PlayerView[];
  currentPlayerId: string | null;
  selfId: string;
  mode: GameMode | null;
}

/**
 * Horizontal row of opponent avatars at the top of the screen.
 *
 * Each opponent shows: avatar (colored circle with icon), name, and a
 * stylized stack of card backs representing their hand. The currently-active
 * player's avatar pulses gold.
 *
 * Self is intentionally omitted from this bar (they appear in the footer
 * with their actual hand below). This matches the reference layout where
 * the player banner is a clear "who am I playing against" view.
 */
export function PlayerBar({
  players,
  currentPlayerId,
  selfId,
  mode,
}: PlayerBarProps) {
  const opponents = players
    .map((p, i) => ({ player: p, colorIndex: i }))
    .filter(({ player }) => player.playerId !== selfId);

  if (opponents.length === 0) {
    return <div className="h-20" data-testid="player-bar" />;
  }

  return (
    <div
      className="flex justify-center gap-6 px-4 pt-3 pb-1"
      data-testid="player-bar"
    >
      {opponents.map(({ player, colorIndex }) => {
        const Icon = ICON_MAP[player.icon];
        const color = ICON_COLORS[colorIndex % ICON_COLORS.length];
        const isActive = currentPlayerId === player.playerId;
        const hasDrawn =
          isActive && mode != null && player.cardCount === mode + 1;

        return (
          <div
            key={player.playerId}
            data-testid={`player-bar-${player.name}`}
            className="flex flex-col items-center gap-2.5 flex-shrink-0"
          >
            <div className="relative">
              {isActive && (
                <motion.div
                  className="absolute -inset-1.5 rounded-full ring-2 ring-gold"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
              <div
                className={`relative w-12 h-12 rounded-full flex items-center justify-center ${color} ${
                  !player.connected ? "opacity-40" : ""
                }`}
              >
                <Icon className="w-6 h-6 text-white" />
              </div>
            </div>
            <span
              className={`text-xs font-medium max-w-[70px] truncate leading-tight ${
                isActive ? "text-gold" : "text-slate-200"
              }`}
            >
              {player.name}
            </span>
            <CardBacksVisualization
              count={player.cardCount}
              hasDrawn={hasDrawn}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stylized representation of a player's hand: a fanned row of small card
 * backs. Caps the visible count at 8 to keep the visual compact.
 *
 * When `hasDrawn` is true, the rightmost card renders in purple with a
 * pulse — a visual cue that this player has drawn and needs to discard.
 */
function CardBacksVisualization({
  count,
  hasDrawn,
}: {
  count: number;
  hasDrawn: boolean;
}) {
  const visible = Math.min(count, 8);
  if (visible === 0) {
    return <div className="h-7" />;
  }

  const cardW = 16;
  const overlap = 9;
  const totalW = cardW + (visible - 1) * (cardW - overlap);

  return (
    <div className="relative h-7" style={{ width: `${totalW}px` }}>
      {Array.from({ length: visible }).map((_, i) => {
        const isDrawnCard = hasDrawn && i === visible - 1;
        const left = i * (cardW - overlap);

        if (isDrawnCard) {
          return (
            <div
              key={i}
              className="absolute top-0 rounded-[3px] bg-purple-600 border border-purple-800"
              style={{ left: `${left}px`, width: `${cardW}px`, height: "26px", zIndex: i }}
            >
              <div className="absolute inset-[1.5px] rounded-[2px] border border-purple-400/60" />
              <motion.div
                className="absolute inset-0 rounded-[3px] ring-2 ring-purple-400 pointer-events-none"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            </div>
          );
        }

        return (
          <div
            key={i}
            className="absolute top-0 rounded-[3px] bg-card-blue border border-card-blue-dark"
            style={{ left: `${left}px`, width: `${cardW}px`, height: "26px", zIndex: i }}
          >
            <div className="absolute inset-[1.5px] rounded-[2px] border border-card-blue-light/60" />
          </div>
        );
      })}
    </div>
  );
}
