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

// Ascent/descent of the substitute web fonts, used to place a box so that its
// first text line sits on the baseline the PDF actually uses.
export const FONT_METRICS = {
  serif: { asc: 0.891, desc: 0.216 },
  'sans-serif': { asc: 0.905, desc: 0.212 },
  monospace: { asc: 0.833, desc: 0.300 }
}

export function topForBaseline(baselineY, fontSize, lineHeight, family) {
  const m = FONT_METRICS[family] || FONT_METRICS['sans-serif']
  const content = (m.asc + m.desc) * fontSize
  const half = ((lineHeight || fontSize * 1.2) - content) / 2
  return baselineY - (half + m.asc * fontSize)
}
