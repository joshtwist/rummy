import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spade } from "lucide-react";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/game", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create game");
      const data = await res.json();
      navigate(`/${data.gameId}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        {/* Logo area */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-felt flex items-center justify-center shadow-lg">
            <Spade className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Rummy</h1>
          <p className="text-slate-400 text-center text-lg">
            No accounts. No installs. Just share a link and play.
          </p>
        </div>

        {/* Card table visual */}
        <div className="w-full rounded-2xl bg-felt/30 border border-felt-light/40 p-8 flex flex-col items-center gap-6">
          <div className="flex gap-3">
            {["♠", "♥", "♦", "♣"].map((suit) => (
              <div
                key={suit}
                className={`w-12 h-16 rounded-lg flex items-center justify-center text-2xl font-bold shadow-md ${
                  suit === "♥" || suit === "♦"
                    ? "bg-white text-card-red"
                    : "bg-white text-card-black"
                }`}
              >
                {suit}
              </div>
            ))}
          </div>

          <button
            data-testid="create-game-btn"
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-4 px-6 bg-gold hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-lg rounded-xl transition-colors duration-200 shadow-lg cursor-pointer"
          >
            {creating ? "Creating..." : "Create New Game"}
          </button>

          <p className="text-slate-500 text-sm text-center">
            2-4 players. Pick 7 or 10 card mode.
          </p>
        </div>
      </div>
    </div>
  );
}
