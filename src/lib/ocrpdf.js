import pdfjs from './pdfjs'
import { BASE_SCALE, sanitizeWinAnsi } from './../utils/misc'
import { ocrPage } from './ocr'
import { winAnsiCanEncode, LIBERATION, fontUrl } from './fonts'

// A searchable scan is the picture of the page with the recognised words laid
// over it, invisibly, where they were found. The page still looks exactly the
// same; the difference is that the text can now be selected, searched and
// copied.
export async function ocrToSearchablePdf(bytes, { langs, onlyEmpty = true }, onProgress) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })

  const clone = new Uint8Array(bytes.byteLength)
  clone.set(new Uint8Array(bytes))
  const view = await pdfjs.getDocument({ data: clone }).promise

  const pages = doc.getPages()
  const targets = []
  for (let i = 0; i < pages.length; i++) {
    if (!onlyEmpty) { targets.push(i); continue }
    const tc = await (await view.getPage(i + 1)).getTextContent()
    const hasText = tc.items.some(it => typeof it.str === 'string' && it.str.trim())
    if (!hasText) targets.push(i)
  }
  if (!targets.length) {
    throw new Error(
      onlyEmpty
        ? 'Every page already carries a text layer — there is nothing here to recognise.'
        : 'Nothing to recognise.'
    )
  }

  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  let unicode = null
  const fontFor = async text => {
    if (winAnsiCanEncode(text)) return { font: helvetica, encode: sanitizeWinAnsi }
    if (unicode === null) {
      try {
        const fontkit = (await import('@pdf-lib/fontkit')).default
        doc.registerFontkit(fontkit)
        const res = await fetch(fontUrl(LIBERATION['sans-serif'][0]))
        unicode = res.ok ? await doc.embedFont(await res.arrayBuffer(), { subset: true }) : false
      } catch { unicode = false }
    }
    return unicode ? { font: unicode, encode: t => t } : { font: helvetica, encode: sanitizeWinAnsi }
  }

  const k = 1 / BASE_SCALE
  let words = 0
  let done = 0

  for (const index of targets) {
    const pdfPage = await view.getPage(index + 1)
    const lines = await ocrPage(pdfPage, index, langs, m => {
      const inner = typeof m.progress === 'number' ? m.progress : 0
      onProgress?.({
        label: `${m.status || 'recognising'} — page ${done + 1} of ${targets.length}`,
        pct: (done + inner) / targets.length
      })
    }, { group: false })

    const page = pages[index]
    const { height } = page.getSize()

    for (const line of lines) {
      const raw = line.text.trim()
      if (!raw) continue
      const { font, encode } = await fontFor(raw)
      const text = encode(raw)
      const target = line.w * k
      let size = Math.max(1, line.fontSize * k)
      // Match the run's own width so a selection lands on the right words.
      try {
        const natural = font.widthOfTextAtSize(text, size)
        if (natural > 0) size = Math.max(1, Math.min(size * (target / natural), size * 3))
      } catch { /* keep the estimate */ }

      try {
        page.drawText(text, {
          x: line.x * k,
          y: height - line.baselineY * k,
          size,
          font,
          color: rgb(0, 0, 0),
          opacity: 0
        })
        words += raw.split(/\s+/).filter(Boolean).length
      } catch { /* a run this font cannot encode is simply not laid down */ }
    }

    done++
  }

  if (!words) {
    throw new Error(
      'No readable text was found. This usually means the writing is too small or too soft to ' +
      'make out — a sharper scan gives it something to read.'
    )
  }

  const out = await doc.save({ useObjectStreams: false })
  return { blob: new Blob([out], { type: 'application/pdf' }), pages: targets.length, words }
}
