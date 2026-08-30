import { catImageFor } from './catImages'
import { createGame, fetchState, joinGame, makeMove, rematch } from './api'
import { cardStyle } from './palette'
import type { Card, GridSlot, PlayerState, StateResponse } from './types'

function bonusLabel(bonus: number | 'S'): string {
  if (bonus === 'S') return '😻/*'
  if (bonus === 0) return ''
  return bonus > 0 ? '😺'.repeat(bonus) : '❌'.repeat(-bonus)
}

// Shared inner markup for a face-up card: a color-banded header (face value
// top-left, bonus top-right) over a cat photo filling the rest of the card.
function cardInnerHtml(card: Card): string {
  const label = bonusLabel(card.bonus)
  const photo = catImageFor(card.color, card.id)
  const photoStyle = photo ? ` style="background-image:url('${photo}')"` : ''
  return `<div class="card-top"><span class="num">${card.number}</span>${label ? `<span class="bonus">${label}</span>` : ''}</div><div class="card-photo"${photoStyle}></div>`
}

const app = document.getElementById('app')!

function getToken(): string | null {
  const m = location.pathname.match(/\/game\/([a-zA-Z0-9-]+)/)
  return m ? m[1] : null
}

function secretKey(token: string) {
  return `catz:secret:${token}`
}

let pollTimer: number | undefined
let selectedCardId: string | null = null // awaiting a target-space click (own space full)
let stackChoiceCardId: string | null = null // awaiting an on-top/below choice (tap fallback)
let isDragging = false // pauses polling's re-render so an in-flight drag isn't ripped out from under the pointer
let latestData: StateResponse | null = null
let suppressNextClick = false // a completed drag shouldn't also fire the trailing click

function boot() {
  const token = getToken()
  if (!token) return renderHome()

  const stored = localStorage.getItem(secretKey(token))
  if (stored) return startPlaying(token, stored)

  return renderJoin(token)
}

function renderHome() {
  app.innerHTML = `
    <div class="screen center">
      <h1>Catz</h1>
      <button id="new-game">Start new game</button>
    </div>
  `
  document.getElementById('new-game')!.addEventListener('click', async () => {
    const { token, playerSecret } = await createGame()
    localStorage.setItem(secretKey(token), playerSecret)
    history.pushState({}, '', `/game/${token}`)
    startPlaying(token, playerSecret)
  })
}

function renderJoin(token: string) {
  app.innerHTML = `
    <div class="screen center">
      <h1>Join game</h1>
      <p>You've been invited to play a game of Catz.</p>
      <button id="join-game">Join</button>
    </div>
  `
  document.getElementById('join-game')!.addEventListener('click', async () => {
    try {
      const { playerSecret } = await joinGame(token)
      localStorage.setItem(secretKey(token), playerSecret)
      startPlaying(token, playerSecret)
    } catch (e) {
      alert((e as Error).message)
    }
  })
}

function startPlaying(token: string, secret: string) {
  const tick = async () => {
    try {
      const data = await fetchState(token, secret)
      latestData = data
      if (!isDragging) render(token, secret, data)
    } catch (e) {
      console.error(e)
    }
  }
  tick()
  window.clearInterval(pollTimer)
  pollTimer = window.setInterval(tick, 2000)
}

function cardHtml(placed: { card: Card; faceUp: boolean } | null): string {
  if (!placed) return ''
  if (!placed.faceUp) return `<div class="card facedown"></div>`
  const { card } = placed
  const style = cardStyle(card.color)
  return `<div class="card" style="background:${style.background};color:${style.text}">${cardInnerHtml(card)}</div>`
}

function isSlotFull(slot: GridSlot): boolean {
  return slot.bottom !== null && slot.top !== null
}

function gridHtml(grid: GridSlot[], clickableSpaces: Set<number>, mine: boolean): string {
  const cells = grid
    .map((slot, i) => {
      const space = i + 1
      const clickable = clickableSpaces.has(space)
      return `<div class="slot ${clickable ? 'clickable' : ''}" data-space="${space}">
        <div class="slot-number">${space}</div>
        <div class="stack">${cardHtml(slot.bottom)}${cardHtml(slot.top)}</div>
      </div>`
    })
    .join('')
  return `<div class="grid ${mine ? 'mine' : ''}">${cells}</div>`
}

// Where a market card is allowed to land, computed once at drag-start from
// the (static, for the duration of the drag) grid state:
// - own space empty, or occupied by a single face-down card: only that space, no choice needed
// - own space has one face-up card: only that space, but the drop resolves a top/below choice
// - own space full: any currently-empty space (forced face-down placement)
type DropInfo = { validSpaces: Set<number>; stackChoiceSpace: number | null; needsTargetSpace: boolean }

function computeDropInfo(card: Card, me: PlayerState): DropInfo {
  const ownSlot = me.grid[card.number - 1]
  if (ownSlot.bottom === null) {
    return { validSpaces: new Set([card.number]), stackChoiceSpace: null, needsTargetSpace: false }
  }
  if (ownSlot.top === null) {
    if (!ownSlot.bottom.faceUp) {
      return { validSpaces: new Set([card.number]), stackChoiceSpace: null, needsTargetSpace: false }
    }
    return { validSpaces: new Set([card.number]), stackChoiceSpace: card.number, needsTargetSpace: false }
  }
  const empties = new Set<number>()
  me.grid.forEach((slot, i) => {
    if (slot.bottom === null) empties.add(i + 1)
  })
  return { validSpaces: empties, stackChoiceSpace: null, needsTargetSpace: true }
}

function styleCardEl(el: HTMLDivElement, card: Card) {
  const style = cardStyle(card.color)
  el.style.background = style.background
  el.style.color = style.text
  el.innerHTML = cardInnerHtml(card)
}

function createGhost(card: Card, sourceRect: DOMRect): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'card drag-ghost'
  el.style.width = `${sourceRect.width}px`
  el.style.height = `${sourceRect.height}px`
  styleCardEl(el, card)
  document.body.appendChild(el)
  return el
}

function positionGhost(el: HTMLDivElement, x: number, y: number) {
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

// Live preview of the resulting stack while hovering a stack-choice slot:
// inserts the dragged card into the DOM in the position it would actually
// land (above or below the existing card), so the outcome is unambiguous.
function showStackPreview(slotEl: HTMLElement, card: Card, above: boolean) {
  const stackEl = slotEl.querySelector('.stack')
  if (!stackEl) return
  clearStackPreview(slotEl)
  const previewEl = document.createElement('div')
  previewEl.className = 'card preview-card'
  styleCardEl(previewEl, card)
  const existing = stackEl.querySelector('.card')
  if (above || !existing) stackEl.appendChild(previewEl)
  else stackEl.insertBefore(previewEl, existing)
}

function clearStackPreview(slotEl: HTMLElement) {
  slotEl.querySelector('.preview-card')?.remove()
}

function clearDropVisuals() {
  document.querySelectorAll('.grid.mine .slot').forEach((el) => {
    el.classList.remove('drop-target', 'drop-hover')
    clearStackPreview(el as HTMLElement)
  })
}

async function handleTap(
  token: string,
  secret: string,
  cardId: string,
  card: Card,
  me: PlayerState,
  data: StateResponse
) {
  const ownSlot = me.grid[card.number - 1]
  if (ownSlot.bottom === null) {
    selectedCardId = null
    stackChoiceCardId = null
    const next = await makeMove(token, secret, cardId)
    render(token, secret, next)
  } else if (ownSlot.top === null) {
    if (!ownSlot.bottom.faceUp) {
      selectedCardId = null
      stackChoiceCardId = null
      const next = await makeMove(token, secret, cardId)
      render(token, secret, next)
    } else {
      selectedCardId = null
      stackChoiceCardId = stackChoiceCardId === cardId ? null : cardId
      render(token, secret, data)
    }
  } else {
    stackChoiceCardId = null
    selectedCardId = selectedCardId === cardId ? null : cardId
    render(token, secret, data)
  }
}

function attachMarketCardDrag(
  btn: HTMLButtonElement,
  cardId: string,
  card: Card,
  token: string,
  secret: string,
  me: PlayerState,
  data: StateResponse
) {
  btn.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const startX = e.clientX
    const startY = e.clientY
    const info = computeDropInfo(card, me)
    let dragging = false
    let ghost: HTMLDivElement | null = null
    let hoveredSpace: number | null = null
    let stackBelow = false

    const updateHover = (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY)
      const slotEl = el ? (el as HTMLElement).closest<HTMLElement>('.grid.mine .slot') : null
      const space = slotEl ? Number(slotEl.dataset.space) : null

      document.querySelectorAll('.grid.mine .slot').forEach((s) => {
        s.classList.remove('drop-hover')
        clearStackPreview(s as HTMLElement)
      })

      hoveredSpace = space !== null && info.validSpaces.has(space) ? space : null
      if (hoveredSpace !== null && slotEl) {
        slotEl.classList.add('drop-hover')
        if (info.stackChoiceSpace === hoveredSpace) {
          const rect = slotEl.getBoundingClientRect()
          stackBelow = clientY - rect.top > rect.height / 2
          showStackPreview(slotEl, card, !stackBelow)
        }
      }
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!dragging && Math.hypot(dx, dy) > 8) {
        dragging = true
        isDragging = true
        // A drag starting mid-way through an unresolved tap prompt supersedes it.
        selectedCardId = null
        stackChoiceCardId = null
        document.querySelector('.stack-choice')?.remove()
        ghost = createGhost(card, btn.getBoundingClientRect())
        btn.classList.add('dragging-source')
        document.querySelectorAll('.grid.mine .slot').forEach((s) => {
          const space = Number((s as HTMLElement).dataset.space)
          if (info.validSpaces.has(space)) s.classList.add('drop-target')
        })
      }
      if (dragging) {
        positionGhost(ghost!, ev.clientX, ev.clientY)
        updateHover(ev.clientX, ev.clientY)
      }
    }

    const finish = async () => {
      btn.removeEventListener('pointermove', onMove)
      btn.removeEventListener('pointerup', onUp)
      btn.removeEventListener('pointercancel', onCancel)
      btn.classList.remove('dragging-source')
      ghost?.remove()
      clearDropVisuals()
      isDragging = false

      if (dragging) {
        suppressNextClick = true
        if (hoveredSpace !== null) {
          const targetSpace = info.needsTargetSpace ? hoveredSpace : undefined
          const stackBelowArg = info.stackChoiceSpace === hoveredSpace ? stackBelow : undefined
          const next = await makeMove(token, secret, cardId, targetSpace, stackBelowArg)
          render(token, secret, next)
        } else if (latestData) {
          render(token, secret, latestData) // dropped somewhere invalid: snap back
        }
      }
    }

    const onUp = (ev: PointerEvent) => {
      try {
        btn.releasePointerCapture(ev.pointerId)
      } catch {
        // pointer capture may already be gone; safe to ignore
      }
      void finish()
    }
    const onCancel = () => {
      try {
        btn.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      void finish()
    }

    btn.setPointerCapture(e.pointerId)
    btn.addEventListener('pointermove', onMove)
    btn.addEventListener('pointerup', onUp)
    btn.addEventListener('pointercancel', onCancel)
  })
}

function render(token: string, secret: string, data: StateResponse) {
  const { you, hasOpponent, state, scores } = data
  const me: PlayerState = state.players[you]
  const opp: PlayerState = state.players[you === 0 ? 1 : 0]

  const isMyTurn =
    (state.status === 'active' && state.turn === you) ||
    (state.status === 'final-turn' && state.finalTurnPlayer === you)

  let statusLine: string
  if (state.status === 'waiting') statusLine = 'Waiting for opponent to join…'
  else if (state.status === 'finished') statusLine = 'Game finished'
  else if (state.status === 'final-turn' && !isMyTurn) statusLine = "Opponent's bonus turn"
  else statusLine = isMyTurn ? 'Your turn' : "Opponent's turn"

  const selectedCard = selectedCardId ? state.market.find((c) => c.id === selectedCardId) ?? null : null
  const stackChoiceCard = stackChoiceCardId ? state.market.find((c) => c.id === stackChoiceCardId) ?? null : null

  const clickableSpaces = new Set<number>()
  if (isMyTurn && selectedCard) {
    const ownSlot = me.grid[selectedCard.number - 1]
    if (isSlotFull(ownSlot)) {
      me.grid.forEach((slot, i) => {
        if (slot.bottom === null) clickableSpaces.add(i + 1)
      })
    }
  }

  const marketHtml = state.market
    .map((c) => {
      const selected = c.id === selectedCardId ? 'selected' : ''
      const style = cardStyle(c.color)
      return `<button class="card market-card ${selected}" style="background:${style.background};color:${style.text}" data-card="${c.id}" ${
        isMyTurn ? '' : 'disabled'
      }>${cardInnerHtml(c)}</button>`
    })
    .join('')

  const inviteLink = `${location.origin}/game/${token}`

  const scoresHtml = scores
    ? `<div class="scores">
        <div class="score-row ${you === 0 ? 'me' : ''}">You — ${scores[you].total} pts
          <span class="score-detail">(face ${scores[you].faceTotal}, bonus ${scores[you].bonusTotal >= 0 ? '+' : ''}${scores[you].bonusTotal}, colors ${scores[you].colorGroupSize}×2=${scores[you].colorGroupBonus})</span>
        </div>
        <div class="score-row">Opponent — ${scores[you === 0 ? 1 : 0].total} pts
          <span class="score-detail">(face ${scores[you === 0 ? 1 : 0].faceTotal}, bonus ${scores[you === 0 ? 1 : 0].bonusTotal >= 0 ? '+' : ''}${scores[you === 0 ? 1 : 0].bonusTotal}, colors ${scores[you === 0 ? 1 : 0].colorGroupSize}×2=${scores[you === 0 ? 1 : 0].colorGroupBonus})</span>
        </div>
      </div>`
    : ''

  const marketHint = selectedCard && isSlotFull(me.grid[selectedCard.number - 1]) ? '— pick an empty space below' : ''

  const stackChoiceHtml = stackChoiceCard
    ? `<div class="stack-choice">
        <p class="muted">Space ${stackChoiceCard.number} already has a card — place the new one:</p>
        <button id="stack-top" type="button">On top</button>
        <button id="stack-below" type="button">Below (keep old card visible)</button>
      </div>`
    : ''

  const middleSectionHtml =
    state.status === 'finished'
      ? `<h2>Final score</h2>
         ${scoresHtml}
         <button id="new-game-btn" type="button">New game</button>`
      : `<h2>Market ${marketHint}</h2>
         <div class="market">${marketHtml || '<p class="muted">—</p>'}</div>
         ${stackChoiceHtml}`

  app.innerHTML = `
    <div class="screen play">
      <div class="status">${statusLine}</div>
      ${!hasOpponent ? `<div class="invite">Invite link:<br /><code>${inviteLink}</code></div>` : ''}

      <h2>You</h2>
      ${gridHtml(me.grid, clickableSpaces, true)}

      ${middleSectionHtml}

      <h2>Opponent</h2>
      ${gridHtml(opp.grid, new Set(), false)}
    </div>
  `

  if (state.status === 'finished') {
    document.getElementById('new-game-btn')!.addEventListener('click', async () => {
      const next = await rematch(token, secret)
      render(token, secret, next)
    })
  }

  if (isMyTurn) {
    app.querySelectorAll<HTMLButtonElement>('.market-card').forEach((btn) => {
      const cardId = btn.dataset.card!
      const card = state.market.find((c) => c.id === cardId)!

      btn.addEventListener('click', () => {
        if (suppressNextClick) {
          suppressNextClick = false
          return
        }
        void handleTap(token, secret, cardId, card, me, data)
      })

      attachMarketCardDrag(btn, cardId, card, token, secret, me, data)
    })

    app.querySelectorAll<HTMLDivElement>('.slot.clickable').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!selectedCardId) return
        const space = Number(el.dataset.space)
        const cardId = selectedCardId
        selectedCardId = null
        const next = await makeMove(token, secret, cardId, space)
        render(token, secret, next)
      })
    })

    if (stackChoiceCardId) {
      const submit = async (stackBelow: boolean) => {
        const cardId = stackChoiceCardId!
        stackChoiceCardId = null
        const next = await makeMove(token, secret, cardId, undefined, stackBelow)
        render(token, secret, next)
      }
      document.getElementById('stack-top')!.addEventListener('click', () => submit(false))
      document.getElementById('stack-below')!.addEventListener('click', () => submit(true))
    }
  }
}

boot()
window.addEventListener('popstate', boot)
