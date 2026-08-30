// Cat photos per card color, served as static files from client/public/cats.
const CAT_IMAGES: Record<string, string[]> = {
  y: ['01.png', '02.jpg', '03.jpg', '05.jpg', '06.jpg', '07.jpg', '08.jpg', '09.png', '10.jpg', '11.jpg', '12.jpg', '13.jpg', '16.jpg', '18.jpg', '19.jpg', '21.jpg'].map(
    (f) => `/cats/yellow-toyger/${f}`
  ),
  w: ['02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.png', '07.jpg', '08.jpg', '09.jpg', '10.jpg', '11.jpg', '14.jpg', '16.jpg', '17.jpg', '18.jpg', '19.jpg', '20.jpg'].map(
    (f) => `/cats/blue-british-shorthair/${f}`
  ),
  r: ['01.jpg', '02.jpg', '03.jpg', '05.jpg', '06.jpg', '07.jpg', '11.jpg', '12.jpg', '14.jpg', '15.jpg', '19.jpg', '21.jpg', '22.jpg', '23.jpg', '28.jpg', '29.jpg'].map(
    (f) => `/cats/red-somali/${f}`
  ),
  g: ['01.jpg', '02.jpg', '04.jpg', '06.jpg', '07.jpg', '08.jpg', '10.jpg', '11.jpg', '12.jpg', '13.jpg', '16.jpg', '17.jpg', '19.jpg', '20.jpg', '21.jpg', '22.jpg', '23.jpg'].map(
    (f) => `/cats/green-maine-coon/${f}`
  ),
  '*': ['06.jpg', '07.jpg', '10.jpg', '17.jpg', '18.jpg', '19.jpg'].map((f) => `/cats/wildcard-sphynx/${f}`),
}

// Deterministic pick so a given card always shows the same photo (avoids the
// picture changing on every poll/re-render), while still varying across cards.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function catImageFor(color: string, seed: string): string | null {
  const images = CAT_IMAGES[color]
  if (!images || images.length === 0) return null
  return images[hashString(seed) % images.length]
}
