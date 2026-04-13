# Rummy

Multiplayer Rummy card game. Real-time, 2–4 players, runs entirely on
Cloudflare Workers + Durable Objects.

## Stack

- **Frontend** — React 19, Vite, Tailwind CSS, Framer Motion
- **Backend** — Cloudflare Workers with a `GameRoom` Durable Object per
  game (holds state, brokers WebSockets, uses the Hibernation API so
  idle games cost nothing)
- **Transport** — WebSockets for game state; HTTP only for the initial
  asset load
- **Tests** — Playwright (desktop Chrome + iPhone viewport)

One Worker serves both the SPA (via the `[assets]` binding) and the
game API. No separate frontend host.

## How the game works

- **Modes** — 7-card (fast) or 10-card (classic). First player to
  arrange their entire hand into valid Rummy melds and discard one card
  wins.
- **Melds** — Sets (3–4 same rank, different suits) or runs (3+
  consecutive same suit, Aces low). Win detection does a backtracking
  partition so overlapping meld options don't trip it up.
- **State machine** — `lobby → dealing → playing → complete`. A
  completed game becomes a pointer to the rematch lobby: the winner
  clicks "Create New Game" and other players see a "Join X's New Game"
  button at their leisure.

## Local development

```bash
pnpm install
pnpm start     # runs Vite (:5173) + wrangler dev (:8787) concurrently
```

Open `http://localhost:5173`. Vite proxies `/api/*` and WebSocket
upgrades to the Worker on 8787, mirroring the production routing.

### Dev env vars

Put dev-only variables in `.dev.vars` (gitignored, loaded by
`wrangler dev`, never deployed). The project uses one:

```
TEST_HOOKS=1
```

This gates a server-side `_test_force_hand` WebSocket message that the
Playwright suite uses to deal a known winning hand. With `TEST_HOOKS`
unset (i.e. production), the hook is inert.

### Useful scripts

| Command              | What it does                                              |
|----------------------|-----------------------------------------------------------|
| `pnpm start`         | Vite + wrangler dev in parallel                           |
| `pnpm dev`           | Vite only                                                 |
| `pnpm dev:worker`    | `wrangler dev` only                                       |
| `pnpm build`         | Build the SPA into `dist/`                                |
| `pnpm typecheck`     | TypeScript check for both client and Worker configs       |
| `pnpm types`         | Regenerate `worker-configuration.d.ts` from `wrangler.toml` |
| `pnpm test`          | Playwright end-to-end suite                               |
| `pnpm test:ui`       | Playwright interactive UI                                 |
| `pnpm deploy`        | `pnpm build && wrangler deploy`                           |

After cloning, run `pnpm types` once to regenerate the Worker types
file that's gitignored.

## Tests

```bash
pnpm test
```

Covers the full game loop end-to-end: create room, join, start, draw,
discard, reconnect under WebSocket drops, force a winning hand, see
the GameComplete screen on both clients, create a rematch, join it
from the other client.

Two Playwright projects run the same specs: one desktop viewport, one
iPhone 14 Pro viewport with touch events and a mobile UA — the game is
phone-first, so mobile layout + touch drag are first-class in CI.

## Deployment (Cloudflare Workers)

One command does everything:

```bash
pnpm deploy
```

That builds the SPA, uploads the Worker + static assets, and runs the
Durable Object migration declared in `wrangler.toml`. First deploy
gives you a free `*.workers.dev` URL. A custom domain can be attached
in the Cloudflare dashboard afterwards.

First-time setup:

```bash
pnpm wrangler login
```

## Project layout

```
src/
  client/              React SPA
    components/        Game UI (PlayerHand, GameComplete, etc.)
    hooks/             useWebSocket
    lib/               icons, haptics, storage, celebrations
  server/
    index.ts           Worker entry — routes /api/* to the DO
    game-room.ts       GameRoom DO (state + WS broker)
    game-engine.ts     Pure game state reducers
    deck.ts            Deck, shuffle, deal, scoring
    melds.ts           Set/run detection + hand partition
  shared/              Types + wire protocol shared by client & server

e2e/                   Playwright specs and helpers
wrangler.toml          Worker + DO + assets binding
```

Server state is pure: `game-engine.ts` exports reducer-shaped functions
(`addPlayer`, `drawCard`, `discardCard`, ...) that take a `GameState`
and return the next one. The DO owns the only mutable instance and
handles WebSockets + persistence. This makes the engine trivially
unit-testable and keeps WS/storage plumbing out of the game rules.
