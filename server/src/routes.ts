import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db } from './db.js'
import { applyMove, createGame, getScores, startGame } from './game.js'
import type { GameState, Move, PlayerIndex } from './types.js'

type GameRow = {
  token: string
  player1_secret: string
  player2_secret: string | null
  state: string
  created_at: string
  updated_at: string
}

function loadRow(token: string): GameRow | undefined {
  return db.prepare('SELECT * FROM games WHERE token = ?').get(token) as GameRow | undefined
}

function saveState(token: string, state: GameState) {
  db.prepare('UPDATE games SET state = ?, updated_at = ? WHERE token = ?').run(
    JSON.stringify(state),
    new Date().toISOString(),
    token
  )
}

function playerIndexFor(row: GameRow, secret: string): PlayerIndex | null {
  if (secret && secret === row.player1_secret) return 0
  if (row.player2_secret && secret === row.player2_secret) return 1
  return null
}

// Hide face-down cards' identity from both players until the game is finished,
// matching physical play where a face-down card's value isn't known to anyone.
function sanitize(state: GameState): GameState {
  if (state.status === 'finished') return state
  const clone: GameState = JSON.parse(JSON.stringify(state))
  clone.deck = []
  for (const player of clone.players) {
    for (const slot of player.grid) {
      if (slot.bottom && !slot.bottom.faceUp) {
        slot.bottom = { faceUp: false, card: { id: slot.bottom.card.id, color: '', number: 0, bonus: 0 } }
      }
      if (slot.top && !slot.top.faceUp) {
        slot.top = { faceUp: false, card: { id: slot.top.card.id, color: '', number: 0, bonus: 0 } }
      }
    }
  }
  return clone
}

export const router = Router()

router.post('/games', (_req, res) => {
  const token = randomUUID()
  const player1Secret = randomUUID()
  const state = createGame()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO games (token, player1_secret, player2_secret, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, player1Secret, null, JSON.stringify(state), now, now)
  res.json({ token, playerSecret: player1Secret })
})

router.post('/games/:token/join', (req, res) => {
  const row = loadRow(req.params.token)
  if (!row) return res.status(404).json({ error: 'game not found' })
  if (row.player2_secret) return res.status(409).json({ error: 'game already has two players' })

  const playerSecret = randomUUID()
  const state: GameState = JSON.parse(row.state)
  startGame(state)

  db.prepare('UPDATE games SET player2_secret = ?, state = ?, updated_at = ? WHERE token = ?').run(
    playerSecret,
    JSON.stringify(state),
    new Date().toISOString(),
    row.token
  )
  res.json({ playerSecret })
})

router.post('/games/:token/rematch', (req, res) => {
  const row = loadRow(req.params.token)
  if (!row) return res.status(404).json({ error: 'game not found' })
  const body = req.body as { secret: string }
  const playerIdx = playerIndexFor(row, body.secret)
  if (playerIdx === null) return res.status(403).json({ error: 'invalid player secret' })
  if (!row.player2_secret) return res.status(400).json({ error: 'waiting for a second player' })

  const currentState: GameState = JSON.parse(row.state)
  if (currentState.status !== 'finished') return res.status(400).json({ error: 'game is still in progress' })

  const state = createGame()
  startGame(state)
  saveState(row.token, state)

  res.json({
    you: playerIdx,
    hasOpponent: true,
    state: sanitize(state),
    scores: getScores(state),
  })
})

router.get('/games/:token/state', (req, res) => {
  const row = loadRow(req.params.token)
  if (!row) return res.status(404).json({ error: 'game not found' })
  const secret = String(req.query.as ?? '')
  const playerIdx = playerIndexFor(row, secret)
  if (playerIdx === null) return res.status(403).json({ error: 'invalid player secret' })

  const state: GameState = JSON.parse(row.state)
  res.json({
    you: playerIdx,
    hasOpponent: row.player2_secret !== null,
    state: sanitize(state),
    scores: getScores(state),
  })
})

router.post('/games/:token/move', (req, res) => {
  const row = loadRow(req.params.token)
  if (!row) return res.status(404).json({ error: 'game not found' })
  const body = req.body as Move & { secret: string }
  const playerIdx = playerIndexFor(row, body.secret)
  if (playerIdx === null) return res.status(403).json({ error: 'invalid player secret' })

  const state: GameState = JSON.parse(row.state)
  const err = applyMove(state, playerIdx, {
    cardId: body.cardId,
    targetSpace: body.targetSpace,
    stackBelow: body.stackBelow,
  })
  if (err) return res.status(400).json(err)

  saveState(row.token, state)
  res.json({
    you: playerIdx,
    hasOpponent: row.player2_secret !== null,
    state: sanitize(state),
    scores: getScores(state),
  })
})
