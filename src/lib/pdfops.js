import { zipSync } from './zip'

const load = async bytes => {
  const { PDFDocument } = await import('pdf-lib')
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
}

const asBlob = async doc => new Blob([await doc.save({ useObjectStreams: false })], { type: 'application/pdf' })

/* ---------- page selection ---------- */

export async function deletePages(bytes, remove) {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await load(bytes)
  const gone = new Set(remove)
  const count = doc.getPageCount()
  if (gone.size >= count) throw new Error('At least one page has to stay.')

  // Removing pages in place leaves their objects behind, so the file barely
  // shrinks. Copying the survivors into a fresh document drops them - except
  // when there is a form, whose document-level dictionary would not survive
  // the copy.
  let hasForm = false
  try { hasForm = doc.getForm().getFields().length > 0 } catch { hasForm = false }

  if (hasForm) {
    ;[...gone].sort((a, b) => b - a).forEach(i => doc.removePage(i))
    return asBlob(doc)
  }

  const keep = []
  for (let i = 0; i < count; i++) if (!gone.has(i)) keep.push(i)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(doc, keep)
  copied.forEach(p => out.addPage(p))
  return asBlob(out)
}

export async function extractPages(bytes, keep) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const wanted = [...new Set(keep)].sort((a, b) => a - b)
  if (!wanted.length) throw new Error('Pick at least one page to keep.')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, wanted)
  copied.forEach(p => out.addPage(p))
  return asBlob(out)
}

/* ---------- split ---------- */

// "1-3, 5, 8-" over a 10 page document -> [[0,1,2],[4],[7,8,9]]
export function parseRanges(spec, pageCount) {
  const out = []
  for (const chunk of String(spec || '').split(',')) {
    const t = chunk.trim()
    if (!t) continue
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(t)
    if (!m) throw new Error(`"${t}" is not a page range.`)
    const [, a, dash, b] = m
    let from = a ? parseInt(a, 10) : 1
    let to = dash ? (b ? parseInt(b, 10) : pageCount) : from
    if (!a && !b) throw new Error(`"${t}" is not a page range.`)
    from = Math.max(1, Math.min(from, pageCount))
    to = Math.max(1, Math.min(to, pageCount))
    if (to < from) [from, to] = [to, from]
    const idx = []
    for (let i = from; i <= to; i++) idx.push(i - 1)
    out.push(idx)
  }
  if (!out.length) throw new Error('Enter at least one page range.')
  return out
}

export async function splitPdf(bytes, { mode, spec, baseName }) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const count = src.getPageCount()
  const groups = mode === 'every'
    ? Array.from({ length: count }, (_, i) => [i])
    : parseRanges(spec, count)

  const files = []
  for (const group of groups) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, group)
    copied.forEach(p => out.addPage(p))
    const label = group.length === 1 ? `${group[0] + 1}` : `${group[0] + 1}-${group[group.length - 1] + 1}`
    files.push({
      name: `${baseName}-${label}.pdf`,
      data: new Uint8Array(await out.save({ useObjectStreams: false }))
    })
  }
  return files
}

export function zipFiles(files) {
  return zipSync(files)
}

/* ---------- merge ---------- */

export async function mergeDocuments(items, onProgress) {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  let done = 0
  for (const item of items) {
    if (item.kind === 'image') {
      const bin = new Uint8Array(item.bytes)
      let img
      if (bin[0] === 0x89 && bin[1] === 0x50) img = await out.embedPng(bin)
      else img = await out.embedJpg(bin)
      const page = out.addPage([img.width, img.height])
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    } else {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true })
      const copied = await out.copyPages(src, src.getPageIndices())
      copied.forEach(p => out.addPage(p))
    }
    onProgress?.(++done / items.length)
  }
  if (!out.getPageCount()) throw new Error('Nothing to merge.')
  return asBlob(out)
}

/* ---------- crop and page size ---------- */

export const PAGE_SIZES = {
  keep: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28]
}

// box is given as fractions of the page: { left, top, right, bottom }
export async function cropPdf(bytes, { box, pages, size }) {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await load(bytes)
  const all = doc.getPages()
  const targets = pages && pages.length ? pages : all.map((_, i) => i)
  const wanted = new Set(targets)

  all.forEach((page, i) => {
    if (!wanted.has(i)) return
    const mb = page.getMediaBox()
    if (box) {
      const x = mb.x + mb.width * box.left
      const w = mb.width * (1 - box.left - box.right)
      const h = mb.height * (1 - box.top - box.bottom)
      // PDF y grows upwards, the box is expressed from the top down.
      const y = mb.y + mb.height * box.bottom
      if (w > 1 && h > 1) {
        page.setMediaBox(x, y, w, h)
        page.setCropBox(x, y, w, h)
      }
    }
    const target = PAGE_SIZES[size]
    if (target) {
      const cur = page.getMediaBox()
      const [tw, th] = cur.width > cur.height ? [target[1], target[0]] : target
      const factor = Math.min(tw / cur.width, th / cur.height)
      page.scaleContent(factor, factor)
      page.setMediaBox(0, 0, tw, th)
      page.setCropBox(0, 0, tw, th)
    }
  })
  return asBlob(doc)
}

/* ---------- compress ---------- */

async function reencodeJpeg(bytes, quality, maxSide) {
  const blob = new Blob([bytes], { type: 'image/jpeg' })
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality))
  if (!out) return null
  return { bytes: new Uint8Array(await out.arrayBuffer()), width: w, height: h }
}

// Scanned pages are almost entirely JPEG data, so re-encoding those streams is
// where the bytes actually are. Everything else is left untouched and the file
// is re-saved with object streams, which shrinks the document structure itself.
export async function compressPdf(bytes, { quality = 0.62, maxSide = 1800 } = {}, onProgress) {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })

  const images = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const dict = obj.dict
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
    const filter = dict.get(PDFName.of('Filter'))
    if (filter !== PDFName.of('DCTDecode')) continue
    if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Mask'))) continue
    images.push({ ref, obj, dict })
  }

  let done = 0
  for (const { ref, obj, dict } of images) {
    try {
      const res = await reencodeJpeg(obj.contents, quality, maxSide)
      if (res && res.bytes.length < obj.contents.length * 0.95) {
        dict.set(PDFName.of('Width'), PDFNumber.of(res.width))
        dict.set(PDFName.of('Height'), PDFNumber.of(res.height))
        dict.set(PDFName.of('Length'), PDFNumber.of(res.bytes.length))
        dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
        dict.delete(PDFName.of('DecodeParms'))
        dict.delete(PDFName.of('Decode'))
        doc.context.assign(ref, PDFRawStream.of(dict, res.bytes))
      }
    } catch {
      /* an image we cannot decode simply stays as it was */
    }
    onProgress?.(++done / Math.max(images.length, 1))
  }

  const out = await doc.save({ useObjectStreams: true })
  return { blob: new Blob([out], { type: 'application/pdf' }), images: images.length }
}
