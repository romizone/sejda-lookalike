import { BASE_SCALE, slackOf } from '../utils/misc'
import { groupParagraphs } from './extract'

// Tesseract wants roughly 300dpi; the page is re-rendered at its own scale for
// recognition and the boxes are converted back to editor coordinates after.
const OCR_SCALE = 3

async function renderForOcr(pdfPage) {
  // Same frame the editor works in, so the boxes come back usable and the text
  // is upright for pages whose rotation is only a display instruction.
  const vp = pdfPage.getViewport({ scale: OCR_SCALE, rotation: 0 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  return canvas
}

function toLines(data, pageKey) {
  const k = BASE_SCALE / OCR_SCALE
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

export async function ocrPage(pdfPage, pageKey, langs, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const canvas = await renderForOcr(pdfPage)
  const worker = await createWorker(langs, 1, {
    logger: onProgress ? m => onProgress(m) : undefined
  })
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
    return groupParagraphs(toLines(data, pageKey), pageKey)
  } finally {
    try { await worker.terminate() } catch {}
  }
}
