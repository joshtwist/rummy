import { motion } from "framer-motion";
import type { Card as CardType } from "../../shared/types.ts";

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660",
};

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  selected?: boolean;
  interactive?: boolean;
  className?: string;
  layoutId?: string;
}

/* ── Dimension & typography tokens per size ─────────────────────────── */

const SIZE_CLASSES = {
  sm: "w-10 h-14 rounded-[6px]",
  md: "w-16 h-[90px] rounded-[10px]",
  lg: "w-[88px] h-[124px] rounded-[12px]",
} as const;

const RANK_CLASSES = {
  sm: "text-[9px] leading-[1]",
  md: "text-[15px] leading-[1]",
  lg: "text-[22px] leading-[1]",
} as const;

const SUIT_CLASSES = {
  sm: "text-[7px] leading-[1]",
  md: "text-[11px] leading-[1]",
  lg: "text-[15px] leading-[1]",
} as const;

/* ── Card back (face-down) ──────────────────────────────────────────── */

function CardBack({ size, className }: { size: "sm" | "md" | "lg"; className: string }) {
  return (
    <div
      className={`${SIZE_CLASSES[size]} relative bg-card-blue border border-card-blue-dark shadow-[0_2px_6px_var(--color-card-shadow)] overflow-hidden ${className}`}
    >
      {/* Outer inset border */}
      <div className="absolute inset-[3px] rounded-[inherit] border-[1.5px] border-card-blue-light/50">
        {/* Inner inset border */}
        <div className="absolute inset-[3px] rounded-[inherit] border border-card-blue-dark/60 bg-card-blue-dark/20" />
      </div>
    </div>
  );
}

/* ── Card face (face-up) ────────────────────────────────────────────── */

function CardFace({
  card,
  size,
  isRed,
  interactive,
  selected,
  onClick,
  className,
}: {
  card: CardType;
  size: "sm" | "md" | "lg";
  isRed: boolean;
  interactive: boolean;
  selected: boolean;
  onClick?: () => void;
  className: string;
}) {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const colorClass = isRed ? "text-card-red" : "text-card-black";

  return (
    <div
      className={`
        ${SIZE_CLASSES[size]}
        ${colorClass}
        relative bg-white border border-black/[0.08]
        shadow-[0_2px_6px_var(--color-card-shadow)]
        overflow-hidden
        ${interactive ? "cursor-pointer hover:shadow-[0_4px_12px_var(--color-card-shadow)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150" : ""}
        ${selected ? "ring-2 ring-gold -translate-y-2 shadow-[0_4px_14px_var(--color-card-shadow),0_0_0_2px_var(--color-gold)]" : ""}
        ${className}
      `.trim()}
      onClick={interactive ? onClick : undefined}
    >
      {/* Top-left: rank + suit */}
      <div className={`absolute ${CORNER_OFFSET[size]} top-0 left-0 flex flex-col items-center select-none`}>
        <span className={`${RANK_CLASSES[size]} font-bold`}>{card.rank}</span>
        <span className={`${SUIT_CLASSES[size]} -mt-[1px]`}>{suitSymbol}</span>
      </div>

      {/* Bottom-right: rank + suit, rotated 180° */}
      <div className={`absolute ${CORNER_OFFSET[size]} bottom-0 right-0 flex flex-col items-center rotate-180 select-none`}>
        <span className={`${RANK_CLASSES[size]} font-bold`}>{card.rank}</span>
        <span className={`${SUIT_CLASSES[size]} -mt-[1px]`}>{suitSymbol}</span>
      </div>
    </div>
  );
}

/* Corner padding (uses padding shorthand on the absolute box for offset) */
const CORNER_OFFSET = {
  sm: "p-[3px]",
  md: "p-[5px]",
  lg: "p-[8px]",
} as const;

/* ── Public Card component ──────────────────────────────────────────── */

export function Card({
  card,
  faceDown = false,
  size = "md",
  onClick,
  selected = false,
  interactive = false,
  className = "",
  layoutId,
}: CardProps) {
  const isRed = card != null && (card.suit === "hearts" || card.suit === "diamonds");

  const content =
    faceDown || !card ? (
      <CardBack size={size} className={className} />
    ) : (
      <CardFace
        card={card}
        size={size}
        isRed={isRed}
        interactive={interactive}
        selected={selected}
        onClick={onClick}
        className={className}
      />
    );

  if (layoutId) {
    return (
      <motion.div layoutId={layoutId} transition={{ duration: 0.25 }}>
        {content}
      </motion.div>
    );
  }

  return content;
}
