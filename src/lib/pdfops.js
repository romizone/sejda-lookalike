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

async function reencodeJpeg(bytes, quality, maxSide, grey) {
  const blob = new Blob([bytes], { type: 'image/jpeg' })
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (grey) ctx.filter = 'grayscale(1)'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality))
  if (!out) return null
  return { bytes: new Uint8Array(await out.arrayBuffer()), width: w, height: h }
}

// Scanned pages are almost entirely JPEG data, so re-encoding those streams is
// where the bytes actually are. Everything else is left untouched and the file
// is re-saved with object streams, which shrinks the document structure itself.
export async function compressPdf(bytes, { quality = 0.62, maxSide = 1800, grey = false } = {}, onProgress) {
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
      const res = await reencodeJpeg(obj.contents, quality, maxSide, grey)
      // Turning a picture grey is worth doing even when it saves nothing.
      if (res && (grey || res.bytes.length < obj.contents.length * 0.95)) {
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

/* ---------- organise: rotate, reorder, drop ---------- */

// entries: [{ src, rotate }] in the order the result should have
export async function organisePages(bytes, entries) {
  const { PDFDocument, degrees } = await import('pdf-lib')
  const src = await load(bytes)
  const kept = entries.filter(e => e.src != null)
  if (!kept.length) throw new Error('At least one page has to stay.')

  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, kept.map(e => e.src))
  copied.forEach((page, i) => {
    const base = page.getRotation().angle
    page.setRotation(degrees((((base + (kept[i].rotate || 0)) % 360) + 360) % 360))
    out.addPage(page)
  })
  return asBlob(out)
}

/* ---------- several pages onto one sheet ---------- */

export async function nUpPdf(bytes, { perSheet = 2, gap = 8, margin = 18 }) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const out = await PDFDocument.create()
  const count = src.getPageCount()
  const embedded = await out.embedPages(src.getPages())

  const layouts = { 2: [2, 1], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 16: [4, 4] }
  const [cols, rows] = layouts[perSheet] || [2, 2]

  const first = src.getPage(0).getSize()
  // Two side by side wants a landscape sheet; the taller grids stay portrait.
  const landscape = cols > rows
  const sheetW = landscape ? Math.max(first.width, first.height) : Math.min(first.width, first.height)
  const sheetH = landscape ? Math.min(first.width, first.height) : Math.max(first.width, first.height)

  const cellW = (sheetW - margin * 2 - gap * (cols - 1)) / cols
  const cellH = (sheetH - margin * 2 - gap * (rows - 1)) / rows

  for (let i = 0; i < count; i += cols * rows) {
    const sheet = out.addPage([sheetW, sheetH])
    for (let slot = 0; slot < cols * rows && i + slot < count; slot++) {
      const page = embedded[i + slot]
      const col = slot % cols
      const row = Math.floor(slot / cols)
      const scale = Math.min(cellW / page.width, cellH / page.height)
      const w = page.width * scale
      const h = page.height * scale
      const x = margin + col * (cellW + gap) + (cellW - w) / 2
      const y = sheetH - margin - row * (cellH + gap) - cellH + (cellH - h) / 2
      sheet.drawPage(page, { x, y, xScale: scale, yScale: scale })
    }
  }
  return asBlob(out)
}

/* ---------- stamps: watermark, page numbers, header and footer ---------- */

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']

function placeText(page, text, font, size, position, margin) {
  const { width, height } = page.getSize()
  const w = font.widthOfTextAtSize(text, size)
  const top = position.startsWith('top')
  const y = top ? height - margin - size : margin
  let x = margin
  if (position.endsWith('center')) x = (width - w) / 2
  else if (position.endsWith('right')) x = width - margin - w
  return { x, y }
}

export async function stampPdf(bytes, opts) {
  const { rgb, degrees } = await import('pdf-lib')
  const { pickFont } = await import('./textfont')
  const doc = await load(bytes)
  const pages = doc.getPages()
  const total = pages.length
  const only = opts.pages && opts.pages.length ? new Set(opts.pages) : null

  const hex = c => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '#666666')
    const n = m ? parseInt(m[1], 16) : 0x666666
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
  }

  const fill = (tpl, i) =>
    String(tpl || '')
      .replace(/\{n\}/g, String(i + 1 + (opts.startAt ?? 1) - 1))
      .replace(/\{total\}/g, String(total))

  // Every text that may be drawn is collected first so one font covers them all.
  const sample = [opts.text, opts.format, opts.headerLeft, opts.headerCenter, opts.headerRight,
    opts.footerLeft, opts.footerCenter, opts.footerRight].filter(Boolean).join(' ')
  const { font, encode } = await pickFont(doc, sample, { bold: !!opts.bold })

  pages.forEach((page, i) => {
    if (only && !only.has(i)) return
    const { width, height } = page.getSize()

    if (opts.kind === 'watermark' && opts.text) {
      const text = encode(opts.text)
      const size = opts.size || Math.min(width, height) / 8
      const w = font.widthOfTextAtSize(text, size)
      const angle = opts.angle ?? 45
      const rad = (angle * Math.PI) / 180
      // Rotation happens about the anchor, so the anchor is offset by half the
      // rotated run to leave the text centred on the page.
      const x = width / 2 - (w / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad)
      const y = height / 2 - (w / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad)
      page.drawText(text, {
        x, y, size, font,
        color: hex(opts.color),
        opacity: opts.opacity ?? 0.18,
        rotate: degrees(angle)
      })
      return
    }

    if (opts.kind === 'numbers') {
      const text = encode(fill(opts.format || '{n}', i))
      if (!text.trim()) return
      const size = opts.size || 10
      const { x, y } = placeText(page, text, font, size, opts.position || 'bottom-center', opts.margin ?? 28)
      page.drawText(text, { x, y, size, font, color: hex(opts.color) })
      return
    }

    if (opts.kind === 'headerFooter') {
      const size = opts.size || 9
      const margin = opts.margin ?? 24
      const rows = [
        ['top-left', opts.headerLeft], ['top-center', opts.headerCenter], ['top-right', opts.headerRight],
        ['bottom-left', opts.footerLeft], ['bottom-center', opts.footerCenter], ['bottom-right', opts.footerRight]
      ]
      for (const [pos, tpl] of rows) {
        const text = encode(fill(tpl, i))
        if (!text.trim()) continue
        const { x, y } = placeText(page, text, font, size, pos, margin)
        page.drawText(text, { x, y, size, font, color: hex(opts.color) })
      }
    }
  })

  return asBlob(doc)
}

export { POSITIONS }

/* ---------- forms ---------- */

export async function flattenPdf(bytes) {
  const doc = await load(bytes)
  let fields = 0
  try {
    const form = doc.getForm()
    fields = form.getFields().length
    form.flatten()
  } catch (e) {
    throw new Error('This document has no form fields to flatten.')
  }
  if (!fields) throw new Error('This document has no form fields to flatten.')
  return { blob: await asBlob(doc), fields }
}

/* ---------- images in, metadata ---------- */

export async function imagesToPdf(items, { fit = 'image', margin = 0 }) {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  const A4 = [595.28, 841.89]

  for (const item of items) {
    const bin = new Uint8Array(item.bytes)
    const img = bin[0] === 0x89 && bin[1] === 0x50 ? await out.embedPng(bin) : await out.embedJpg(bin)
    if (fit === 'image') {
      const page = out.addPage([img.width + margin * 2, img.height + margin * 2])
      page.drawImage(img, { x: margin, y: margin, width: img.width, height: img.height })
    } else {
      const portrait = img.height >= img.width
      const [pw, ph] = portrait ? A4 : [A4[1], A4[0]]
      const page = out.addPage([pw, ph])
      const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height)
      const w = img.width * scale
      const h = img.height * scale
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
    }
  }
  if (!out.getPageCount()) throw new Error('No images to place.')
  return asBlob(out)
}

export async function readMetadata(bytes) {
  const doc = await load(bytes)
  const safe = fn => { try { return fn() || '' } catch { return '' } }
  return {
    title: safe(() => doc.getTitle()),
    author: safe(() => doc.getAuthor()),
    subject: safe(() => doc.getSubject()),
    keywords: safe(() => (doc.getKeywords() || '')),
    creator: safe(() => doc.getCreator()),
    producer: safe(() => doc.getProducer())
  }
}

export async function writeMetadata(bytes, meta) {
  const doc = await load(bytes)
  const set = (fn, v) => { try { fn(v ?? '') } catch {} }
  set(v => doc.setTitle(v), meta.title)
  set(v => doc.setAuthor(v), meta.author)
  set(v => doc.setSubject(v), meta.subject)
  set(v => doc.setKeywords(String(meta.keywords || '').split(/[,;]\s*/).filter(Boolean)), meta.keywords)
  set(v => doc.setCreator(v), meta.creator)
  set(v => doc.setProducer(v), meta.producer)
  return asBlob(doc)
}

/* ---------- alternate & mix ---------- */

export async function mixDocuments(items, { reverseOthers = false }) {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  const sources = []
  for (const item of items) {
    const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true })
    const order = src.getPageIndices()
    sources.push({ src, order: reverseOthers && sources.length ? order.slice().reverse() : order })
  }
  if (sources.length < 2) throw new Error('Pick at least two documents to mix.')

  const longest = Math.max(...sources.map(s => s.order.length))
  for (let round = 0; round < longest; round++) {
    for (const s of sources) {
      const idx = s.order[round]
      if (idx === undefined) continue
      const [page] = await out.copyPages(s.src, [idx])
      out.addPage(page)
    }
  }
  return asBlob(out)
}

/* ---------- split a two-page scan down the middle ---------- */

export async function splitInHalf(bytes, { direction = 'auto' }) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const out = await PDFDocument.create()

  for (const page of src.getPages()) {
    const { width, height } = page.getSize()
    const vertical = direction === 'auto' ? width >= height : direction === 'vertical'
    const halves = vertical
      ? [{ left: 0, bottom: 0, right: width / 2, top: height },
         { left: width / 2, bottom: 0, right: width, top: height }]
      // Top half first: a page reads downwards.
      : [{ left: 0, bottom: height / 2, right: width, top: height },
         { left: 0, bottom: 0, right: width, top: height / 2 }]

    for (const box of halves) {
      const embedded = await out.embedPage(page, box)
      const w = box.right - box.left
      const h = box.top - box.bottom
      const sheet = out.addPage([w, h])
      sheet.drawPage(embedded, { x: 0, y: 0, width: w, height: h })
    }
  }
  return asBlob(out)
}

/* ---------- split until each part fits a size ---------- */

export async function splitBySize(bytes, { limitBytes, baseName }, onProgress) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const count = src.getPageCount()
  const files = []

  // Building each candidate from scratch matters: removing a page from a
  // document leaves its objects behind, so a part trimmed that way would still
  // weigh what it did before.
  const build = async indices => {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, indices)
    copied.forEach(p => out.addPage(p))
    return new Uint8Array(await out.save({ useObjectStreams: true }))
  }

  const push = (group, data) => {
    files.push({
      name: `${baseName}-${group[0] + 1}-${group[group.length - 1] + 1}.pdf`,
      data
    })
  }

  let group = []
  let pending = null

  for (let i = 0; i < count; i++) {
    const data = await build([...group, i])
    if (data.length > limitBytes && group.length) {
      push(group, pending)
      group = [i]
      pending = await build(group)
    } else {
      group.push(i)
      pending = data
    }
    onProgress?.((i + 1) / count)
  }
  if (group.length) push(group, pending)

  if (!files.length) throw new Error('Nothing to split.')
  return files
}

/* ---------- mirror ---------- */

export async function flipPdf(bytes, { axis = 'horizontal' }) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const out = await PDFDocument.create()

  for (const page of src.getPages()) {
    const { width, height } = page.getSize()
    const embedded = await out.embedPage(page)
    const sheet = out.addPage([width, height])
    // A negative scale reflects the page; the anchor moves to the far edge so
    // the reflection lands back on the sheet.
    if (axis === 'horizontal') {
      sheet.drawPage(embedded, { x: width, y: 0, xScale: -1, yScale: 1 })
    } else {
      sheet.drawPage(embedded, { x: 0, y: height, xScale: 1, yScale: -1 })
    }
  }
  return asBlob(out)
}

/* ---------- annotations ---------- */

export async function removeAnnotations(bytes, { keepLinks = false, keepFields = true }) {
  const { PDFName } = await import('pdf-lib')
  const doc = await load(bytes)
  let removed = 0

  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    const kept = []
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      let sub = null
      try { sub = doc.context.lookup(ref)?.get(PDFName.of('Subtype')) } catch { sub = null }
      const isLink = sub === PDFName.of('Link')
      const isWidget = sub === PDFName.of('Widget')
      if ((isLink && keepLinks) || (isWidget && keepFields)) kept.push(ref)
      else removed++
    }
    page.node.set(PDFName.of('Annots'), doc.context.obj(kept))
  }

  if (!removed) throw new Error('There are no annotations in this document to remove.')
  return { blob: await asBlob(doc), removed }
}

/* ---------- bates numbering ---------- */

export async function batesNumber(items, opts, onProgress) {
  const { rgb } = await import('pdf-lib')
  const { pickFont } = await import('./textfont')
  let counter = opts.startAt ?? 1
  const out = []
  let done = 0

  for (const item of items) {
    const doc = await load(item.bytes)
    const { font, encode } = await pickFont(doc, `${opts.prefix || ''}${opts.suffix || ''}0123456789`)
    for (const page of doc.getPages()) {
      const stamp = `${opts.prefix || ''}${String(counter).padStart(opts.digits || 6, '0')}${opts.suffix || ''}`
      const text = encode(stamp)
      const size = opts.size || 9
      const margin = opts.margin ?? 24
      const { width, height } = page.getSize()
      const w = font.widthOfTextAtSize(text, size)
      const top = (opts.position || 'bottom-right').startsWith('top')
      const y = top ? height - margin - size : margin
      let x = margin
      if ((opts.position || '').endsWith('center')) x = (width - w) / 2
      else if ((opts.position || 'bottom-right').endsWith('right')) x = width - margin - w
      page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.12) })
      counter++
    }
    out.push({ name: item.name, data: new Uint8Array(await doc.save({ useObjectStreams: false })) })
    onProgress?.(++done / items.length)
  }
  return { files: out, last: counter - 1 }
}

/* ---------- bookmarks ---------- */

export async function addBookmarks(bytes, entries) {
  const { PDFName, PDFNumber, PDFString } = await import('pdf-lib')
  if (!entries.length) throw new Error('There is nothing to make bookmarks from.')
  const doc = await load(bytes)
  const ctx = doc.context
  const pages = doc.getPages()

  const outlinesRef = ctx.nextRef()
  const itemRefs = entries.map(() => ctx.nextRef())

  entries.forEach((entry, i) => {
    const page = pages[Math.min(entry.page, pages.length - 1)]
    const dict = ctx.obj({
      Title: PDFString.of(entry.title),
      Parent: outlinesRef,
      Dest: [page.ref, PDFName.of('XYZ'), PDFNumber.of(0), PDFNumber.of(page.getSize().height), PDFNumber.of(0)]
    })
    if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1])
    if (i < entries.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1])
    ctx.assign(itemRefs[i], dict)
  })

  const outlines = ctx.obj({ Type: 'Outlines', Count: entries.length })
  outlines.set(PDFName.of('First'), itemRefs[0])
  outlines.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1])
  ctx.assign(outlinesRef, outlines)

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  return asBlob(doc)
}

/* ---------- split at a list of page indices ---------- */

export async function splitAt(bytes, starts, baseName) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await load(bytes)
  const count = src.getPageCount()
  const bounds = [...new Set(starts.filter(n => n > 0 && n < count))].sort((a, b) => a - b)
  const groups = []
  let from = 0
  for (const b of [...bounds, count]) {
    if (b > from) groups.push(Array.from({ length: b - from }, (_, i) => from + i))
    from = b
  }
  if (groups.length < 2) throw new Error('Nothing was found to split on.')

  const files = []
  for (const group of groups) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, group)
    copied.forEach(p => out.addPage(p))
    files.push({
      name: `${baseName}-${group[0] + 1}-${group[group.length - 1] + 1}.pdf`,
      data: new Uint8Array(await out.save({ useObjectStreams: false }))
    })
  }
  return files
}
