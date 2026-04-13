# Rummy - Multiplayer Card Game

## Overview

A real-time multiplayer card game built on Cloudflare's edge platform. No accounts, no installs - just share a link and play. Designed mobile-first for one-handed (thumb) use.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend framework | React 19 + Vite | Fast builds, great DX, component model suits card game UI |
| Styling | Tailwind CSS v4 | Mobile-first utilities, no CSS files to manage |
| Icons | Lucide React | Clean icon set for player avatars and UI chrome |
| Animations | Framer Motion | Card dealing, flipping, sliding animations |
| Backend | Cloudflare Workers | Edge-deployed, low latency globally |
| Game state | Durable Objects | Single-instance per game, consistent state, WebSocket support |
| WebSockets | DO Hibernation API | Connections survive idle periods without burning CPU/cost |
| Hosting | Cloudflare Pages | Serves static frontend + Workers functions |
| Build/deploy | Wrangler | Cloudflare's CLI for Workers/Pages/DO |

### Why these choices

- **React + Vite over Next.js/Remix**: We don't need SSR or file-based routing. The app is a single-page game client that talks to a WebSocket. Vite gives us fast HMR and a simple build.
- **Durable Objects over D1/KV**: Game state is mutable, transactional, and needs WebSocket fan-out. DO is purpose-built for this. Each game room is a single DO instance - no distributed state coordination needed.
- **WebSocket Hibernation API**: Critical for cost. Standard WebSocket handling keeps the DO alive (billed) for every idle connection. Hibernation lets the runtime evict the DO from memory between messages - we only pay when players actually do things.
- **Framer Motion**: Card games feel dead without animation. Framer Motion handles layout animations (cards moving between positions) and gesture support (drag-to-discard) with minimal code.

---

## Architecture

```
Browser (React SPA)
  │
  ├─ HTTPS GET /api/game/create  →  Worker  →  creates DO, returns gameId
  ├─ HTTPS GET /api/game/:id     →  Worker  →  forwards to DO, returns game state
  │
  └─ WebSocket /api/game/:id/ws  →  Worker  →  forwards to DO
                                                    │
                                              Durable Object
                                              (one per game)
                                                    │
                                              ┌─────┴─────┐
                                              │ Game State │
                                              │ - phase    │
                                              │ - players  │
                                              │ - deck     │
                                              │ - hands    │
                                              │ - discard  │
                                              │ - turn     │
                                              └───────────┘
```

### Request flow

1. **Create game**: `POST /api/game` → Worker generates a short game ID (e.g., `abc123`), creates a Durable Object stub by ID, calls `initialize()` on it, returns `{ gameId }`.
2. **Join game**: Player opens `/{gameId}`. React app checks `localStorage` for a saved player ID for this game. If none, shows join form (name + icon picker). Submits join via WebSocket message.
3. **WebSocket lifecycle**: All game interaction happens over a single WebSocket per player. The DO maintains a `Map<playerId, WebSocket>` for fan-out. On reconnect, the player sends their stored `playerId` and the DO re-associates the socket.

### Durable Object design

```
GameRoom DO {
  state: {
    phase: "lobby" | "dealing" | "playing" | "complete",
    mode: 7 | 10,                           // cards per player
    players: Player[],                       // name, icon, playerId stored here
    deck: Card[],
    discardPile: Card[],
    hands: Map<playerId, Card[]>,
    currentPlayerIndex: number,
    turnPhase: "draw" | "discard",
    creatorId: string,
    scores: Map<playerId, number>,
    celebrationGifIndex: number,             // random 0-19, picked at game end
  }

  // WebSocket hibernation handlers
  webSocketMessage(ws, message)
  webSocketClose(ws)
  webSocketError(ws)

  // HTTP handlers (for initial load / non-WS clients)
  fetch(request)
}
```

---

## Identity & Session

### No accounts - UUID-based identity

- When a player joins a game, the client generates a UUID v4 (`playerId`).
- This `playerId` is stored in `localStorage` under the key `rummy:game:{gameId}:playerId`.
- A player can be in **multiple games simultaneously** - each game URL has its own independent `playerId` in localStorage.
- On every WebSocket connection or HTTP request, the client sends `playerId` to identify itself.
- The server trusts this ID (no spoofing concerns for a casual card game among friends).

### Player name and icon are per-game

- Name and icon are chosen on the join form for each game, not stored globally.
- They are stored **server-side** in the DO state, associated with the `playerId`.
- The client does NOT store name/icon in localStorage - only the `playerId`.
- On reconnect, the server already knows the player's name and icon from its state.
- This means the same person can be "Josh (Cat)" in one game and "J (Rocket)" in another.

### localStorage schema

```
rummy:game:{gameId}:playerId = "uuid-v4-string"
```

That's it. One key per game. Nothing else in the browser.

### Reconnection flow

1. Player closes browser or loses connection.
2. Player returns to the same URL `/{gameId}`.
3. Client finds `playerId` in `localStorage` for this game ID.
4. Client opens WebSocket, sends `{ type: "reconnect", playerId: "xxx" }`.
5. DO looks up player in its state, re-associates the new WebSocket.
6. DO sends full game state (including the player's name, icon, hand) to the reconnected player.
7. If it was their turn, they resume exactly where they left off.

### What if localStorage is cleared?

- Player arrives at `/{gameId}` with no stored ID.
- They see the join form again. They can re-enter their name.
- They get a new `playerId` and join as a new player (they cannot reclaim their old hand).
- For a casual game among friends, this is acceptable. The game continues.

---

## URL & Routing

| Route | What it does |
|-------|-------------|
| `/` | Homepage. "Create New Game" button. |
| `/:gameId` | Game room. Shows lobby, game, or results depending on phase. |

Game IDs are short, URL-safe strings (6-8 chars, lowercase alphanumeric). Example: `https://rummy.example.com/k7m2x9`

### Sharing

- The creator sees a "Share" button in the lobby.
- On Safari/iOS, this uses the Web Share API (`navigator.share()`).
- Fallback: copy-to-clipboard button.
- Share payload: `{ title: "Join my Rummy game!", url: "https://rummy.example.com/k7m2x9" }`

---

## Game State Machine

```
                    ┌──────────┐
         create     │  LOBBY   │  Players join via WebSocket
        game ──────►│          │  Creator sees live join list
                    └────┬─────┘
                         │ creator clicks "Start Game"
                         │ (requires 2+ players)
                         ▼
                    ┌──────────┐
                    │ DEALING  │  Server shuffles deck,
                    │          │  deals 7 or 10 cards each,
                    │          │  flips top card to discard
                    └────┬─────┘
                         │ (animated ~2-3s deal)
                         ▼
              ┌─────────────────────┐
              │      PLAYING        │
              │                     │
              │  ┌───────────────┐  │
              │  │  DRAW_PHASE   │◄─┼──── turn starts here
              │  │               │  │     active player must draw
              │  │ draw from:    │  │     a card from deck or
              │  │ - discard top │  │     discard pile
              │  │ - deck top    │  │
              │  └───────┬───────┘  │
              │          │          │
              │          ▼          │
              │  ┌───────────────┐  │
              │  │ DISCARD_PHASE │  │     active player must
              │  │               │  │     discard one card from
              │  │ choose card   │  │     their hand
              │  │ to discard    │  │
              │  └───────┬───────┘  │
              │          │          │
              │          ▼          │
              │    next player's    │
              │    turn (loop)      │
              └─────────┬───────────┘
                        │ win condition met
                        ▼
                   ┌──────────┐
                   │ COMPLETE │  Show winner + celebration
                   │          │  Show scores
                   │          │  "Play Again" button
                   └──────────┘
                        │ play again
                        ▼
                   new DO instance
                   same players redirected
```

### Phase details

**LOBBY**
- Creator auto-joins on game creation.
- Other players join by opening the URL and submitting the join form.
- The creator sees all joined players in real-time (WebSocket push).
- All players see the player list and can see when new people join.
- Creator has a "Start Game" button, only enabled when 2+ players present.
- Max players: 4. With 10-card mode that's 40 dealt + 1 discard = 11 remaining in deck. With 7-card mode that's 28 dealt + 1 discard = 23 remaining. Plenty of room either way.

**DEALING**
- **Animated phase** - the deal is visible to all players.
- Server shuffles the 52-card deck using Fisher-Yates.
- Deals 7 or 10 cards to each player (based on game mode chosen at creation).
- Flips the top remaining card onto the discard pile.
- Remaining cards form the draw deck (face down).
- Server sends a `dealing` event. The client animates cards flying from the deck to each player's position, one at a time in round-robin order (like a real dealer). Cards land face-down for other players, face-up for you.
- Animation takes ~2-3 seconds (configurable). After animation completes, client transitions to PLAYING view.
- Players watch their hand "fill up" card by card - a satisfying moment.

**PLAYING - DRAW_PHASE**
- The active player sees two tap targets:
  - The face-up discard pile top card (they can see what they're getting).
  - The face-down deck (a gamble - they don't know what's on top).
- All other players see: "Waiting for {name} to draw..."
- All players can always see: their own cards (7 or 10), the discard pile top, card counts of other players.
- The active player taps one to draw. Server validates it's their turn, adds the card to their hand (now 8 or 11 cards).
- Transitions to DISCARD_PHASE.
- **Haptic feedback**: When it becomes your turn, the device vibrates briefly (`navigator.vibrate(200)`) to alert you.

**PLAYING - DISCARD_PHASE**
- The active player now has N+1 cards. They must discard one.
- They tap a card in their hand to discard it.
- Server removes the card from their hand (back to N), places it on the discard pile.
- Turn advances to the next player. Transitions back to DRAW_PHASE.
- All players receive updated state.

**COMPLETE**
- Win condition is met (to be defined - likely a valid Rummy hand declared).
- All players see the winner's name in a celebration overlay with a random GIF from the curated set (20 embedded Giphy URLs, randomly selected per game).
- Scores are displayed for all players in a ranked list.
- A "Play Again" button is shown. When clicked:
  - Server creates a new DO instance with the same game mode (7 or 10 cards).
  - All connected players are sent a redirect message with the new game URL.
  - Same players, fresh game - they auto-join with their existing names/icons.

---

## Game Modes

The creator selects the game mode when starting the game from the lobby:

| Mode | Cards per player | Deck remaining (4 players) | Deck remaining (2 players) |
|------|-----------------|---------------------------|---------------------------|
| **7-card** | 7 | 23 | 37 |
| **10-card** | 10 | 11 | 31 |

The mode is stored in the DO state and affects dealing, hand size validation, and UI layout.

---

## Card Model

### Standard 52-card deck

```typescript
type Suit = "hearts" | "diamonds" | "clubs" | "spades";
type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

interface Card {
  suit: Suit;
  rank: Rank;
}
```

### Card values

- **Ace = 1** (always low)
- **2-10 = face value**
- **J, Q, K = 10**

### Card rendering

- Cards are rendered as styled divs (not images) for fast loading and easy theming.
- Suit symbols: Hearts, Diamonds, Clubs, Spades (Unicode characters).
- Color: Red for hearts/diamonds, black (dark) for clubs/spades.
- Cards in the player's hand are arranged in a fan/arc at the bottom of the screen for thumb reach.

### Card reordering

- Players can **drag to reorder** cards in their own hand at any time (not just on their turn).
- This is a client-side only operation - the server doesn't care about card order in a player's hand.
- Implemented via Framer Motion's `Reorder` component for smooth drag-and-drop.
- Helps players organize by suit, rank, or whatever grouping they prefer.
- On mobile, uses long-press + drag gesture to distinguish from tap-to-select.

### Shuffling

- Fisher-Yates shuffle, server-side only.
- The client never sees the deck order. It only receives cards as they are dealt or drawn.

---

## WebSocket Protocol

All messages are JSON. Every message has a `type` field.

### Client → Server

```jsonc
// Join the game (new player)
{ "type": "join", "name": "Josh", "icon": "cat" }

// Reconnect (returning player)
{ "type": "reconnect", "playerId": "uuid-xxx" }

// Start the game (creator only, includes mode selection)
{ "type": "start_game", "mode": 7 | 10 }

// Draw a card
{ "type": "draw", "source": "deck" | "discard" }

// Discard a card
{ "type": "discard", "card": { "suit": "hearts", "rank": "7" } }

// Request play-again
{ "type": "play_again" }

// Heartbeat (keep-alive for hibernation)
{ "type": "ping" }
```

### Server → Client

```jsonc
// Full state sync (sent on connect, reconnect, and after every action)
{
  "type": "state",
  "phase": "lobby" | "dealing" | "playing" | "complete",
  "mode": 7 | 10,
  "turnPhase": "draw" | "discard",
  "you": {
    "playerId": "uuid-xxx",
    "name": "Josh",
    "icon": "cat",
    "hand": [{ "suit": "hearts", "rank": "7" }, ...],
    "isCreator": true
  },
  "players": [
    { "playerId": "uuid-yyy", "name": "Alex", "icon": "dog", "cardCount": 10, "connected": true },
    ...
  ],
  "currentPlayerId": "uuid-xxx",
  "discardTop": { "suit": "spades", "rank": "K" },
  "deckCount": 22,
  "scores": null
}

// Dealing event (triggers client-side deal animation)
{
  "type": "dealing",
  "mode": 7 | 10,
  "playerOrder": ["uuid-xxx", "uuid-yyy", ...],
  "hand": [{ "suit": "hearts", "rank": "7" }, ...],
  "discardTop": { "suit": "spades", "rank": "K" },
  "deckCount": 22
}

// Error (invalid action)
{ "type": "error", "message": "It's not your turn" }

// Player joined (lobby)
{ "type": "player_joined", "player": { "playerId": "...", "name": "...", "icon": "..." } }

// Player reconnected
{ "type": "player_reconnected", "playerId": "..." }

// Player disconnected
{ "type": "player_disconnected", "playerId": "..." }

// Game over
{
  "type": "game_complete",
  "winnerId": "uuid-xxx",
  "winnerName": "Josh",
  "scores": [
    { "playerId": "uuid-xxx", "name": "Josh", "icon": "cat", "score": 0 },
    { "playerId": "uuid-yyy", "name": "Alex", "icon": "dog", "score": 45 }
  ],
  "celebrationGif": "https://i.giphy.com/media/pa37AAGzKXoek/giphy.gif"
}

// Redirect to new game
{ "type": "redirect", "gameId": "new-game-id" }

// Pong
{ "type": "pong" }
```

### Key principle: server pushes full "view" state

After every action, the server broadcasts a personalized `state` message to each connected player. Each player's message contains:
- Their own full hand (they can see their cards).
- Other players' card counts only (not their cards).
- The discard pile top card.
- The draw deck count.
- Whose turn it is and what phase.

This means the client is a **pure renderer**. It receives JSON, renders UI. No client-side game logic beyond "send intent, render response."

---

## UI Design

### Layout (mobile-first, portrait orientation)

```
┌─────────────────────────┐
│  Header: Game info       │  ← game ID, player count, phase
├─────────────────────────┤
│                         │
│  Other players          │  ← avatars + card counts in a row
│  (top area)             │     along the top
│                         │
├─────────────────────────┤
│                         │
│  Center play area       │  ← discard pile (face up) + deck (face down)
│                         │     side by side, large tap targets
│                         │
├─────────────────────────┤
│                         │
│  Your hand              │  ← 7 or 10 cards in a fan/arc
│  (bottom, thumb zone)   │     scrollable horizontally
│                         │     tap to select, long-press+drag to reorder
│                         │
├─────────────────────────┤
│  Action bar             │  ← contextual: "Your turn - draw!" etc.
└─────────────────────────┘
```

### Touch targets

- All interactive elements minimum 48x48px (WCAG touch target).
- Cards in hand are large enough to read and tap individually.
- Draw/discard targets in center are oversized for easy thumb reach.
- The "thumb zone" (bottom 40% of screen) contains the primary interaction area.

### Player icons (Lucide)

A curated set of fun, recognizable icons for player avatars:

`Cat`, `Dog`, `Bird`, `Fish`, `Rabbit`, `Snail`, `Bug`, `Flame`, `Zap`, `Star`, `Moon`, `Sun`, `Heart`, `Skull`, `Ghost`, `Rocket`, `Crown`, `Gem`, `Anchor`, `Gamepad2`

Players pick one during join. Icons are shown as colored circles with the icon inside.

### Animations (Framer Motion)

- **Card deal**: Cards fly from deck to each player's position, one at a time in round-robin order. Your cards flip face-up as they land. Other players' cards stay face-down. Takes ~2-3 seconds for the full deal. Players watch their hand fill up.
- **Draw**: Card slides from deck/discard to hand with a slight arc.
- **Discard**: Tapped card lifts, slides to discard pile.
- **Card reorder**: Drag-and-drop within hand, cards slide apart to make room (Framer Motion `Reorder`).
- **Turn indicator**: Gentle pulse/glow on the active player's avatar.
- **Win celebration**: Winner's name displayed large, random celebration GIF, confetti particles.

### Haptic Feedback

Uses the Vibration API (`navigator.vibrate()`) for tactile feedback on mobile:

| Event | Pattern | Purpose |
|-------|---------|---------|
| Your turn starts | `vibrate(200)` | Alert: it's your turn |
| Card drawn | `vibrate(50)` | Confirm: action registered |
| Card discarded | `vibrate(50)` | Confirm: action registered |
| You win | `vibrate([100, 50, 100, 50, 200])` | Celebration pattern |
| Error (not your turn) | `vibrate([50, 30, 50])` | Rejection buzz |

Note: Vibration API requires user gesture to activate and is a no-op on desktop browsers. We call it best-effort with no fallback needed.

---

## Turn Timer (optional, future)

Not in v1, but worth noting: a configurable turn timer (e.g., 30s) could auto-pass if a player is AFK. For now, turns are untimed - the game waits indefinitely (suitable for casual play among friends).

---

## Scoring

- When a player declares/wins, remaining players' hands are scored.
- Cards in hand count against you:
  - **Ace = 1 point** (always low)
  - **2-10 = face value**
  - **J, Q, K = 10 points**
- Lower score is better. Winner has 0 (or lowest).

> **Note**: Specific win condition / declaration rules TBD - user to provide the Rummy variant details.

---

## Project Structure

```
rummy/
├── spec.md                    # This file
├── wrangler.toml              # Cloudflare Workers config
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── src/
│   ├── client/                # React frontend
│   │   ├── index.html
│   │   ├── main.tsx           # Entry point
│   │   ├── App.tsx            # Router (/ and /:gameId)
│   │   ├── components/
│   │   │   ├── HomePage.tsx       # Create game CTA
│   │   │   ├── Lobby.tsx          # Join form + player list
│   │   │   ├── GameBoard.tsx      # Main game UI
│   │   │   ├── PlayerHand.tsx     # Card fan at bottom
│   │   │   ├── CenterArea.tsx     # Deck + discard pile
│   │   │   ├── PlayerBar.tsx      # Other players' avatars
│   │   │   ├── Card.tsx           # Single card component
│   │   │   ├── IconPicker.tsx     # Avatar selection grid
│   │   │   ├── GameComplete.tsx   # Winner + scores + play again
│   │   │   └── ShareButton.tsx    # Web Share API / clipboard
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts    # WS connection + reconnect
│   │   │   └── useGameState.ts    # State from WS messages
│   │   ├── lib/
│   │   │   ├── types.ts           # Shared types (Card, Player, etc.)
│   │   │   └── storage.ts         # localStorage helpers
│   │   └── styles/
│   │       └── index.css          # Tailwind imports + card styles
│   │
│   └── server/                # Cloudflare Workers
│       ├── index.ts           # Worker entry - routes requests
│       ├── game-room.ts       # Durable Object class
│       ├── game-engine.ts     # Pure game logic (shuffle, validate, score)
│       └── types.ts           # Server-side types
│
├── public/
│   └── favicon.ico
└── README.md
```

---

## Celebration GIFs

20 curated GIFs embedded directly in the app (no API key needed). One is randomly selected per game completion.

```typescript
const CELEBRATION_GIFS = [
  "https://i.giphy.com/media/KEVNWkmWm6dm8/giphy.gif",           // Fist pump
  "https://i.giphy.com/media/3kD720zFVu22rfIA0s/giphy.gif",      // Winner winner
  "https://i.giphy.com/media/dtxA3U6yLPRW569tCu/giphy.gif",      // We did it
  "https://i.giphy.com/media/o75ajIFH0QnQC3nCeD/giphy.gif",      // The Office celebration
  "https://i.giphy.com/media/RPwrO4b46mOdy/giphy.gif",           // Mr. Robot celebrate
  "https://i.giphy.com/media/yoJC2JaiEMoxIhQhY4/giphy.gif",      // Rocky I did it
  "https://i.giphy.com/media/lZTvTGEGKU6gnQ2wBr/giphy.gif",      // You win first place
  "https://i.giphy.com/media/S2jPUl8fNnydeNZD0g/giphy.gif",      // Well done
  "https://i.giphy.com/media/hzqkBHPKL3z07ORokF/giphy.gif",      // Winner win
  "https://i.giphy.com/media/lMameLIF8voLu8HxWV/giphy.gif",      // Confetti celebration
  "https://i.giphy.com/media/K3RxMSrERT8iI/giphy.gif",           // Big Bang Theory winning
  "https://i.giphy.com/media/lnlAifQdenMxW/giphy.gif",           // Champions
  "https://i.giphy.com/media/BylKa7s0D8BTMnBaSH/giphy.gif",      // Victory dance
  "https://i.giphy.com/media/d7fKljD4WRftoHF031/giphy.gif",      // Happy go crazy
  "https://i.giphy.com/media/fUQ4rhUZJYiQsas6WD/giphy.gif",      // Elmo happy dance
  "https://i.giphy.com/media/pa37AAGzKXoek/giphy.gif",           // Carlton dance
  "https://i.giphy.com/media/9wcu6Tr1ecmxa/giphy.gif",           // Chandler dancing
  "https://i.giphy.com/media/15BuyagtKucHm/giphy.gif",           // Bryan Cranston mic drop
  "https://i.giphy.com/media/TcKmUDTdICRwY/giphy.gif",           // Excited dancing
  "https://i.giphy.com/media/3oFzm6XsCKxVRbZDLq/giphy.gif",      // Happy celebration
];
```

The server picks the GIF index at game completion and includes it in the `game_complete` message so all players see the same GIF.

---

## Deployment

### Cloudflare Pages + Workers

- `wrangler.toml` defines the DO binding and Pages configuration.
- Vite builds the React app to `dist/`.
- Pages serves the static assets.
- Worker handles `/api/*` routes and WebSocket upgrades.
- Durable Object binding: `GAME_ROOM` → `GameRoom` class.

### Environment

- No secrets needed. No auth, no external API keys.
- Celebration GIFs are static URLs embedded in the client bundle.

---

## Edge Cases & Reliability

| Scenario | Handling |
|----------|---------|
| Player disconnects mid-turn | Their turn persists. On reconnect, they resume. Other players see "disconnected" badge. |
| Player disconnects and never returns | Game stalls on their turn. Future: auto-skip after timeout. v1: creator can kick. |
| All players disconnect | DO hibernates. State persists in storage. Anyone reconnecting revives the game. |
| Deck runs out | Reshuffle discard pile (minus top card) into deck. |
| Browser cleared localStorage | Player must re-join as new player. Old "ghost" player remains in game. |
| Creator disconnects | Game continues. Any player can see the game state. Creator role only matters for starting the game. |
| Two players try to act simultaneously | DO processes messages sequentially (single-threaded). Second action will be validated against updated state and rejected if invalid. |

---

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| Max players | 4 |
| Card modes | 7-card and 10-card (creator chooses) |
| Ace value | Always low (1 point) |
| Celebration GIFs | 20 static Giphy URLs embedded in app |
| Haptic feedback | Yes - Vibration API on turn start, actions, win |
| Deal animation | Yes - animated round-robin deal, cards fan out |
| Card reordering | Yes - drag to reorder within own hand |
| Player identity | Per-game UUID in localStorage, name/icon stored server-side |
| Multiple games | Supported - each game URL has independent player ID |

## Open Questions

1. **Specific Rummy variant and win condition** - User to provide.
2. **Turn timeout** - v1 untimed, but architecture supports it.
3. **Sound effects** - Worth adding beyond haptics?

---

## Implementation Plan

### Phase 1: Infrastructure
- Project scaffolding (Vite + React + Tailwind + Wrangler)
- Durable Object skeleton with WebSocket hibernation
- Basic Worker routing

### Phase 2: Lobby
- Homepage with create game
- Join form with icon picker
- WebSocket connection + player list
- Share button
- Creator start game button

### Phase 3: Game Engine
- Card model + deck shuffling
- Deal logic
- Turn management (draw + discard cycle)
- State broadcasting
- Full server-side validation

### Phase 4: Game UI
- Card rendering components
- Player hand (fan layout)
- Center area (deck + discard)
- Player bar (opponents)
- Turn indicators + action prompts
- Animations (Framer Motion)

### Phase 5: Game Complete
- Win detection + scoring
- Results screen
- Celebration animation
- Play again flow

### Phase 6: Polish
- Reconnection handling
- Error states
- Loading states
- Haptic feedback
- Edge case handling
