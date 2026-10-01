import { hexToRgb01, sanitizeWinAnsi, slackOf } from '../utils/misc'
import { sampleTextColor } from './colors'
import { STD, LIBERATION, winAnsiCanEncode, styleIndex, fontUrl } from './fonts'
import { glyphsInRects, scrubPageText } from './scrub'

// pdf-lib can read an encrypted file but cannot write one, so whatever is
// added to it would be stored in the clear inside a document whose reader
// expects ciphertext, and come out as noise. Refusing is the only honest
// answer; the same wording is used when such a file is opened.
export const PROTECTED_MESSAGE =
  'This PDF is protected against changes by its owner, so edits cannot be saved into it.'

// The bundled faces are fetched from the app's own origin and nothing about
// the document goes with the request. Tests hand in a loader that reads the
// same files from disk.
async function fetchFont(name) {
  const res = await fetch(fontUrl(name))
  if (!res.ok) throw new Error(`font ${name} unavailable`)
  return res.arrayBuffer()
}

// Characters that leave no mark on the page, so a font without them loses
// nothing worth telling the user about.
const INVISIBLE = /[\s\p{Cc}\p{Cf}\uFE00-\uFE0F]/u

const listChars = set => {
  const all = [...set]
  const shown = all.slice(0, 16).join(' ')
  return all.length > 16 ? `${shown} and ${all.length - 16} more` : shown
}

// Resolves to false when the picture could not be put on the page, so the
// caller can say so instead of handing back a file that quietly lacks it.
async function embedImage(doc, page, o, X, Y, k) {
  const b64 = o.src.split(',')[1]
  if (!b64) return false
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  let img = null
  try {
    if (bin[0] === 0x89 && bin[1] === 0x50) img = await doc.embedPng(bin)
    else if (bin[0] === 0xff && bin[1] === 0xd8) img = await doc.embedJpg(bin)
    else img = await convertToPng(doc, o.src)
  } catch { return false }
  if (!img) return false
  page.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: Math.max(2, o.w * k), height: Math.max(2, o.h * k) })
  return true
}

async function convertToPng(doc, src) {
  const imgEl = new Image()
  await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = rej; imgEl.src = src })
  const c = document.createElement('canvas')
  c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight
  c.getContext('2d').drawImage(imgEl, 0, 0)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  if (!blob) return null
  const buf = new Uint8Array(await blob.arrayBuffer())
  return doc.embedPng(buf)
}

function tokenize(text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i) out.push('\n')
    for (const t of line.split(/(\s+)/)) if (t !== '') out.push(t)
  })
  return out
}

// "Page 3", "Pages 3 and 5", "Pages 1, 2 and 9" - the pages a remark is about,
// by their place in the saved document.
function pageList(numbers) {
  const all = [...numbers].sort((a, b) => a - b)
  if (all.length === 1) return `Page ${all[0]}`
  const shown = all.slice(0, 12)
  const rest = all.length - shown.length
  const last = rest ? `${rest} more` : shown.pop()
  return `Pages ${shown.join(', ')} and ${last}`
}

// Resolves with { blob, warnings }: the saved document, and a short sentence
// for the user about each thing that could not be written - or removed - the
// way it was asked for. An empty list means the file is what the editor showed.
//
// loadFont(name) fetches one of the bundled faces.
//
// pdfPages (source page index -> pdf.js page of the file as it was opened) and
// pdfjsLib are what it takes to remove covered text from the file instead of
// only painting over it; without them the covers are painted and nothing more.
// openPdf(bytes) -> pdf.js document lets the saved file be read back to see
// that the text really went. All three are handed over by the caller rather
// than imported, because this module also has to load where pdf.js's browser
// build cannot.
export async function exportEditedPdf({
  bytes, pages, baseScale, canvases, dpr = 1,
  formValues = {}, linkPages = {}, pageOrder = null,
  loadFont = fetchFont, pdfPages = null, pdfjsLib = null, openPdf = null
}) {
  const lib = await import('pdf-lib')
  const { PDFDocument, rgb, degrees, PDFName, PDFString } = lib
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  if (doc.isEncrypted) throw new Error(PROTECTED_MESSAGE)

  const warnings = []
  const noGlyph = new Set()
  const noFont = new Set()
  const unwritten = new Set()
  let lostImages = 0

  const stdCache = new Map()
  const uniCache = new Map()
  const charsets = new Map()
  let fontkitReady = false

  const embedStd = async name => {
    if (!stdCache.has(name)) stdCache.set(name, await doc.embedFont(name))
    return stdCache.get(name)
  }

  const loadUni = async name => {
    if (!fontkitReady) {
      const fontkit = (await import('@pdf-lib/fontkit')).default
      doc.registerFontkit(fontkit)
      fontkitReady = true
    }
    return doc.embedFont(await loadFont(name), { subset: true })
  }

  // A face that cannot be had - offline, a missing file, bytes that are not a
  // font - is remembered as null, so it is asked for once and every caller
  // gets the same answer.
  const embedUni = name => {
    if (!uniCache.has(name)) uniCache.set(name, loadUni(name).catch(() => null))
    return uniCache.get(name)
  }

  // Standard fonts cost nothing and keep the original metrics, so they stay the
  // default; a Liberation face is only fetched when the text uses characters
  // WinAnsi cannot represent.
  const getFont = async (fam, bold, italic, text) => {
    const idx = styleIndex(bold, italic)
    const family = STD[fam] ? fam : 'sans-serif'
    if (!winAnsiCanEncode(text)) {
      const font = await embedUni(LIBERATION[family][idx])
      if (font) return { font, std: false }
      /* fall through to the standard font, which will lose those glyphs */
    }
    return { font: await embedStd(STD[family][idx]), std: true }
  }

  // An embedded face draws a character it does not have as an empty glyph and
  // says nothing, so what it holds is looked up instead of found out.
  const canDraw = (font, ch) => {
    if (!charsets.has(font)) {
      let set = null
      try { set = new Set(font.getCharacterSet()) } catch { set = null }
      charsets.set(font, set)
    }
    const set = charsets.get(font)
    return !set || set.has(ch.codePointAt(0))
  }

  const covers = (font, text) => {
    for (const ch of text) if (!INVISIBLE.test(ch) && !canDraw(font, ch)) return false
    return true
  }

  // With a standard font the character has already been turned into "?"
  // because the Unicode face would not load; with the Unicode face it is
  // simply not in the font. The user is told which of the two happened.
  const noteLost = (font, std, text) => {
    for (const ch of text) {
      if (INVISIBLE.test(ch) || canDraw(font, ch)) continue
      if (std) noFont.add(ch)
      else noGlyph.add(ch)
    }
  }

  const measure = (font, text, size) => {
    try { return font.widthOfTextAtSize(text, size) } catch { return text.length * size * 0.5 }
  }

  const originals = doc.getPages()
  const order = pageOrder && pageOrder.length
    ? pageOrder
    : originals.map((_, i) => ({ key: i, src: i, rotate: 0 }))

  // The page tree is rebuilt before anything is drawn so that inserted blank
  // pages can receive content too.
  const targets = applyPageOrder(doc, originals, order, pageOrder && pageOrder.length, degrees, PDFName)
  const inUse = new Set(targets.values())
  const removed = originals.filter(p => !inUse.has(p))

  let form = null
  const getForm = () => {
    if (!form) form = doc.getForm()
    return form
  }

  const isolated = new Set()

  // What became of the text under the covers, by page number in the saved
  // document: `exposed` where it is still in the file, and `scrubbed` for
  // every page that had text taken out, to be looked at again before and
  // after saving.
  const exposed = new Set()
  const scrubbed = []
  const cleared = new Set()

  // A white rectangle hides words from the eye and from nothing else: they
  // stay in the page content, where select-all and copy still find them. So
  // the glyphs under the covers are taken out of the content itself.
  const takeOut = async (page, pdfPage, rects, position) => {
    // The page is compared against the file as pdf.js read it, which can be
    // done once and only before anything is drawn on it.
    if (!pdfPage || cleared.has(page)) { exposed.add(position); return }
    cleared.add(page)
    const res = await scrubPageText({ doc, page, pdfPage, rects, pdfjsLib })
    if (!res.ok || res.left > 0) { exposed.add(position); return }
    if (!res.removed) return
    scrubbed.push({ position, rects, textOps: res.textOps, shared: res.shared, held: res.held || [] })
  }

  for (const [at, entry] of order.entries()) {
    const page = targets.get(entry.key)
    if (!page) continue
    const pe = pages[entry.key]
    // A page with nothing on it is still worth a visit when links were taken
    // from it: the user may have deleted the only thing the editor showed.
    const imported = entry.src != null ? linkPages[entry.src] : null
    const tookLinks = Array.isArray(imported) ? imported.length > 0 : !!imported
    if (!pe || (!pe.lines.length && !pe.objects.length && !tookLinks)) continue

    // Editor coordinates are pixels of the pdf.js viewport, whose origin is the
    // top-left corner of the page's visible box - not of its MediaBox.
    const view = visibleBox(page, PDFName)
    const k = 1 / (baseScale * view.unit)
    const X = v => view.x + v * k
    const Y = v => view.y + view.height - v * k

    // The rectangle a cover paints, in the page's own coordinates: the box the
    // editor holds, and a point more on every side so that no sliver of what
    // was there shows along the edge. The same rectangle decides which text
    // leaves the file, so what is painted over and what is removed agree.
    const coverBox = r => ({ x: X(r.x) - 1, y: Y(r.y + r.h) - 1, w: r.w * k + 2, h: r.h * k + 2 })

    const wrapWidthOf = o => {
      if (o.wrapW) return o.wrapW * k
      return o.w ? (o.w + slackOf(o.w)) * k : Infinity
    }

    // One segment per styled token, so a bold word inside a sentence keeps its
    // own font while the line still wraps as a whole.
    const layout = async item => {
      const family = item.family || 'sans-serif'
      const baseStyle = {
        bold: !!item.bold,
        italic: !!item.italic,
        under: !!item.underline,
        color: item.color || '#111111',
        size: item.fontSize || 12
      }
      const runs = item.runs && item.runs.length ? item.runs : [{ t: item.text || '' }]
      const boxW = wrapWidthOf(item)

      const rows = [[]]
      let width = 0
      const newRow = () => { rows.push([]); width = 0 }

      for (const r of runs) {
        const bold = r.b === undefined ? baseStyle.bold : !!r.b
        const italic = r.i === undefined ? baseStyle.italic : !!r.i
        const under = r.u === undefined ? baseStyle.under : !!r.u
        const color = r.c || baseStyle.color
        const size = Math.max(2, (r.s || baseStyle.size) * k)
        const { font, std } = await getFont(family, bold, italic, r.t || '')
        const text = std ? sanitizeWinAnsi(r.t || '') : (r.t || '')
        noteLost(font, std, r.t || '')

        for (const tok of tokenize(text)) {
          if (tok === '\n') { newRow(); continue }
          const isSpace = /^\s+$/.test(tok)
          const w = measure(font, tok, size)
          if (!isSpace && width > 0 && width + w > boxW) newRow()
          if (isSpace && width === 0) continue
          rows[rows.length - 1].push({ text: tok, w, font, size, color, under })
          width += w
        }
      }
      return rows
    }

    const draw = (item, rows) => {
      const x0 = X(item.x)
      const step = (item.lineHeight || (item.fontSize || 12) * 1.25) * k
      const y0 = Y(item.baselineY ?? item.y)
      rows.forEach((row, ri) => {
        let x = x0
        const y = y0 - ri * step
        for (const seg of row) {
          const c = hexToRgb01(seg.color)
          const color = rgb(c.r, c.g, c.b)
          if (seg.text.trim()) {
            try {
              page.drawText(seg.text, { x, y, size: seg.size, font: seg.font, color })
            } catch {
              try {
                page.drawText(seg.text.replace(/[^\x00-\xFF]/g, '?'), { x, y, size: seg.size, font: seg.font, color })
              } catch {
                /* nothing sensible left to draw, which the user has to hear */
                unwritten.add(seg.text)
              }
            }
          }
          if (seg.under) {
            page.drawRectangle({
              x, y: y - seg.size * 0.16,
              width: Math.max(seg.w, 1), height: Math.max(0.5, seg.size * 0.06),
              color
            })
          }
          x += seg.w
        }
      })
    }

    const dirtyLines = pe.lines.filter(l => !l.deleted && l.dirty)
    const layouts = new Map()
    for (const ln of dirtyLines) layouts.set(ln.id, await layout(ln))

    // Re-flowed text can end up taller than the block it replaces; grow the
    // patch to match so nothing from the original bleeds through underneath.
    const patchRect = ln => {
      const rows = layouts.get(ln.id)
      const r = { ...ln.rect }
      if (!rows) return r
      const step = ln.lineHeight || ln.fontSize * 1.25
      const bottom = (ln.baselineY ?? ln.y) + Math.max(0, rows.length - 1) * step + ln.fontSize * 0.3
      r.h = Math.max(r.h, bottom - r.y)
      return r
    }

    const patches = []
    for (const o of pe.objects) {
      if (o.kind === 'whiteout') patches.push({ box: coverBox(o), hex: '#ffffff' })
    }
    for (const ln of pe.lines) {
      if (ln.deleted) patches.push({ box: coverBox(ln.rect), hex: ln.bg })
      else if (ln.dirty) patches.push({ box: coverBox(patchRect(ln)), hex: ln.bg })
    }

    // Before the first thing is drawn, while the content is still what pdf.js
    // read. A page the editor inserted has nothing underneath to remove.
    if (patches.length && entry.src != null && pdfPages && pdfjsLib) {
      await takeOut(page, pdfPages[entry.src], patches.map(c => c.box), at + 1)
    }

    const drawsOnPage = pe.lines.some(l => l.deleted || l.dirty) ||
      pe.objects.some(o => o.kind !== 'link' && o.kind !== 'field')
    if (drawsOnPage && entry.src != null && !isolated.has(page)) {
      isolated.add(page)
      isolateContent(doc, page, lib)
    }

    // The paint stays even where the text has gone: it is what hides a
    // picture or a drawing under the cover, and the background of an edit.
    for (const { box, hex } of patches) {
      const c = hexToRgb01(hex || '#ffffff')
      page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(c.r, c.g, c.b) })
    }

    for (const o of pe.objects) {
      if (o.kind !== 'mark') continue
      const c = hexToRgb01(o.color || (o.variant === 'highlight' ? '#ffe14d' : '#e11d48'))
      const color = rgb(c.r, c.g, c.b)
      if (o.variant === 'highlight') {
        page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w * k, height: o.h * k, color, opacity: 0.42 })
      } else {
        const bar = Math.max(0.7, o.h * 0.075 * k)
        const yy = o.variant === 'strike' ? Y(o.y + o.h * 0.56) : Y(o.y + o.h * 0.92)
        page.drawRectangle({ x: X(o.x), y: yy, width: o.w * k, height: bar, color })
      }
    }

    for (const ln of dirtyLines) {
      if (!ln.color) ln.color = sampleTextColor(canvases?.[entry.key] ?? canvases?.[entry.src], ln.rect, dpr) || '#111111'
      const rows = layouts.get(ln.id)
      if (rows && rows.some(r => r.some(s => s.text.trim()))) draw(ln, rows)
    }

    for (const o of pe.objects) {
      if (o.kind === 'text') {
        const rows = await layout(o)
        if (rows.some(r => r.some(s => s.text.trim()))) draw(o, rows)
      } else if (o.kind === 'image') {
        if (!(await embedImage(doc, page, o, X, Y, k))) lostImages++
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
      } else if (o.kind === 'line' || o.kind === 'arrow') {
        const st = hexToRgb01(o.stroke)
        const color = rgb(st.r, st.g, st.b)
        const thickness = Math.max(0.5, (o.strokeWidth || 2) * k)
        const sx = X(o.x), sy = Y(o.y), ex = X(o.x1), ey = Y(o.y1)
        page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness, color })
        if (o.kind === 'arrow') {
          const ang = Math.atan2(ey - sy, ex - sx)
          const head = Math.max(5, thickness * 4)
          const wing = 0.42
          page.drawLine({
            start: { x: ex, y: ey },
            end: { x: ex - head * Math.cos(ang - wing), y: ey - head * Math.sin(ang - wing) },
            thickness, color
          })
          page.drawLine({
            start: { x: ex, y: ey },
            end: { x: ex - head * Math.cos(ang + wing), y: ey - head * Math.sin(ang + wing) },
            thickness, color
          })
        }
      }
    }

    writeLinks({
      doc, page, objects: pe.objects, X, Y,
      imported: tookLinks ? imported : null,
      PDFName, PDFString
    })
    writeNewFields({ getForm, page, objects: pe.objects, X, Y, k })
  }

  applyFormValues(getForm, formValues, warnings)

  // Only when the form was touched above, which is also the only case in
  // which pdf-lib itself would have gone over the fields while saving.
  if (form) {
    await refreshAppearances({
      form, covers, warnings,
      uniFont: () => embedUni(LIBERATION['sans-serif'][0]),
      PDFName, PDFBool: lib.PDFBool
    })
  }

  if (noGlyph.size) {
    warnings.push('Some characters could not be written because the built-in fonts do not include them: ' + listChars(noGlyph))
  }
  if (noFont.size) {
    warnings.push('The font needed for some characters could not be loaded, so they were written as "?": ' + listChars(noFont))
  }
  if (unwritten.size) {
    warnings.push('Some text could not be written at all: ' + [...unwritten].slice(0, 6).join(' '))
  }
  if (lostImages) {
    warnings.push(lostImages === 1
      ? 'One image could not be read and was left out.'
      : `${lostImages} images could not be read and were left out.`)
  }

  if (removed.length) forgetPages(doc, removed, lib)

  // Text inside a block that several pages draw - a letterhead, a footer - is
  // taken out of a copy made for the one page, and the original stays for the
  // others. Whether any other page still uses it can only be said now that
  // every page has had its turn.
  const copied = new Set()
  const sharing = scrubbed.filter(s => s.shared > 0)
  if (sharing.length) {
    const live = reachable(doc.context, lib)
    for (const s of sharing) {
      if (s.shared > s.held.length || s.held.some(ref => live.has(ref))) copied.add(s.position)
    }
  }

  // The appearances are settled above, field by field; left to itself pdf-lib
  // would redo them here with Helvetica and refuse to save at the first value
  // that font cannot encode.
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  // The blob takes its own copy of the bytes, so whatever reads `out` back
  // below - pdf.js keeps the buffer it is given - cannot touch the download.
  const blob = new Blob([out], { type: 'application/pdf' })

  if (openPdf && pdfjsLib) {
    const pending = scrubbed.filter(s => !exposed.has(s.position))
    for (const position of await stillUnder(out, pending, openPdf, pdfjsLib)) exposed.add(position)
  }
  for (const position of exposed) copied.delete(position)

  const privacy = []
  if (exposed.size) {
    privacy.push(`${pageList(exposed)}: the text under a whiteout or an edit could not be taken out of the file. ` +
      'It is covered, but it can still be extracted — use Redact for anything confidential.')
  }
  if (copied.size) {
    privacy.push(`${pageList(copied)}: the text under a whiteout or an edit was taken off the page, but it belongs to ` +
      'a block that other pages of the file use too, so it is still stored in the file for those.')
  }
  return { blob, warnings: [...privacy, ...warnings] }
}

// How long the saved file may take to be read back before the download is
// handed over without the second opinion.
const READ_BACK_LIMIT = 30000

// A second opinion on the removal, from the file that was actually written:
// the saved bytes are opened afresh and each page that had text taken out is
// walked again. Only the operators the page had to begin with are looked at -
// the replacement text of an edit is drawn inside the very rectangle that was
// emptied, and comes after them. Resolves with the page numbers that still
// have a glyph under a cover. The check is an extra: if it cannot be made, or
// does not come back in time, the file is no worse for it and nothing is
// reported.
async function stillUnder(bytes, scrubbed, openPdf, pdfjsLib) {
  const found = []
  if (!scrubbed.length) return found
  let saved = null
  const look = async () => {
    saved = await openPdf(bytes)
    for (const { position, rects, textOps } of scrubbed) {
      const pdfPage = await saved.getPage(position)
      const hits = await glyphsInRects({ pdfPage, rects, pdfjsLib, limit: textOps })
      if (hits !== 0) found.push(position)
    }
  }
  let timer
  const late = new Promise(resolve => { timer = setTimeout(resolve, READ_BACK_LIMIT) })
  try {
    await Promise.race([look(), late])
  } catch {
    /* the removal itself already went through its own checks */
  }
  clearTimeout(timer)
  try { if (saved) await saved.destroy() } catch { /* nothing to release */ }
  return [...found]
}

// pdf.js lays a page out from its "view": the CropBox clipped to the MediaBox,
// or the MediaBox alone when the two do not overlap, with a missing or empty
// box read as US Letter. UserUnit scales the lot. The editor's pixels come
// from that viewport, so they are mapped back through the very same box - the
// MediaBox height alone is only right for a page that starts at 0,0 and was
// never cropped.
function visibleBox(page, PDFName) {
  const read = get => {
    try {
      const b = get()
      const r = {
        x0: Math.min(b.x, b.x + b.width), y0: Math.min(b.y, b.y + b.height),
        x1: Math.max(b.x, b.x + b.width), y1: Math.max(b.y, b.y + b.height)
      }
      return r.x1 - r.x0 > 0 && r.y1 - r.y0 > 0 ? r : null
    } catch { return null }
  }
  const media = read(() => page.getMediaBox()) || { x0: 0, y0: 0, x1: 612, y1: 792 }
  const crop = read(() => page.getCropBox()) || media
  const cut = {
    x0: Math.max(media.x0, crop.x0), y0: Math.max(media.y0, crop.y0),
    x1: Math.min(media.x1, crop.x1), y1: Math.min(media.y1, crop.y1)
  }
  const box = cut.x1 - cut.x0 > 0 && cut.y1 - cut.y0 > 0 ? cut : media

  let unit = 1
  try {
    const u = page.node.lookup(PDFName.of('UserUnit'))
    const n = u && typeof u.asNumber === 'function' ? u.asNumber() : 1
    if (n > 0) unit = n
  } catch { unit = 1 }

  return { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, unit }
}

// Content streams run to megabytes, so the two character classes that end a
// token are looked up in a table rather than tested one by one.
const SPACE = 1
const DELIMITER = 2
const CHAR = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) CHAR[c] = SPACE
for (const c of '()<>[]{}/%') CHAR[c.charCodeAt(0)] = DELIMITER

// Where the image data after an inline image's ID operator stops: at an EI
// that stands on its own.
function endOfInlineImage(b, from) {
  for (let j = from + 1; j + 1 < b.length; j++) {
    if (b[j] !== 0x45 || b[j + 1] !== 0x49 || CHAR[b[j - 1]] !== SPACE) continue
    if (j + 2 >= b.length || CHAR[b[j + 2]] === SPACE) return j + 2
  }
  return b.length
}

// How many graphics states a page's content leaves open (a q with no Q), and
// how many it closes without having opened. Nothing else is interpreted, but
// strings, names, comments and inline image data have to be stepped over so
// that a "q" inside them is not counted.
function stateBalance(chunks) {
  let open = 0
  let unopened = 0
  let inImage = false
  for (const b of chunks) {
    const n = b.length
    let i = 0
    while (i < n) {
      const c = b[i]
      if (CHAR[c] === SPACE) {
        i++
      } else if (c === 0x25) { // % comment, to the end of the line
        while (i < n && b[i] !== 10 && b[i] !== 13) i++
      } else if (c === 0x28) { // ( string ), which may nest and escape
        let depth = 1
        i++
        while (i < n && depth) {
          if (b[i] === 0x5c) i++
          else if (b[i] === 0x28) depth++
          else if (b[i] === 0x29) depth--
          i++
        }
      } else if (c === 0x3c && b[i + 1] !== 0x3c) { // < hex string >
        while (i < n && b[i] !== 0x3e) i++
        i++
      } else if (c === 0x2f) { // /Name
        i++
        while (i < n && !CHAR[b[i]]) i++
      } else if (CHAR[c] === DELIMITER) {
        i++
      } else {
        const start = i
        while (i < n && !CHAR[b[i]]) i++
        const len = i - start
        const c1 = b[start + 1]
        if (len === 1 && c === 0x71) open++ // q
        else if (len === 1 && c === 0x51) { if (open) open--; else unopened++ } // Q
        else if (len === 2 && c === 0x42 && c1 === 0x49) inImage = true // BI
        else if (len === 2 && c === 0x49 && c1 === 0x44 && inImage) { // ID
          i = endOfInlineImage(b, i)
          inImage = false
        }
      }
    }
  }
  return { open, unopened }
}

// What is drawn for an edit is appended to the page's content, so it starts
// in whatever graphics state that content ends in. pdf-lib brackets the
// existing streams with q ... Q the first time a page is drawn on, which
// undoes a transform the content simply left active. It does not help when
// the content opens more states than it closes: the closing Q then pops one
// of the content's own, and everything added afterwards inherits the scale,
// clip or colour that was current underneath it. So the q's and Q's are
// counted, and as many more are added as it takes to come out level.
function isolateContent(doc, page, lib) {
  const context = doc.context
  const push = context.getPushGraphicsStateContentStream()
  const pop = context.getPopGraphicsStateContentStream()
  try {
    page.node.normalize()
    const contents = page.node.Contents()
    if (!contents || typeof contents.size !== 'function' || !contents.size()) return
    const bracketed = contents.get(0) === push && contents.get(contents.size() - 1) === pop
    if (!bracketed) page.node.wrapContentStreams(push, pop)

    const chunks = []
    for (let i = 1; i < contents.size() - 1; i++) {
      const stream = context.lookup(contents.get(i))
      chunks.push(typeof stream.getUnencodedContents === 'function'
        ? stream.getUnencodedContents()
        : lib.decodePDFRawStream(stream).decode())
    }
    const { open, unopened } = stateBalance(chunks)
    if (unopened) contents.insert(0, context.register(context.stream('q\n'.repeat(unopened))))
    if (open) contents.push(context.register(context.stream('Q\n'.repeat(open))))
  } catch {
    /* content that cannot be read keeps pdf-lib's plain bracket */
  }
}

// What a page may take from the nodes above it in the page tree instead of
// stating it itself.
const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate']

// Rebuilding the page tree in place keeps the AcroForm and every other
// document-level structure attached, which copying pages into a fresh document
// would not.
function applyPageOrder(doc, originals, order, active, degrees, PDFName) {
  const targets = new Map()

  if (!active) {
    order.forEach(e => { if (originals[e.src]) targets.set(e.key, originals[e.src]) })
    return targets
  }

  // entry.rotate already carries the page's own rotation, so it is absolute.
  for (const e of order) {
    if (e.src == null) continue
    const p = originals[e.src]
    if (!p) continue
    p.setRotation(degrees((((e.rotate || 0) % 360) + 360) % 360))
  }

  const sameOrder = order.length === originals.length && order.every((e, i) => e.src === i)
  if (sameOrder) {
    order.forEach(e => targets.set(e.key, originals[e.src]))
    return targets
  }

  // Taking every page out empties the branches of the page tree, pdf-lib
  // prunes an empty branch, and the pages come back directly under the root.
  // Whatever a page inherited from a branch - its size, its fonts - would go
  // with it, so each page is given its own copy of those entries first.
  for (const p of originals) {
    for (const name of INHERITED) {
      const key = PDFName.of(name)
      if (p.node.get(key)) continue
      const value = p.node.getInheritableAttribute(key)
      if (value) p.node.set(key, value)
    }
  }

  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i)
  order.forEach((e, i) => {
    if (e.src == null) {
      const blank = doc.insertPage(i, e.size || [595, 842])
      blank.setRotation(degrees((((e.rotate || 0) % 360) + 360) % 360))
      targets.set(e.key, blank)
    } else {
      doc.insertPage(i, originals[e.src])
      targets.set(e.key, originals[e.src])
    }
  })
  return targets
}

// What a removed page holds that could be read by someone who opens the file
// with something other than a viewer.
const PAGE_CONTENT = ['Contents', 'Resources', 'Annots', 'Thumb', 'Metadata', 'PieceInfo']

// A form field belongs to the document, not to a page, so removing its page
// leaves it in the form - with whatever was typed into it - and nowhere to be
// seen. A field whose every widget sat on a removed page is taken out of the
// form; one that also shows on a page that stays is left as it is.
function forgetFields(doc, removed, { PDFName, PDFArray }) {
  try {
    // Read straight from the catalog: asking the document for its form would
    // create one where there is none.
    const acroForm = doc.catalog.getAcroForm()
    if (!acroForm) return
    const annotations = pages => {
      const found = new Set()
      for (const page of pages) {
        const annots = page.node.Annots()
        for (let i = 0; annots && i < annots.size(); i++) found.add(annots.lookup(i))
      }
      return found
    }
    const lost = annotations(removed)
    const shown = annotations(doc.getPages())
    const dropped = []
    for (const [field, ref] of acroForm.getAllFields()) {
      if (typeof field.getWidgets !== 'function') continue
      const widgets = field.getWidgets().map(w => w.dict)
      if (!widgets.length || !widgets.every(d => lost.has(d) && !shown.has(d))) continue
      acroForm.removeField(field)
      dropped.push(ref)
    }
    // The calculation order names fields by reference, which alone would
    // keep them in the file.
    const order = acroForm.dict.lookup(PDFName.of('CO'))
    if (order instanceof PDFArray) {
      for (let i = order.size() - 1; i >= 0; i--) if (dropped.includes(order.get(i))) order.remove(i)
    }
  } catch {
    /* a form too odd to tidy is left as it was */
  }
}

// A page the user removed is out of the page tree, and no viewer shows it. But
// pdf-lib writes every object it holds, whether anything still leads to it or
// not, so the page's text and pictures would all be in the saved file for
// whoever looks inside - and the file would be no smaller for the deletion.
// The removed pages are emptied, in case a bookmark still points at one, and
// then everything the document can no longer reach from its trailer is
// dropped. What a page shared with the pages that stay is still reachable
// through those, and stays too.
function forgetPages(doc, removed, lib) {
  const { PDFName, PDFInvalidObject } = lib
  const context = doc.context
  // An object pdf-lib could not parse is kept as raw bytes, and what those
  // bytes refer to cannot be seen from here; nothing is safe to drop then.
  if (context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFInvalidObject)) return

  forgetFields(doc, removed, lib)
  for (const page of removed) {
    for (const name of PAGE_CONTENT) page.node.delete(PDFName.of(name))
  }

  const live = reachable(context, lib)
  // A document that cannot be walked from its catalog is not one to tidy.
  if (!live.has(context.trailerInfo.Root)) return
  for (const [ref] of context.enumerateIndirectObjects()) if (!live.has(ref)) context.delete(ref)
}

// The reference of every object the document can still get to from its
// trailer - which is all a reader of the saved file will ever follow.
function reachable(context, { PDFRef, PDFDict, PDFArray, PDFStream }) {
  const found = new Set()
  const todo = Object.values(context.trailerInfo).filter(Boolean)
  while (todo.length) {
    const o = todo.pop()
    if (o instanceof PDFRef) {
      if (found.has(o)) continue
      found.add(o)
      const target = context.lookup(o)
      if (target) todo.push(target)
    } else if (o instanceof PDFDict) {
      for (const value of o.values()) todo.push(value)
    } else if (o instanceof PDFArray) {
      for (const value of o.asArray()) todo.push(value)
    } else if (o instanceof PDFStream) {
      todo.push(o.dict)
    }
  }
  return found
}

// pdf.js names an annotation after its object reference - "12R", or "12R3"
// for a generation other than zero - and that name is what the editor keeps
// for the links it imported.
const annotationId = ref =>
  ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`

// Only the links the editor took over as objects are replaced by what is left
// of those objects. Every other link - a table of contents entry that jumps
// to a page, a named destination, an action - was never shown as editable and
// has to come through untouched. `imported` is the list of pdf.js annotation
// ids the editor took over; a caller that only knows the page was imported
// passes true, which stands for every link that opens a URI.
function writeLinks({ doc, page, objects, X, Y, imported, PDFName, PDFString }) {
  const links = objects.filter(o => o.kind === 'link' && o.url)
  if (!links.length && !imported) return

  const entry = (dict, key) => {
    try { return dict.lookup(PDFName.of(key)) } catch { return undefined }
  }
  const opensUri = dict => {
    const action = entry(dict, 'A')
    return !!action && typeof action.lookup === 'function' && entry(action, 'S') === PDFName.of('URI')
  }
  const takenOver = (ref, dict) => {
    if (entry(dict, 'Subtype') !== PDFName.of('Link')) return false
    if (Array.isArray(imported) && typeof ref.objectNumber === 'number') {
      return imported.includes(annotationId(ref))
    }
    return opensUri(dict)
  }

  const kept = []
  const existing = page.node.Annots()
  if (existing) {
    for (let i = 0; i < existing.size(); i++) {
      const ref = existing.get(i)
      let dict = null
      try { dict = doc.context.lookup(ref) } catch { dict = null }
      const isDict = dict && typeof dict.lookup === 'function'
      if (imported && isDict && takenOver(ref, dict)) continue
      kept.push(ref)
    }
  }
  for (const o of links) {
    const dict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [X(o.x), Y(o.y + o.h), X(o.x + o.w), Y(o.y)],
      Border: [0, 0, 0],
      F: 4,
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(o.url) }
    })
    kept.push(doc.context.register(dict))
  }
  page.node.set(PDFName.of('Annots'), doc.context.obj(kept))
}

function writeNewFields({ getForm, page, objects, X, Y, k }) {
  const fields = objects.filter(o => o.kind === 'field')
  if (!fields.length) return
  let form
  try { form = getForm() } catch { return }
  for (const o of fields) {
    const box = { x: X(o.x), y: Y(o.y + o.h), width: o.w * k, height: o.h * k }
    try {
      if (o.fieldType === 'text' || o.fieldType === 'multiline') {
        const f = form.createTextField(o.name)
        if (o.fieldType === 'multiline') f.enableMultiline()
        if (o.value) f.setText(String(o.value))
        f.addToPage(page, box)
      } else if (o.fieldType === 'check') {
        form.createCheckBox(o.name).addToPage(page, box)
      } else if (o.fieldType === 'dropdown') {
        const f = form.createDropdown(o.name)
        f.addOptions(o.options && o.options.length ? o.options : ['Option 1'])
        f.addToPage(page, box)
      } else if (o.fieldType === 'radio') {
        const f = form.createRadioGroup(o.name)
        const opts = o.options && o.options.length ? o.options : ['Option 1', 'Option 2']
        opts.forEach((opt, i) => {
          f.addOptionToPage(opt, page, { ...box, y: box.y - i * (box.height + 6) })
        })
      }
    } catch {
      /* a name collision or an unsupported field just skips that one */
    }
  }
}

// Values typed into the fields the document already had. Duck-typed because a
// minified build cannot be trusted to keep pdf-lib's class names.
function applyFormValues(getForm, values, warnings) {
  const keys = Object.keys(values || {})
  if (!keys.length) return
  let fields = []
  try { fields = getForm().getFields() } catch { return }

  // Every field the document has arrives here, edited or not. One whose text
  // is what the file already says is left alone, so it keeps the appearance
  // its author gave it instead of having it redrawn in Helvetica - or thrown
  // away, where Helvetica cannot draw it.
  const holds = (field, text) => {
    try { return (field.getText() ?? '') === text } catch { return false }
  }

  for (const field of fields) {
    let name
    try { name = field.getName() } catch { continue }
    if (!(name in values)) continue
    const v = values[name]
    const isText = typeof field.setText === 'function'
    try {
      if (isText) {
        const text = v == null ? '' : String(v)
        if (!holds(field, text)) field.setText(text)
      } else if (typeof field.check === 'function') { if (v) field.check(); else field.uncheck() }
      else if (typeof field.select === 'function') { if (v) field.select(String(v)) }
    } catch {
      // A choice that no longer matches the field's options is dropped without
      // comment, as it always was. Text is only turned down for being longer
      // than the field's own limit, and what was typed is then not in the
      // file, which the user should know.
      if (isText) warnings.push(`The text typed into the field "${name}" is longer than the field allows, so its old value was kept.`)
    }
  }
}

const fieldName = field => {
  try { return field.getName() } catch { return 'unnamed' }
}

// Everything a field's appearance may have to spell out.
function fieldText(field) {
  const parts = []
  for (const get of ['getText', 'getOptions', 'getSelected']) {
    try { if (typeof field[get] === 'function') parts.push(field[get]()) } catch { /* not readable */ }
  }
  return parts.flat().filter(p => typeof p === 'string').join('')
}

// pdf-lib would refresh the appearances itself while saving, but only ever
// with Helvetica, and one value WinAnsi cannot encode makes the whole save
// throw. Going over the fields here lets such a value fall back to the
// bundled Unicode face and, where that has no glyphs for it either or cannot
// be loaded, to the viewer: the stale picture of the old value is removed and
// NeedAppearances asks whoever opens the file to draw the field from its
// value. The value itself is stored in every case.
async function refreshAppearances({ form, covers, uniFont, warnings, PDFName, PDFBool }) {
  let fields = []
  try { fields = form.getFields() } catch { return }
  const standard = form.getDefaultFont()
  const leftToViewer = []

  for (const field of fields) {
    let stale = false
    try { stale = field.needsAppearancesUpdate() } catch { continue }
    if (!stale) continue
    try {
      field.defaultUpdateAppearances(standard)
      continue
    } catch { /* most likely a value outside WinAnsi */ }

    const uni = await uniFont()
    if (uni && covers(uni, fieldText(field))) {
      try {
        field.defaultUpdateAppearances(uni)
        continue
      } catch { /* the viewer is the last resort */ }
    }

    // Only fields that show their value as text have a picture that can go
    // stale; a check box or radio button keeps its on and off states in there.
    const spellsValue = typeof field.getText === 'function' || typeof field.addOptions === 'function'
    if (!spellsValue) continue
    try {
      for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'))
    } catch { /* a field too broken to tidy still gets its value saved */ }
    leftToViewer.push(fieldName(field))
  }

  if (!leftToViewer.length) return
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True)
  warnings.push(
    'Some form values could not be drawn with the built-in fonts, so they were saved for the PDF viewer ' +
    'to display with a font of its own: ' + leftToViewer.map(n => `"${n}"`).join(', ')
  )
}
