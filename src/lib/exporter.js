import { hexToRgb01, sanitizeWinAnsi, slackOf } from '../utils/misc'
import { sampleTextColor } from './colors'

const STD = {
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  'sans-serif': ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  monospace: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']
}

async function embedImage(doc, page, o, X, Y, k) {
  const b64 = o.src.split(',')[1]
  if (!b64) return
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  let img = null
  try {
    if (bin[0] === 0x89 && bin[1] === 0x50) img = await doc.embedPng(bin)
    else if (bin[0] === 0xff && bin[1] === 0xd8) img = await doc.embedJpg(bin)
    else img = await convertToPng(doc, o.src)
  } catch { return }
  if (!img) return
  page.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: Math.max(2, o.w * k), height: Math.max(2, o.h * k) })
}

async function convertToPng(doc, src) {
  const imgEl = new Image()
  await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = rej; imgEl.src = src })
  const c = document.createElement('canvas')
  c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight
  c.getContext('2d').drawImage(imgEl, 0, 0)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  const buf = new Uint8Array(await blob.arrayBuffer())
  return doc.embedPng(buf)
}

export async function exportEditedPdf({ bytes, pages, baseScale, canvases, dpr = 1 }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  // embedFont resolves asynchronously; using the promise as if it were the
  // font makes every measurement and drawText throw, which the surrounding
  // try/catch used to swallow - the old text got covered and the new text was
  // never written.
  const cache = new Map()
  const getFont = async (fam, b, i) => {
    const list = STD[fam] || STD['sans-serif']
    const name = list[(b ? 1 : 0) + (i ? 2 : 0)]
    if (!cache.has(name)) cache.set(name, await doc.embedFont(name))
    return cache.get(name)
  }

  const pageCount = doc.getPageCount()
  for (let pi = 0; pi < pageCount; pi++) {
    const pe = pages[pi]
    if (!pe || (!pe.lines.length && !pe.objects.length)) continue
    const page = doc.getPage(pi)
    const { height: PH } = page.getSize()
    const k = 1 / baseScale
    const X = v => v * k
    const Y = v => PH - v * k

    const cover = (r, hex) => {
      const c = hexToRgb01(hex || '#ffffff')
      page.drawRectangle({
        x: X(r.x) - 1, y: Y(r.y + r.h) - 1,
        width: r.w * k + 2, height: r.h * k + 2,
        color: rgb(c.r, c.g, c.b)
      })
    }

    const wrapWidthOf = o => {
      if (o.wrapW) return o.wrapW * k
      return o.w ? (o.w + slackOf(o.w)) * k : Infinity
    }

    // Break the text the same way the on-screen box does, so what the editor
    // shows and what lands in the file agree.
    const layoutRows = async (text, o) => {
      const t = sanitizeWinAnsi(text ?? '')
      const font = await getFont(o.family || 'sans-serif', !!o.bold, !!o.italic)
      const size = Math.max(2, (o.fontSize || 12) * k)
      const boxW = wrapWidthOf(o)
      const measure = str => {
        try { return font.widthOfTextAtSize(str, size) } catch { return str.length * size * 0.5 }
      }
      const rows = []
      for (const raw of t.split('\n')) {
        if (!raw) { rows.push(''); continue }
        if (measure(raw) <= boxW) { rows.push(raw); continue }
        const words = raw.split(/(\s+)/)
        let line = ''
        for (let wi = 0; wi < words.length; wi++) {
          const cand = line + words[wi]
          if (measure(cand) > boxW && line.trim()) {
            rows.push(line.replace(/\s+$/, ''))
            line = words[wi].replace(/^\s+/, '')
          } else {
            line = cand
          }
        }
        if (line.trim() || rows[rows.length - 1]) rows.push(line)
      }
      return { rows, font, size }
    }

    const drawRows = (o, { rows, font, size }) => {
      const col = hexToRgb01(o.color || '#111111')
      const color = rgb(col.r, col.g, col.b)
      const x0 = X(o.x)
      const step = (o.lineHeight || (o.fontSize || 12) * 1.25) * k
      const y0 = Y(o.baselineY ?? o.y)
      rows.forEach((row, i) => {
        if (!row) return
        const yy = y0 - i * step
        try {
          page.drawText(row, { x: x0, y: yy, size, font, color })
        } catch {
          try { page.drawText(row.replace(/[^\x00-\xFF]/g, '?'), { x: x0, y: yy, size, font, color }) } catch {}
        }
        if (o.underline) {
          let w = 0
          try { w = font.widthOfTextAtSize(row, size) } catch { w = row.length * size * 0.5 }
          page.drawRectangle({ x: x0, y: yy - size * 0.22, width: Math.max(w, 1), height: Math.max(0.5, size * 0.07), color })
        }
      })
    }

    const dirtyLines = pe.lines.filter(l => !l.deleted && l.dirty)
    const layouts = new Map()
    for (const ln of dirtyLines) layouts.set(ln.id, await layoutRows(ln.text, ln))

    // Re-flowed text can end up taller than the block it replaces; grow the
    // patch to match so nothing from the original bleeds through underneath.
    const patchRect = ln => {
      const lay = layouts.get(ln.id)
      const r = { ...ln.rect }
      if (!lay) return r
      const step = ln.lineHeight || ln.fontSize * 1.25
      const bottom = (ln.baselineY ?? ln.y) + Math.max(0, lay.rows.length - 1) * step + ln.fontSize * 0.3
      r.h = Math.max(r.h, bottom - r.y)
      return r
    }

    for (const o of pe.objects) {
      if (o.kind === 'whiteout') cover(o, '#ffffff')
    }
    for (const ln of pe.lines) {
      if (ln.deleted) cover(ln.rect, ln.bg)
      else if (ln.dirty) cover(patchRect(ln), ln.bg)
    }

    for (const ln of dirtyLines) {
      if (!ln.color) ln.color = sampleTextColor(canvases?.[pi], ln.rect, dpr) || '#111111'
      const lay = layouts.get(ln.id)
      if (lay && lay.rows.some(r => r.trim())) drawRows(ln, lay)
    }

    for (const o of pe.objects) {
      if (o.kind === 'text') {
        const lay = await layoutRows(o.text, o)
        if (lay.rows.some(r => r.trim())) drawRows(o, lay)
      } else if (o.kind === 'image') {
        await embedImage(doc, page, o, X, Y, k)
      } else if (o.kind === 'rect') {
        const st = hexToRgb01(o.stroke)
        const opts = {
          x: X(o.x), y: Y(o.y + o.h),
          width: o.w * k, height: o.h * k,
          borderColor: rgb(st.r, st.g, st.b),
          borderWidth: Math.max(0.5, (o.strokeWidth || 2) * k)
        }
        if (o.fill && o.fill !== 'none') {
          const fc = hexToRgb01(o.fill)
          opts.color = rgb(fc.r, fc.g, fc.b)
        }
        page.drawRectangle(opts)
      } else if (o.kind === 'ellipse') {
        const st = hexToRgb01(o.stroke)
        const opts = {
          x: X(o.x + o.w / 2), y: Y(o.y + o.h / 2),
          xScale: (o.w / 2) * k, yScale: (o.h / 2) * k,
          borderColor: rgb(st.r, st.g, st.b),
          borderWidth: Math.max(0.5, (o.strokeWidth || 2) * k)
        }
        if (o.fill && o.fill !== 'none') {
          const fc = hexToRgb01(o.fill)
          opts.color = rgb(fc.r, fc.g, fc.b)
        }
        page.drawEllipse(opts)
      } else if (o.kind === 'line') {
        const st = hexToRgb01(o.stroke)
        page.drawLine({
          start: { x: X(o.x), y: Y(o.y) },
          end: { x: X(o.x1), y: Y(o.y1) },
          thickness: Math.max(0.5, (o.strokeWidth || 2) * k),
          color: rgb(st.r, st.g, st.b)
        })
      }
    }
  }

  const out = await doc.save({ useObjectStreams: false })
  return new Blob([out], { type: 'application/pdf' })
}
