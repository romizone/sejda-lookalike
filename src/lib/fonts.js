// The 14 standard PDF fonts cost nothing to embed and match the metrics the
// page was laid out with, but they can only encode WinAnsi. Anything outside
// that repertoire needs a real font file, so a metric-compatible Liberation
// face is fetched on demand and subset into the document.

export const STD = {
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  'sans-serif': ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  monospace: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']
}

export const LIBERATION = {
  serif: ['LiberationSerif-Regular', 'LiberationSerif-Bold', 'LiberationSerif-Italic', 'LiberationSerif-BoldItalic'],
  'sans-serif': ['LiberationSans-Regular', 'LiberationSans-Bold', 'LiberationSans-Italic', 'LiberationSans-BoldItalic'],
  monospace: ['LiberationMono-Regular', 'LiberationMono-Bold', 'LiberationMono-Italic', 'LiberationMono-BoldItalic']
}

// The code points WinAnsi maps above Latin-1.
const WIN_ANSI_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
])

export function winAnsiCanEncode(text) {
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0)
    if (c <= 0xff) continue
    if (!WIN_ANSI_HIGH.has(c)) return false
  }
  return true
}

export const styleIndex = (bold, italic) => (bold ? 1 : 0) + (italic ? 2 : 0)

export function fontUrl(name) {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'
  return new URL(`fonts/${name}.ttf`, base).href
}
