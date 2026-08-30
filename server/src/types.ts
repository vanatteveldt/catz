export const WILDCARD_COLOR = '*'
export const SPECIAL_BONUS = 'S'

export type Card = {
  id: string
  color: string // e.g. 'y' | 'w' | 'r' | 'g' | '*' (wildcard, matches any color)
  number: number // 1-9
  bonus: number | typeof SPECIAL_BONUS // -6..+6, or 'S' (special: see scoring)
}

export type PlacedCard = {
  card: Card
  faceUp: boolean
}

export type GridSlot = {
  bottom: PlacedCard | null
  top: PlacedCard | null
}

export type PlayerIndex = 0 | 1

export type PlayerState = {
  grid: GridSlot[] // length 9; index i = space number i + 1
}

export type GameStatus = 'waiting' | 'active' | 'final-turn' | 'finished'

export type GameState = {
  deck: Card[]
  market: Card[]
  players: [PlayerState, PlayerState]
  turn: PlayerIndex
  roundStarter: PlayerIndex
  status: GameStatus
  finalTurnPlayer: PlayerIndex | null
  matchRound: number // 1, 2, or 3 — which round of the 3-round match this is
  cumulativeScore: [number, number] // totals from previously-completed rounds (not including the current one)
  lastMover: PlayerIndex | null // whoever made the most recent move; starts the next round once this one finishes
}

export type Move = {
  cardId: string
  targetSpace?: number // 1-9, required only when the card's own space is already full
  // When placing into a space that already holds one face-up card, the player
  // chooses whether the new card goes on top (default, false) or below (true,
  // keeping the existing card visible). Ignored/forced-false if the existing
  // card is face-down — you can't choose to bury a card under an unknown one.
  stackBelow?: boolean
}
