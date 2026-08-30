// Maps the single-letter color codes used in the card data to display styles.
const COLOR_STYLES: Record<string, { background: string; text: string }> = {
  y: { background: '#e8c547', text: '#2a2200' },
  w: { background: '#cfe6f7', text: '#0f3a56' }, // data code 'w' ("white") is displayed as a light/cool blue
  r: { background: '#e0524f', text: '#fff' },
  g: { background: '#4caf7d', text: '#062' },
}

const WILDCARD_STYLE = {
  background: 'conic-gradient(#e0524f, #e8c547, #4caf7d, #6ea8e8, #e0524f)',
  text: '#fff',
}

export function cardStyle(color: string): { background: string; text: string } {
  return COLOR_STYLES[color] ?? WILDCARD_STYLE
}
