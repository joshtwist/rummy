import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  animate,
  type PanInfo,
} from "framer-motion";
import type { RefObject } from "react";
import type { Card as CardType } from "../../shared/types.ts";
import { Card } from "./Card.tsx";

interface PlayerHandProps {
  hand: CardType[];
  canDiscard: boolean;
  onDiscard: (card: CardType) => void;
  discardRef: RefObject<HTMLElement | null>;
  onDraggingChange?: (card: CardType | null) => void;
  onDragOverDiscardChange?: (over: boolean) => void;
}

function cardKey(c: CardType): string {
  return `${c.suit}-${c.rank}`;
}

function cardsEqual(a: CardType, b: CardType): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/* ── Layout constants ───────────────────────────────────────────────── */

const CARD_WIDTH = 88;
const CARD_HEIGHT = 124;
const TARGET_ROW_PX = 358;
const MIN_STEP = 26;

function stepFor(count: number): number {
  if (count <= 1) return CARD_WIDTH;
  const ideal = (TARGET_ROW_PX - CARD_WIDTH) / (count - 1);
  return Math.min(CARD_WIDTH, Math.max(MIN_STEP, ideal));
}

function pointInRect(
  point: { x: number; y: number },
  el: HTMLElement | null,
): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return (
    point.x >= r.left &&
    point.x <= r.right &&
    point.y >= r.top &&
    point.y <= r.bottom
  );
}

/* ── HandCard: a single draggable card ──────────────────────────────── */

interface HandCardProps {
  card: CardType;
  idx: number;
  step: number;
  isDragging: boolean;
  onDragStart: (card: CardType) => void;
  onDrag: (card: CardType, info: PanInfo) => void;
  onDragEnd: (card: CardType, info: PanInfo) => void;
}

/**
 * Each card owns its own motion values (x, y, scale, opacity). The
 * parent decides WHICH slot the card is in via `idx`; this component
 * springs x to `idx * step` whenever that changes AND the card is not
 * being dragged. During drag, Framer writes into the same x motion
 * value; we leave the spring alone so drag wins. On release, the
 * spring reactivates and lands the card in its new slot.
 *
 * Scale is driven explicitly (not via `whileDrag`) because whileDrag
 * was not reverting reliably when `order` changed mid-drag: Framer's
 * gesture state got disrupted when React reconciled siblings and moved
 * DOM nodes, leaving the dragged card stuck at scale 1.12.
 */
function HandCard({
  card,
  idx,
  step,
  isDragging,
  onDragStart,
  onDrag,
  onDragEnd,
}: HandCardProps) {
  const x = useMotionValue(idx * step);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);

  // Spring x to its home whenever the slot changes and we're not dragging.
  useEffect(() => {
    if (isDragging) return;
    const controls = animate(x, idx * step, {
      type: "spring",
      stiffness: 520,
      damping: 38,
    });
    return () => controls.stop();
  }, [idx, step, isDragging, x]);

  // Spring y back to 0 on drag release (or any non-drag state).
  useEffect(() => {
    if (isDragging) return;
    const controls = animate(y, 0, {
      type: "spring",
      stiffness: 520,
      damping: 38,
    });
    return () => controls.stop();
  }, [isDragging, y]);

  // Scale up while dragged, scale back on release.
  useEffect(() => {
    const controls = animate(scale, isDragging ? 1.12 : 1, {
      duration: 0.12,
    });
    return () => controls.stop();
  }, [isDragging, scale]);

  return (
    <motion.div
      data-testid={`hand-card-${cardKey(card)}`}
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => onDragStart(card)}
      onDrag={(_, info) => onDrag(card, info)}
      onDragEnd={(_, info) => onDragEnd(card, info)}
      // Opacity is owned by Framer's initial/animate/exit system — NOT a
      // manual motion-value + useEffect(animate()) pattern. React Strict
      // Mode double-invokes effects, which was leaving the opacity
      // animation stopped mid-fade and cards stuck at opacity 0.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.18 } }}
      transition={{ opacity: { duration: 0.18 } }}
      style={{
        x,
        y,
        scale,
        position: "absolute",
        top: 0,
        left: 0,
        width: `${CARD_WIDTH}px`,
        height: `${CARD_HEIGHT}px`,
        zIndex: isDragging ? 100 : idx,
      }}
      className="touch-none cursor-grab active:cursor-grabbing"
    >
      <Card card={card} size="lg" />
    </motion.div>
  );
}

/* ── Component ──────────────────────────────────────────────────────── */

/**
 * Player's hand: a single horizontal fan of up to 11 overlapping cards.
 *
 * Architecture:
 * - Each card is ABSOLUTELY positioned; its visible slot is encoded in
 *   `idx` (its index in `order`). HandCard animates x → idx*step.
 * - We render in STABLE DOM ORDER (insertion order), not `order` order.
 *   This is load-bearing: if DOM order tracked `order`, React would
 *   move DOM nodes on every reorder, interrupting Framer's drag
 *   gesture and leaving `whileDrag`-style effects stuck (was the root
 *   cause of the "dragged card floats on top" bug in the last attempt).
 *   All visual positioning is transform-based; DOM order is irrelevant.
 * - Live reorder during drag uses pure arithmetic on pointer.x relative
 *   to the container (no per-frame sibling rect lookups).
 * - Drag is 2-axis (no axis constraint), so the user can drag up onto
 *   the discard pile. `onDragEnd` hit-tests `info.point` against
 *   `discardRef`.
 */
export function PlayerHand({
  hand,
  canDiscard,
  onDiscard,
  discardRef,
  onDraggingChange,
  onDragOverDiscardChange,
}: PlayerHandProps) {
  const [order, setOrder] = useState<CardType[]>(hand);
  const [pendingDiscard, setPendingDiscard] = useState<CardType | null>(null);
  const [draggingCard, setDraggingCard] = useState<CardType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTargetIdxRef = useRef<number | null>(null);
  // Stable DOM render order. New cards append; removed cards drop out.
  // Does NOT update on reorder-during-drag.
  const domOrderRef = useRef<CardType[]>([]);

  // Sync local order with server hand. Preserve manual reorder; append new
  // cards at the end; drop cards that are no longer in the hand. Skip
  // during an active drag so the dragged card's slot doesn't shift.
  useEffect(() => {
    if (draggingCard) return;
    setOrder((prev) => {
      const remaining = [...hand];
      const preserved: CardType[] = [];
      for (const card of prev) {
        const idx = remaining.findIndex((c) => cardsEqual(c, card));
        if (idx !== -1) {
          preserved.push(remaining[idx]);
          remaining.splice(idx, 1);
        }
      }
      return [...preserved, ...remaining];
    });
  }, [hand, draggingCard]);

  // Clear pending-discard once the server confirms removal.
  useEffect(() => {
    if (pendingDiscard && !hand.some((c) => cardsEqual(c, pendingDiscard))) {
      setPendingDiscard(null);
    }
  }, [hand, pendingDiscard]);

  const visible = order.filter(
    (c) => !pendingDiscard || !cardsEqual(c, pendingDiscard),
  );

  // Update the stable DOM render order: keep previous entries that are
  // still present (so DOM nodes don't move on reorder), add any new
  // cards at the end.
  {
    const prev = domOrderRef.current;
    const kept = prev.filter((c) =>
      visible.some((v) => cardsEqual(v, c)),
    );
    const seen = new Set(kept.map(cardKey));
    const additions = visible.filter((c) => !seen.has(cardKey(c)));
    domOrderRef.current = [...kept, ...additions];
  }
  const domOrder = domOrderRef.current;

  const step = stepFor(visible.length);
  const containerWidth =
    visible.length === 0 ? CARD_WIDTH : CARD_WIDTH + (visible.length - 1) * step;

  function handleDragStart(card: CardType) {
    setDraggingCard(card);
    lastTargetIdxRef.current = visible.findIndex((c) => cardsEqual(c, card));
    onDraggingChange?.(card);
  }

  function handleDrag(card: CardType, info: PanInfo) {
    if (canDiscard) {
      onDragOverDiscardChange?.(pointInRect(info.point, discardRef.current));
    }
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const relX = info.point.x - rect.left - CARD_WIDTH / 2;
    const rawIdx = Math.round(relX / step);
    const targetIdx = Math.max(0, Math.min(visible.length - 1, rawIdx));

    if (lastTargetIdxRef.current === targetIdx) return;
    lastTargetIdxRef.current = targetIdx;

    setOrder((prev) => {
      const fromIdx = prev.findIndex((c) => cardsEqual(c, card));
      if (fromIdx === -1 || fromIdx === targetIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }

  function handleDragEnd(card: CardType, info: PanInfo) {
    setDraggingCard(null);
    onDraggingChange?.(null);
    onDragOverDiscardChange?.(false);
    lastTargetIdxRef.current = null;
    if (canDiscard && pointInRect(info.point, discardRef.current)) {
      setPendingDiscard(card);
      onDiscard(card);
    }
  }

  return (
    <div
      className="w-full pt-3 pb-4 overflow-visible flex justify-center"
      data-testid="player-hand"
    >
      <div
        ref={containerRef}
        className="relative"
        style={{
          width: `${containerWidth}px`,
          height: `${CARD_HEIGHT}px`,
        }}
      >
        <AnimatePresence>
          {domOrder.map((card) => {
            const idx = visible.findIndex((c) => cardsEqual(c, card));
            if (idx === -1) return null;
            const key = cardKey(card);
            const isDragging =
              draggingCard != null && cardsEqual(card, draggingCard);
            return (
              <HandCard
                key={key}
                card={card}
                idx={idx}
                step={step}
                isDragging={isDragging}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
