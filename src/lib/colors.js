const QUANT = 4

function histogram(canvas, rect, dpr) {
  const x = Math.max(0, Math.floor(rect.x * dpr))
  const y = Math.max(0, Math.floor(rect.y * dpr))
  const w = Math.min(Math.floor(rect.w * dpr), canvas.width - x)
  const h = Math.min(Math.floor(rect.h * dpr), canvas.height - y)
  if (w < 2 || h < 2) return null
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data
  const hist = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = ((r >> QUANT) << 16) | ((g >> QUANT) << 8) | (b >> QUANT)
    let e = hist.get(key)
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; hist.set(key, e) }
    e.n++; e.r += r; e.g += g; e.b += b
  }
  const buckets = []
  hist.forEach(e => buckets.push({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }))
  buckets.sort((a, b) => b.n - a.n)
  return buckets
}

const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
const lum = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

// Inside a line's box the background is whatever colour covers the most
// pixels; the glyphs are the most common colour that is clearly *not* that.
// Picking "the darkest colour" instead would read white-on-green headings as
// green text and make the retyped line invisible.
export function sampleTextColor(canvas, rect, dpr = 1) {
  if (!canvas || !rect) return null
  try {
    const b = histogram(canvas, rect, dpr)
    if (!b || !b.length) return null
    const bg = b[0]
    for (const c of b) {
      if (dist(c, bg) > 60) return hex(c)
    }
    return lum(bg) < 140 ? '#ffffff' : '#111111'
  } catch {
    return null
  }
}

export function sampleBgColor(canvas, rect, dpr = 1) {
  if (!canvas || !rect) return null
  try {
    const b = histogram(canvas, rect, dpr)
    if (!b || !b.length) return null
    const bg = b[0]
    if (lum(bg) > 246) return '#ffffff'
    return hex(bg)
  } catch {
    return null
  }
}
