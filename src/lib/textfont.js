import { STD, LIBERATION, winAnsiCanEncode, styleIndex, fontUrl } from './fonts'
import { sanitizeWinAnsi } from '../utils/misc'

// Shared by the stamping tools: a standard font when WinAnsi can carry the
// text, a subset of the matching Liberation face when it cannot.
export async function pickFont(doc, text, { family = 'sans-serif', bold = false, italic = false } = {}) {
  const fam = STD[family] ? family : 'sans-serif'
  const idx = styleIndex(bold, italic)

  if (!winAnsiCanEncode(text)) {
    try {
      const fontkit = (await import('@pdf-lib/fontkit')).default
      doc.registerFontkit(fontkit)
      const res = await fetch(fontUrl(LIBERATION[fam][idx]))
      if (res.ok) {
        const font = await doc.embedFont(await res.arrayBuffer(), { subset: true })
        return { font, encode: t => t }
      }
    } catch {
      /* falls back to the standard font below */
    }
  }
  const font = await doc.embedFont(STD[fam][idx])
  return { font, encode: sanitizeWinAnsi }
}
