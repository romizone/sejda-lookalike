export function sampleTextColor(canvas, rect, dpr = 1) {
  if (!canvas || !rect) return null
  try {
    const x = Math.max(0, Math.floor(rect.x * dpr))
    const y = Math.max(0, Math.floor(rect.y * dpr))
    const w = Math.min(Math.floor(rect.w * dpr), canvas.width - x)
    const h = Math.min(Math.floor(rect.h * dpr), canvas.height - y)
    if (w < 2 || h < 2) return null
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data
    const hist = new Map()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum > 205) continue
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      let e = hist.get(key)
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; hist.set(key, e) }
      e.n++; e.r += r; e.g += g; e.b += b
    }
    let best = null
    hist.forEach(e => { if (!best || e.n > best.n) best = e })
    if (!best) return '#111111'
    const hx = v => Math.round(v / best.n).toString(16).padStart(2, '0')
    return '#' + hx(best.r) + hx(best.g) + hx(best.b)
  } catch {
    return null
  }
}
