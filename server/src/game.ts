import { buildDeck } from './cards.js'
import {
  SPECIAL_BONUS,
  WILDCARD_COLOR,
  type GameState,
  type Move,
  type PlacedCard,
  type PlayerIndex,
  type PlayerState,
} from './types.js'

const GRID_SIZE = 9
const MARKET_SIZE = 4

// Row-major 3x3 layout: space numbers 1-9, left-to-right, top-to-bottom.
// TODO: confirm this matches the physical board's actual layout (needed for
// correct orthogonal adjacency in color-group scoring) and adjust if not.
export const GRID_LAYOUT: number[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
]

function neighborsOf(space: number): number[] {
  let row = -1
  let col = -1
  for (let r = 0; r < 3; r++) {
    const c = GRID_LAYOUT[r].indexOf(space)
    if (c !== -1) {
      row = r
      col = c
      break
    }
  }
  const out: number[] = []
  if (row > 0) out.push(GRID_LAYOUT[row - 1][col])
  if (row < 2) out.push(GRID_LAYOUT[row + 1][col])
  if (col > 0) out.push(GRID_LAYOUT[row][col - 1])
  if (col < 2) out.push(GRID_LAYOUT[row][col + 1])
  return out
}

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function emptyPlayerState(): PlayerState {
  return { grid: Array.from({ length: GRID_SIZE }, () => ({ bottom: null, top: null })) }
}

function dealMarket(state: GameState) {
  const n = Math.min(MARKET_SIZE, state.deck.length)
  state.market = state.deck.splice(0, n)
}

export function createGame(): GameState {
  return {
    deck: shuffle(buildDeck()),
    market: [],
    players: [emptyPlayerState(), emptyPlayerState()],
    turn: 0,
    roundStarter: 0,
    status: 'waiting',
    finalTurnPlayer: null,
    matchRound: 1,
    cumulativeScore: [0, 0],
    lastMover: null,
    seq: 0,
    lastEvent: null,
  }
}

export function startGame(state: GameState) {
  state.status = 'active'
  dealMarket(state)
}

function isGridFull(playerState: PlayerState): boolean {
  return playerState.grid.every((slot) => slot.bottom !== null)
}

export type MoveError = { error: string }

export function applyMove(state: GameState, playerIdx: PlayerIndex, move: Move): MoveError | null {
  if (state.status === 'active' && state.turn !== playerIdx) {
    return { error: 'not your turn' }
  }
  if (state.status === 'final-turn' && state.finalTurnPlayer !== playerIdx) {
    return { error: 'not your turn' }
  }
  if (state.status !== 'active' && state.status !== 'final-turn') {
    return { error: 'game is not accepting moves' }
  }

  const marketIdx = state.market.findIndex((c) => c.id === move.cardId)
  if (marketIdx === -1) return { error: 'card not available' }
  const card = state.market[marketIdx]

  state.lastMover = playerIdx

  const grid = state.players[playerIdx].grid
  const ownSlot = grid[card.number - 1]

  if (ownSlot.bottom === null) {
    ownSlot.bottom = { card, faceUp: true }
  } else if (ownSlot.top === null) {
    const existing = ownSlot.bottom
    if (existing.faceUp && move.stackBelow) {
      // New card goes underneath; the existing (visible) card moves up.
      ownSlot.top = existing
      ownSlot.bottom = { card, faceUp: true }
    } else {
      ownSlot.top = { card, faceUp: true }
    }
  } else {
    if (!move.targetSpace) return { error: 'own space is full; targetSpace is required' }
    const targetIdx = move.targetSpace - 1
    if (targetIdx < 0 || targetIdx >= GRID_SIZE) return { error: 'invalid targetSpace' }
    const target = grid[targetIdx]
    if (target.bottom !== null) return { error: 'targetSpace must be an empty space' }
    target.bottom = { card, faceUp: false }
  }

  state.market.splice(marketIdx, 1)

  const wasFinalTurn = state.status === 'final-turn'
  if (wasFinalTurn) {
    state.status = 'finished'
    state.seq += 1
    state.lastEvent = { type: 'move', by: playerIdx }
    return null
  }

  if (isGridFull(state.players[playerIdx])) {
    const remaining = state.market.length
    if (remaining % 2 === 1) {
      state.status = 'final-turn'
      state.finalTurnPlayer = playerIdx === 0 ? 1 : 0
    } else {
      state.status = 'finished'
    }
    state.seq += 1
    state.lastEvent = { type: 'move', by: playerIdx }
    return null
  }

  if (state.market.length === 0) {
    state.roundStarter = playerIdx
    state.turn = playerIdx
    dealMarket(state)
  } else {
    state.turn = playerIdx === 0 ? 1 : 0
  }

  state.seq += 1
  state.lastEvent = { type: 'move', by: playerIdx }
  return null
}

// Restores a previous snapshot (from the move-history stack), continuing the
// seq counter from the current state so clients can detect the change across
// polls regardless of what seq the snapshot itself had at the time.
export function applyUndo(current: GameState, snapshot: GameState, by: PlayerIndex): GameState {
  return { ...snapshot, seq: current.seq + 1, lastEvent: { type: 'undo', by } }
}

export type Score = {
  faceTotal: number
  bonusTotal: number
  colorGroupSize: number
  colorGroupBonus: number
  total: number
}

// Color-group scoring multiplier: 2 points/card in round 1, 3 in round 2, 4 in round 3.
function colorMultiplierFor(matchRound: number): number {
  return matchRound + 1
}

function computeScore(playerState: PlayerState, colorMultiplier: number): Score {
  // A space's visible card is whichever one is uncovered (top if present,
  // else bottom) and face-up. A face-down or covered card scores nothing at
  // all — not face value, not bonus, not color. A visible card scores face
  // value only if it's covering another card (a lone face-up card scores
  // bonus/color but no face value).
  const visibleCard: (PlacedCard | null)[] = playerState.grid.map((slot) => {
    const visible = slot.top ?? slot.bottom
    return visible && visible.faceUp ? visible : null
  })
  const visibleColor = visibleCard.map((v) => v?.card.color ?? null)

  let faceTotal = 0
  let flatBonusTotal = 0
  const specialCards: { color: string }[] = []
  playerState.grid.forEach((slot, i) => {
    const visible = visibleCard[i]
    if (!visible) return
    if (slot.top !== null && slot.bottom !== null) faceTotal += visible.card.number
    if (visible.card.bonus === SPECIAL_BONUS) specialCards.push({ color: visible.card.color })
    else flatBonusTotal += visible.card.bonus
  })

  // Each "S" card gives 1 point per visible card of its own color, anywhere
  // on the grid (including itself, if visible) — wildcards count as matching
  // every color, including a wildcard-colored S card (counts all visible cards).
  let specialBonusTotal = 0
  for (const special of specialCards) {
    specialBonusTotal += visibleColor.filter(
      (c) => c !== null && (special.color === WILDCARD_COLOR || c === special.color || c === WILDCARD_COLOR)
    ).length
  }

  // Largest group of orthogonally-adjacent same-color spaces; wildcards can
  // join a group of any real color.
  const realColors = [...new Set(visibleColor.filter((c): c is string => c !== null && c !== WILDCARD_COLOR))]
  let largest = 0
  for (const color of realColors) {
    // Fresh per color: a wildcard cell may belong to the largest group under
    // more than one color, so components can't be shared across colors.
    const compatible = visibleColor.map((c) => c === color || c === WILDCARD_COLOR)
    const visited = new Set<number>()
    for (let i = 0; i < GRID_SIZE; i++) {
      const startSpace = i + 1
      if (visited.has(startSpace) || !compatible[i]) continue
      const stack = [startSpace]
      const seen = new Set<number>()
      while (stack.length) {
        const space = stack.pop()!
        const idx = space - 1
        if (seen.has(space) || !compatible[idx]) continue
        seen.add(space)
        for (const nb of neighborsOf(space)) stack.push(nb)
      }
      for (const space of seen) visited.add(space)
      if (seen.size > largest) largest = seen.size
    }
  }

  const bonusTotal = flatBonusTotal + specialBonusTotal

  return {
    faceTotal,
    bonusTotal,
    colorGroupSize: largest,
    colorGroupBonus: largest * colorMultiplier,
    total: faceTotal + bonusTotal + largest * colorMultiplier,
  }
}

export function getScores(state: GameState): [Score, Score] | null {
  if (state.status !== 'finished') return null
  const multiplier = colorMultiplierFor(state.matchRound)
  return [computeScore(state.players[0], multiplier), computeScore(state.players[1], multiplier)]
}

// Builds the GameState for the round following a finished one: same token's
// match continues (scores accumulate, matchRound advances, the player who
// moved last starts the new round) for rounds 1-2, or a whole new 3-round
// match begins (cumulative scores reset) once round 3 is done.
export function nextRoundState(previous: GameState): GameState {
  const finishedScores = getScores(previous)
  const cumulative: [number, number] = finishedScores
    ? [previous.cumulativeScore[0] + finishedScores[0].total, previous.cumulativeScore[1] + finishedScores[1].total]
    : previous.cumulativeScore

  const matchOver = previous.matchRound >= 3
  const startingPlayer = previous.lastMover ?? 0

  const state = createGame()
  state.matchRound = matchOver ? 1 : previous.matchRound + 1
  state.cumulativeScore = matchOver ? [0, 0] : cumulative
  state.turn = startingPlayer
  state.roundStarter = startingPlayer
  startGame(state)
  return state
}
