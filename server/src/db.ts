import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(join(DATA_DIR, 'db.sqlite'))
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    token TEXT PRIMARY KEY,
    player1_secret TEXT NOT NULL,
    player2_secret TEXT,
    state TEXT NOT NULL,
    history TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)

try {
  db.exec("ALTER TABLE games ADD COLUMN history TEXT NOT NULL DEFAULT '[]'")
} catch {
  // column already exists
}
