import { winAnsiCanEncode } from '../lib/fonts'

export const BASE_SCALE = 2

export const uid = () => Math.random().toString(36).slice(2, 10)

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export const slackOf = w => Math.round(w * 0.08 + 14)

export const FAMILY_CSS = {
  serif: "'Times New Roman', Georgia, serif",
  'sans-serif': 'Helvetica, Arial, sans-serif',
  monospace: "'Courier New', Courier, monospace"
}

export const famCss = f => FAMILY_CSS[f] || FAMILY_CSS['sans-serif']

export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

// WinAnsi already covers curly quotes, dashes, the euro sign and friends, so
// nothing needs downgrading here - this only guards the fallback path where the
// Unicode font could not be loaded.
export function sanitizeWinAnsi(t) {
  let out = ''
  for (const ch of String(t ?? '')) {
    const c = ch.codePointAt(0)
    if (c === 10 || c === 9) { out += ch; continue }
    if (c < 0x20) { out += ' '; continue }
    out += winAnsiCanEncode(ch) ? ch : '?'
  }
  return out
}

export const baseName = n => (n || 'document').replace(/\.pdf$/i, '')

// The css font list for a piece of text: the embedded face pdf.js loaded for
// this document (registered as a FontFace named like "g_d0_f1" when the page
// was rendered) in front of the generic family it maps to. Editing with the
// document's own font is what keeps shape, size, width and position identical
// when a line is clicked.
export const fontCssOf = item =>
  item && item.pdfFont ? `"${item.pdfFont}", ${famCss(item.family)}` : famCss(item && item.family)

const FALLBACK_METRICS = { asc: 0.905, desc: 0.212 }
const metricCache = new Map()
let measureCtx = null

// A text box is laid out from the metrics of the font the browser actually
// resolved, so those are measured rather than assumed. A list whose first face
// has not finished loading is measured fresh each call and only cached once it
// has, so a late-arriving FontFace cannot freeze wrong numbers in.
export function familyMetrics(familyCss) {
  const hit = metricCache.get(familyCss)
  if (hit) return hit
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    measureCtx.font = `100px ${familyCss}`
    const m = measureCtx.measureText('Hg')
    if (typeof m.fontBoundingBoxAscent === 'number') {
      const v = { asc: m.fontBoundingBoxAscent / 100, desc: m.fontBoundingBoxDescent / 100 }
      let settled = true
      try { settled = document.fonts.check(`100px ${familyCss}`) } catch { settled = true }
      if (settled) metricCache.set(familyCss, v)
      return v
    }
  } catch { /* no DOM or no metrics API */ }
  return FALLBACK_METRICS
}

export function topForBaseline(baselineY, fontSize, lineHeight, familyCss) {
  const m = familyMetrics(familyCss)
  const content = (m.asc + m.desc) * fontSize
  const half = ((lineHeight || fontSize * 1.2) - content) / 2
  return baselineY - (half + m.asc * fontSize)
}
