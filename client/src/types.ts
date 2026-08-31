export type Card = { id: string; color: string; number: number; bonus: number | 'S' }
export type PlacedCard = { card: Card; faceUp: boolean }
export type GridSlot = { bottom: PlacedCard | null; top: PlacedCard | null }
export type PlayerState = { grid: GridSlot[] }
export type GameStatus = 'waiting' | 'active' | 'final-turn' | 'finished'

export type GameState = {
  market: Card[]
  players: [PlayerState, PlayerState]
  turn: 0 | 1
  status: GameStatus
  finalTurnPlayer: 0 | 1 | null
  matchRound: number // 1, 2, or 3
  cumulativeScore: [number, number] // totals from previously-completed rounds
  seq: number // increments on every move or undo; lets the client detect changes across polls
  lastEvent: { type: 'move' | 'undo'; by: 0 | 1 } | null
}

export type Score = {
  faceTotal: number
  bonusTotal: number
  colorGroupSize: number
  colorGroupBonus: number
  total: number
}

export type StateResponse = {
  you: 0 | 1
  hasOpponent: boolean
  state: GameState
  scores: [Score, Score] | null
  canUndo: boolean
}
