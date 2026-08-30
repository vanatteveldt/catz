# Card Game — Design Notes

## Getting started
```
npm install       # installs both server and client workspaces
npm run dev        # runs server (tsx, hot reload) + client (Vite) together
```
Client dev server proxies `/api` to the server (see `client/vite.config.ts` / `server/src/index.ts` for ports — bumped off the 3001/5173 defaults on this machine to avoid clashing with another local project). Open the client URL, "Start new game," then open the invite link in a second tab/device to join.

## Part 1: Process & Architecture

### Stack
- **Server:** Node + TypeScript, lightweight HTTP framework (Express or Fastify), simple REST API
- **Client:** TypeScript + Vite, mobile-first responsive CSS
- **DB:** SQLite, via Node's built-in `node:sqlite` (`DatabaseSync`) — no native module to compile. (Originally planned `better-sqlite3`, but its native bindings don't build against this machine's Node 26; the built-in module needs Node ≥22.5 and has no such issue.)
- **Rationale:** single process, no external infra to run/deploy, file-based DB is plenty for low/medium traffic turn-based play (at most one writer per game at a time)

### Game lifecycle
1. Player A opens app → "New Game" → server creates a game row (`token`, empty/initial `state`, `created_at`), returns an invite link `https://.../game/<token>`
2. Player A is assigned "player 1" and given a **player secret** (random token), stored in the client's localStorage
3. Player A shares the invite link (link contains only the game `token`, not any secret)
4. Player B opens the link, calls join → server assigns "player 2" if that slot is free, returns a player secret for B
5. Game becomes `active` once both players have joined
6. Players alternate turns; a move is: client sends `{playerSecret, move}` → server checks it's that player's turn, validates + applies the move, advances turn
7. Game ends on a win/end condition → status `finished`, final state + score retained

### Player identity / session
- No accounts. Anonymous per-game identity via a random **player secret** minted on create/join, stored in the browser's localStorage under the game token
- Every move/state request is authorized by that secret
- Revisiting the invite link on the same device/browser resumes play (secret still in localStorage); losing localStorage (new device, cleared storage) means losing the ability to act as that player — acceptable limitation for v1

### Real-time updates
**Decision: polling.** Client polls `GET /state` every ~2s while waiting on opponent. Trivial to implement, no connection-lifecycle handling, works fine through mobile backgrounding/flaky connections. Can revisit SSE/WebSocket later if the lag feels bad.

### API sketch
- `POST /api/games` → create game → `{ token, playerSecret }`
- `POST /api/games/:token/join` → join as player 2 → `{ playerSecret }`
- `GET /api/games/:token/state?as=<playerSecret>` → current state, from that player's point of view (hides opponent's hidden info, if any)
- `POST /api/games/:token/move` → `{ secret, cardId, targetSpace?, stackBelow? }` → validates turn + move, applies it. `targetSpace` is only needed when the card's own space is full (forced face-down elsewhere); `stackBelow` is only consulted when stacking a 2nd card onto an existing face-up one.

### DB schema sketch
```
games (
  token         TEXT PRIMARY KEY,
  player1_secret TEXT,
  player2_secret TEXT NULL,
  state         TEXT,   -- JSON blob
  turn          INTEGER, -- 1 | 2
  status        TEXT,    -- 'waiting' | 'active' | 'finished'
  created_at    TEXT,
  updated_at    TEXT
)
```

### Mobile
- Responsive layout (flexbox/grid), touch targets ≥44px, correct viewport meta tag
- Test with mobile device emulation during dev
- No native app needed; PWA (installable, offline shell) is a nice-to-have, not required for v1

### Decisions
- Real-time sync: **polling** (see above)
- Client: **vanilla TypeScript + DOM**, no framework

### Open questions
- Multi-device / lost-localStorage recovery — in scope for v1 or deferred?

---

## Part 2: Gameplay

### Components
- **Deck:** 70 real cards, loaded from [server/src/data/cards.csv](server/src/data/cards.csv) (`color,value,bonus` columns). 4 real colors (`y` yellow, `w` white, `r` red, `g` green, 16 cards each) plus 6 **wildcard** cards (`*`). If that file is ever missing, the server falls back to a placeholder deck (2× each color/number, no bonuses) so the app still runs.
- **Bonus** is either an integer **-6..+6**, or the string **`S`** ("special" — see scoring below).
- **Wildcard** (`*`) cards: for color-group adjacency, count as matching any color; for an `S` card's count, a visible wildcard counts as matching that `S` card's color too.
- **Grid:** 3×3 board. Each of the 9 positions corresponds 1:1 to a card number (1-9). Each position can hold up to **2 stacked cards**.
- Grid layout is assumed **row-major** (1 2 3 / 4 5 6 / 7 8 9) for adjacency purposes — ⚠️ not yet confirmed against the physical board; see `GRID_LAYOUT` in [server/src/game.ts](server/src/game.ts).

### Round structure
1. Deal 4 cards face up into the "market."
2. Players alternate picking one card from the market and placing it on their own grid, until all 4 are picked (2 picks each, starting player alternates by rule below).
3. Whoever places the 4th (last) card of the round starts the picking order for the next round.
4. Repeat with a fresh deal of 4 — until the game-end condition triggers (see below).

### Placement rules
- A picked card is always placed on the grid space matching its printed number if possible:
  - If that space is **empty**, the card goes there face up (unless it was forced there face-down — see below).
  - If that space has **exactly 1 card already**: the new card is placed face up, and the player chooses whether it goes **on top** (covering the existing card, the default) or **below** it (leaving the existing card visible on top instead). If the existing card is face-down, there's no choice — the new card automatically goes on top (you can't bury a card under an unknown one).
- If that space already has **2 cards** (full), the card instead must be placed **face down** on any currently-**empty** space of the player's choosing.
  - A face-down card can only go into an empty (0-card) space — never on top of an existing card.
  - Corollary: a face-down card can only ever be the covered/bottom card once a space fills up — it can never end up as the visible one.

### Game end
- The instant **every one of the 9 grid spaces has at least 1 card** ("occupied" — not necessarily full/2 cards), the game ends. This can happen with as few as 9 cards placed.
- **Fairness rule:** if the number of cards still face-up (undrawn) in the current market at that moment is **odd**, the *other* player gets exactly one final turn (pick one more card, place it) before scoring begins.
- Confirmed: the "drawn card has nowhere legal to go" edge case can't happen — the game-end trigger fires the moment the board reaches all-occupied, so that state is never reached mid-turn with a stranded card still to place.

### Scoring
Everything hinges on **visibility**: a space's visible card is whichever one is uncovered (on top, if there are two) **and** face-up. A face-down or covered card is invisible and scores **nothing at all** — not face value, not bonus, not color.
- A **lone face-up card** (alone in its space) scores its bonus/penalty and counts for color-group purposes, but **not** face value.
- A **lone face-down card** scores nothing.
- In a **2-card stack**, the visible (top) card scores face value **and** bonus/penalty **and** counts for color — the covered card underneath scores nothing, full stop, regardless of what it is.
- **Color groups:** find the largest group of **orthogonally**-adjacent grid spaces whose visible card shares the same color (wildcards can join any color's group). The single largest such group scores **N points per card**, where N is the color-group multiplier for the current match round (see below) — 2 in round 1, 3 in round 2, 4 in round 3.
- **`S` cards:** if a visible card's bonus is `S`, it scores **1 point per visible card of its own color** anywhere on that player's grid (including itself; wildcards count as matching every color, so they count toward every `S` card's total).
- **Total score** = Σ face value (2-card stacks only) + Σ bonus/penalty (visible cards only) + Σ `S`-card bonuses + color-group bonus.

### Match structure: 3 rounds
A full match is **3 rounds** of the game above, played back to back on the same invite link/token:
- Scores **accumulate** across rounds — each round's total is added to a running per-player cumulative score.
- The color-group multiplier increases each round: **×2** in round 1, **×3** in round 2, **×4** in round 3 (everything else about scoring/rules stays the same each round).
- Whoever made the **last move** of a round (i.e. the player who acted most recently when the round ended — either the player whose grid filled up, or the player who took the bonus final turn) **starts the next round**.
- After round 1 or 2 finishes, the score card offers **"Next round"**; after round 3, it offers **"New game"** instead, which starts an entirely fresh 3-round match (cumulative scores reset to 0) on the same token/link.

### Data model sketch (state JSON)
```ts
type Card = { id: string; color: string; number: number; bonus: number | 'S' }
type PlacedCard = { card: Card; faceUp: boolean }
type GridSlot = { bottom: PlacedCard | null; top: PlacedCard | null } // whichever is uncovered is "visible" (see Scoring)
type PlayerState = { grid: GridSlot[9] /* index 0-8 = space 1-9 */ }

type GameState = {
  deck: Card[]              // remaining, undealt
  market: Card[]             // up to 4 face-up cards currently pickable
  players: [PlayerState, PlayerState]
  turn: 0 | 1
  status: 'waiting' | 'active' | 'final-turn' | 'finished'
  finalTurnPlayer?: 0 | 1    // set when the odd-market-cards fairness rule kicks in
}
```
