import { motion } from "framer-motion";
import type { PlayerView } from "../../shared/protocol.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";

interface PlayerBarProps {
  players: PlayerView[];
  currentPlayerId: string | null;
  selfId: string;
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

        return (
          <div
            key={player.playerId}
            data-testid={`player-bar-${player.name}`}
            className="flex flex-col items-center gap-1 flex-shrink-0"
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
            <CardBacksVisualization count={player.cardCount} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stylized representation of a player's hand: a fanned row of small card
 * backs. Caps the visible count at 7 to keep the visual compact; actual
 * card count is conveyed by the discard/draw mechanics.
 */
function CardBacksVisualization({ count }: { count: number }) {
  const visible = Math.min(count, 7);
  if (visible === 0) {
    return <div className="h-5" />;
  }

  const cardW = 12;
  const overlap = 7;
  const totalW = cardW + (visible - 1) * (cardW - overlap);

  return (
    <div className="relative h-5" style={{ width: `${totalW}px` }}>
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          className="absolute top-0 rounded-[2px] bg-card-blue border border-card-blue-dark"
          style={{
            left: `${i * (cardW - overlap)}px`,
            width: `${cardW}px`,
            height: "20px",
            zIndex: i,
          }}
        >
          <div className="absolute inset-[1.5px] rounded-[1px] border border-card-blue-light/60" />
        </div>
      ))}
    </div>
  );
}
