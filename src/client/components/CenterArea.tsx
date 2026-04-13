import { motion } from "framer-motion";
import type { RefObject } from "react";
import type { Card as CardType } from "../../shared/types.ts";
import { Card } from "./Card.tsx";

interface CenterAreaProps {
  discardTop: CardType | null;
  deckCount: number;
  canDraw: boolean;
  canDiscard: boolean;
  isDraggingCard: boolean;
  isDragOverDiscard: boolean;
  discardRef: RefObject<HTMLDivElement | null>;
  onDrawDeck: () => void;
  onDrawDiscard: () => void;
}

/**
 * Central play area: a 3D-stacked draw deck on the left and the face-up
 * discard pile on the right.
 *
 * Visual states:
 * - Draw phase + your turn: both piles pulse gold, tap to draw
 * - Discard phase + your turn: discard pile shows a dashed gold outline
 *   inviting a drag-and-drop. Stronger when a card is being dragged,
 *   solid + scaled when the pointer is over the pile.
 */
export function CenterArea({
  discardTop,
  deckCount,
  canDraw,
  canDiscard,
  isDraggingCard,
  isDragOverDiscard,
  discardRef,
  onDrawDeck,
  onDrawDiscard,
}: CenterAreaProps) {
  const showDropHint = canDiscard;
  const discardOutline = showDropHint
    ? isDragOverDiscard
      ? "outline-4 outline-solid outline-gold outline-offset-[6px]"
      : isDraggingCard
        ? "outline-4 outline-dashed outline-gold outline-offset-[6px]"
        : "outline-2 outline-dashed outline-gold/60 outline-offset-[6px]"
    : "";

  return (
    <div className="flex items-center justify-center gap-8 py-2">
      {/* Draw deck (3D stacked) */}
      <div className="flex flex-col items-center gap-2">
        <DeckStack
          deckCount={deckCount}
          canDraw={canDraw}
          onDrawDeck={onDrawDeck}
        />
        <div className="text-xs text-slate-300/80">
          {deckCount} left
        </div>
      </div>

      {/* Discard pile + drop target */}
      <div className="flex flex-col items-center gap-2">
        <motion.div
          ref={discardRef}
          data-testid="discard"
          whileHover={canDraw && discardTop ? { scale: 1.05 } : {}}
          whileTap={canDraw && discardTop ? { scale: 0.95 } : {}}
          onClick={() => canDraw && discardTop && onDrawDiscard()}
          animate={{ scale: isDragOverDiscard ? 1.1 : 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={`relative rounded-[12px] transition-[outline,outline-offset] duration-150 ${discardOutline} ${
            canDraw && discardTop ? "cursor-pointer" : ""
          }`}
        >
          {canDraw && discardTop && (
            <motion.div
              className="absolute -inset-1 rounded-[14px] ring-2 ring-gold pointer-events-none"
              animate={{ opacity: [0.35, 0.9, 0.35] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
          {discardTop ? (
            <Card card={discardTop} size="lg" />
          ) : (
            <div className="w-[88px] h-[124px] rounded-[12px] border-2 border-dashed border-slate-600/70" />
          )}
        </motion.div>
        <div className="text-xs text-slate-300/80">
          {canDiscard && !isDraggingCard ? "Drop here" : "Discard"}
        </div>
      </div>
    </div>
  );
}

/* ── Internal: 3D-stacked draw deck ──────────────────────────────────── */

function DeckStack({
  deckCount,
  canDraw,
  onDrawDeck,
}: {
  deckCount: number;
  canDraw: boolean;
  onDrawDeck: () => void;
}) {
  if (deckCount === 0) {
    return (
      <div className="w-[88px] h-[124px] rounded-[12px] border-2 border-dashed border-slate-600/70" />
    );
  }

  // Number of "depth" layers (capped). Each adds a few px of offset for 3D feel.
  const layers = Math.min(deckCount, 3);

  return (
    <motion.div
      data-testid="deck"
      whileHover={canDraw ? { scale: 1.05 } : {}}
      whileTap={canDraw ? { scale: 0.95 } : {}}
      onClick={() => canDraw && onDrawDeck()}
      className={`relative ${canDraw ? "cursor-pointer" : ""}`}
      style={{ width: "88px", height: "124px" }}
    >
      {/* Stack: deeper layers behind, slightly offset down-right */}
      {Array.from({ length: layers }).map((_, i) => {
        const offset = (layers - i - 1) * 2.5; // 0, 2.5, 5px
        const isTop = i === layers - 1;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${offset}px`,
              top: `${offset}px`,
              zIndex: i,
              filter: isTop ? "none" : `brightness(${0.9 - (layers - i - 1) * 0.05})`,
            }}
          >
            <Card faceDown size="lg" />
          </div>
        );
      })}

      {/* Pulsing gold ring on the top card when drawable */}
      {canDraw && (
        <motion.div
          className="absolute -inset-1 rounded-[14px] ring-2 ring-gold pointer-events-none"
          style={{ zIndex: layers + 1 }}
          animate={{ opacity: [0.35, 0.9, 0.35] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
}
