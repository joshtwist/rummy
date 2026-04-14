import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import type { StateMessage, ClientMessage } from "../../shared/protocol.ts";
import type { Card as CardType } from "../../shared/types.ts";
import { vibrateAction } from "../lib/haptics.ts";
import { ICON_MAP, ICON_COLORS } from "../lib/icons.ts";
import { PlayerBar } from "./PlayerBar.tsx";
import { CenterArea } from "./CenterArea.tsx";
import { PlayerHand } from "./PlayerHand.tsx";

interface GameBoardProps {
  state: StateMessage;
  send: (msg: ClientMessage) => void;
}

/**
 * The main game screen on a felt-green table.
 *
 * Layout (top → bottom):
 *   1. Opponents bar
 *   2. "Your Turn" / "Waiting for ..." pill
 *   3. Centre area (deck + discard)
 *   4. Instruction line
 *   5. Your hand (drag any card; drop on discard during your turn)
 *   6. Footer: your avatar + card count + score
 *
 * The GameBoard owns the shared `discardRef` + drag state so PlayerHand and
 * CenterArea coordinate (the discard pile lights up while a card is being
 * dragged).
 */
export function GameBoard({ state, send }: GameBoardProps) {
  const { you, players, currentPlayerId, turnPhase, discardTop, deckCount } =
    state;

  const isMyTurn = currentPlayerId === you.playerId;
  const canDraw = isMyTurn && turnPhase === "draw";
  const canDiscard = isMyTurn && turnPhase === "discard";

  const activePlayer = players.find((p) => p.playerId === currentPlayerId);
  const activeName = activePlayer?.name ?? "";

  // Self colour index from the canonical players list (so opponent + footer agree)
  const selfIndex = players.findIndex((p) => p.playerId === you.playerId);
  const selfColor =
    ICON_COLORS[(selfIndex >= 0 ? selfIndex : 0) % ICON_COLORS.length];
  const SelfIcon = ICON_MAP[you.icon];

  // Shared drag state between hand + centre
  const discardRef = useRef<HTMLDivElement>(null);
  const [draggedCard, setDraggedCard] = useState<CardType | null>(null);
  const [dragOverDiscard, setDragOverDiscard] = useState(false);

  // Turn stopwatch: resets when the active player changes.
  const [turnSeconds, setTurnSeconds] = useState(0);
  useEffect(() => {
    setTurnSeconds(0);
    const id = setInterval(() => setTurnSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [currentPlayerId]);

  const turnTime = `${Math.floor(turnSeconds / 60)}:${String(turnSeconds % 60).padStart(2, "0")}`;

  // Haptic when own hand size changes (draw/discard confirm)
  const lastHandSizeRef = useRef(you.hand.length);
  useEffect(() => {
    if (you.hand.length !== lastHandSizeRef.current) {
      vibrateAction();
      lastHandSizeRef.current = you.hand.length;
    }
  }, [you.hand.length]);

  function handleDrawDeck() {
    if (canDraw) send({ type: "draw", source: "deck" });
  }

  function handleDrawDiscard() {
    if (canDraw) send({ type: "draw", source: "discard" });
  }

  function handleDiscard(card: CardType) {
    if (canDiscard) send({ type: "discard", card });
  }

  // Status pill text
  const statusText = isMyTurn ? "Your Turn" : `${activeName}'s turn`;

  // Instruction line (smaller, contextual)
  let instruction: string | null = null;
  if (isMyTurn && turnPhase === "draw") {
    instruction = "Draw from deck or pick up discard";
  } else if (isMyTurn && turnPhase === "discard") {
    instruction = "Drag a card to the discard pile";
  }

  return (
    <div
      className={`flex flex-1 flex-col min-h-0 transition-all duration-700 ${
        isMyTurn ? "bg-felt-active" : "bg-felt"
      }`}
      style={isMyTurn ? { boxShadow: "inset 0 0 80px rgba(245, 158, 11, 0.06)" } : undefined}
    >
      {/* 1. Opponents */}
      <div className="flex-shrink-0">
        <PlayerBar
          players={players}
          currentPlayerId={currentPlayerId}
          selfId={you.playerId}
          mode={state.mode}
        />
      </div>

      {/* 2. Status pill */}
      <div className="flex-shrink-0 flex justify-center pt-1 pb-2">
        <div
          data-testid="status-bar"
          className={`flex items-center gap-2 px-4 py-1 rounded-full text-sm font-semibold ${
            isMyTurn
              ? "bg-gold/15 text-gold border border-gold/40"
              : "bg-slate-800/40 text-slate-300"
          }`}
        >
          {statusText}
          <span className="flex items-center gap-1 text-xs font-normal opacity-70">
            <Timer className="w-3 h-3" />
            {turnTime}
          </span>
        </div>
      </div>

      {/* 3. Centre area (flex-1 swallows leftover space) */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <CenterArea
          discardRef={discardRef}
          discardTop={discardTop}
          deckCount={deckCount}
          canDraw={canDraw}
          canDiscard={canDiscard}
          isDraggingCard={draggedCard !== null}
          isDragOverDiscard={dragOverDiscard}
          onDrawDeck={handleDrawDeck}
          onDrawDiscard={handleDrawDiscard}
        />

        {/* 4. Instruction (always reserve a line so layout doesn't shift) */}
        <div className="h-5 mt-3 text-xs text-slate-400/90 text-center px-4">
          {instruction ?? ""}
        </div>
      </div>

      {/* 5. Your hand */}
      <div className="flex-shrink-0">
        <PlayerHand
          hand={you.hand}
          canDiscard={canDiscard}
          onDiscard={handleDiscard}
          discardRef={discardRef}
          onDraggingChange={setDraggedCard}
          onDragOverDiscardChange={setDragOverDiscard}
        />
      </div>

      {/* 6. Footer: self badge + score */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t border-white/5">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center ${selfColor}`}
          >
            <SelfIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-semibold text-white">You</div>
            <div className="text-[10px] text-slate-400">
              {you.hand.length} cards
            </div>
          </div>
        </div>
        <div className="text-xs px-3 py-1 rounded-full bg-slate-800/60 text-slate-300">
          Score: 0
        </div>
      </div>
    </div>
  );
}
