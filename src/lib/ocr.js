import { BASE_SCALE, slackOf } from '../utils/misc'
import { groupParagraphs } from './extract'

// Tesseract reads best around 300dpi. A whole web page captured onto one sheet
// leaves glyphs only a few pixels tall, so the render is pushed as high as the
// browser's canvas limits allow rather than fixed at a small multiple.
const TARGET_DPI = 300
const MAX_SIDE = 8000
const MAX_AREA = 40e6

function ocrScaleFor(pdfPage) {
  const v1 = pdfPage.getViewport({ scale: 1, rotation: 0 })
  const byDpi = TARGET_DPI / 72
  const bySide = Math.min(MAX_SIDE / v1.width, MAX_SIDE / v1.height)
  const byArea = Math.sqrt(MAX_AREA / (v1.width * v1.height))
  return Math.max(1, Math.min(byDpi, bySide, byArea))
}

async function renderForOcr(pdfPage, scale) {
  // Same frame the editor works in, so the boxes come back usable and the text
  // is upright for pages whose rotation is only a display instruction.
  const vp = pdfPage.getViewport({ scale, rotation: 0 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  if (!canvas.width || !canvas.height) throw new Error('This page is too large to render for recognition.')
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise
  return canvas
}

function toLines(data, pageKey, scale) {
  const k = BASE_SCALE / scale
  const lines = []
  let i = 0
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+$/g, '')
        if (!text.trim()) continue
        const bb = line.bbox
        if (!bb) continue
        const x = bb.x0 * k
        const top = bb.y0 * k
        const right = bb.x1 * k
        const bottom = bb.y1 * k
        const h = Math.max(bottom - top, 4)
        const w = Math.max(right - x, 6)
        const baselineY = line.baseline && line.baseline.has_baseline
          ? line.baseline.y0 * k
          : bottom - h * 0.2
        const fontSize = Math.max(6, (baselineY - top) / 0.8)
        lines.push({
          id: `O${pageKey}_${i++}`,
          text,
          x,
          w,
          wrapW: w + slackOf(w),
          baselineY,
          lineHeight: Math.round(h * 1.15),
          rectH: h,
          fontSize,
          asc: 0.8,
          desc: -0.2,
          family: 'sans-serif',
          wideGap: false,
          rect: { x: x - 2, y: top - 2, w: w + 4, h: h + 4 },
          dirty: false,
          deleted: false,
          color: null,
          bg: null,
          bold: false,
          italic: false,
          underline: false
        })
      }
    }
  }
  return lines
}

export async function ocrPage(pdfPage, pageKey, langs, onProgress, { group = true } = {}) {
  const { createWorker } = await import('tesseract.js')
  const scale = ocrScaleFor(pdfPage)
  const canvas = await renderForOcr(pdfPage, scale)
  const worker = await createWorker(langs, 1, {
    logger: onProgress ? m => onProgress(m) : undefined
  })
  try {
    let data
    try {
      ;({ data } = await worker.recognize(canvas, {}, { blocks: true, text: false }))
    } catch (err) {
      // When Tesseract recognises nothing its JSON output is an empty string,
      // and tesseract.js parses it without checking. That is a blank result,
      // not a failure worth aborting the whole run for.
      if (err instanceof SyntaxError) return []
      throw err
    }
    const lines = toLines(data, pageKey, scale)
    return group ? groupParagraphs(lines, pageKey) : lines
  } finally {
    try { await worker.terminate() } catch {}
  }
}
