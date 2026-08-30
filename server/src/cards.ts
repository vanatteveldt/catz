import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECIAL_BONUS, type Card } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Real card list: one row per physical card, columns "color,value,bonus".
// bonus is an integer, or "S" for the special color-counting bonus (see game.ts).
const CARDS_CSV_PATH = join(__dirname, 'data', 'cards.csv')

type CardDefinition = { color: string; number: number; bonus: number | typeof SPECIAL_BONUS }

const PLACEHOLDER_COLORS = ['red', 'green', 'blue', 'yellow']

function placeholderDefinitions(): CardDefinition[] {
  const defs: CardDefinition[] = []
  for (const color of PLACEHOLDER_COLORS) {
    for (let number = 1; number <= 9; number++) {
      defs.push({ color, number, bonus: 0 })
      defs.push({ color, number, bonus: 0 })
    }
  }
  return defs
}

function parseCsv(raw: string): CardDefinition[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const [, ...rows] = lines // drop header row
  return rows.map((line) => {
    const [color, value, bonus] = line.split(',').map((cell) => cell.trim())
    const parsedBonus = bonus.toUpperCase() === SPECIAL_BONUS ? SPECIAL_BONUS : Number(bonus)
    return { color, number: Number(value), bonus: parsedBonus }
  })
}

function loadDefinitions(): CardDefinition[] {
  if (existsSync(CARDS_CSV_PATH)) {
    return parseCsv(readFileSync(CARDS_CSV_PATH, 'utf-8'))
  }
  console.warn(
    `[cards] ${CARDS_CSV_PATH} not found — using a placeholder deck ` +
      `(2x each color/number combo, no bonuses).`
  )
  return placeholderDefinitions()
}

export function buildDeck(): Card[] {
  return loadDefinitions().map((def) => ({ id: randomUUID(), ...def }))
}
