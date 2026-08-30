import type { StateResponse } from './types'

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export function createGame(): Promise<{ token: string; playerSecret: string }> {
  return fetch('/api/games', { method: 'POST' }).then((res) => jsonOrThrow(res))
}

export function joinGame(token: string): Promise<{ playerSecret: string }> {
  return fetch(`/api/games/${token}/join`, { method: 'POST' }).then((res) => jsonOrThrow(res))
}

export function fetchState(token: string, secret: string): Promise<StateResponse> {
  return fetch(`/api/games/${token}/state?as=${encodeURIComponent(secret)}`).then((res) => jsonOrThrow(res))
}

export function rematch(token: string, secret: string): Promise<StateResponse> {
  return fetch(`/api/games/${token}/rematch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  }).then((res) => jsonOrThrow(res))
}

export function makeMove(
  token: string,
  secret: string,
  cardId: string,
  targetSpace?: number,
  stackBelow?: boolean
): Promise<StateResponse> {
  return fetch(`/api/games/${token}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, cardId, targetSpace, stackBelow }),
  }).then((res) => jsonOrThrow(res))
}
