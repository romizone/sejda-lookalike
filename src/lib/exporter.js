import { hexToRgb01, sanitizeWinAnsi, slackOf } from '../utils/misc'
import { sampleTextColor } from './colors'
import { STD, LIBERATION, winAnsiCanEncode, styleIndex, fontUrl } from './fonts'

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

function tokenize(text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i) out.push('\n')
    for (const t of line.split(/(\s+)/)) if (t !== '') out.push(t)
  })
  return out
}

export async function exportEditedPdf({
  bytes, pages, baseScale, canvases, dpr = 1,
  formValues = {}, linkPages = {}, pageOrder = null
}) {
  const { PDFDocument, rgb, degrees, PDFName, PDFString } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })

  const stdCache = new Map()
  const uniCache = new Map()
  let fontkitReady = false

  const embedStd = async name => {
    if (!stdCache.has(name)) stdCache.set(name, await doc.embedFont(name))
    return stdCache.get(name)
  }

  // Standard fonts cost nothing and keep the original metrics, so they stay the
  // default; a Liberation face is only fetched when the text uses characters
  // WinAnsi cannot represent.
  const getFont = async (fam, bold, italic, text) => {
    const idx = styleIndex(bold, italic)
    const family = STD[fam] ? fam : 'sans-serif'
    if (!winAnsiCanEncode(text)) {
      const name = LIBERATION[family][idx]
      try {
        if (!uniCache.has(name)) {
          if (!fontkitReady) {
            const fontkit = (await import('@pdf-lib/fontkit')).default
            doc.registerFontkit(fontkit)
            fontkitReady = true
          }
          const res = await fetch(fontUrl(name))
          if (!res.ok) throw new Error(`font ${name} unavailable`)
          uniCache.set(name, await doc.embedFont(await res.arrayBuffer(), { subset: true }))
        }
        return { font: uniCache.get(name), std: false }
      } catch {
        /* fall through to the standard font, which will lose those glyphs */
      }
    }
    return { font: await embedStd(STD[family][idx]), std: true }
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
  const targets = applyPageOrder(doc, originals, order, pageOrder && pageOrder.length, degrees)

  for (const entry of order) {
    const page = targets.get(entry.key)
    if (!page) continue
    const pe = pages[entry.key]
    const { height: PH } = page.getSize()
    const k = 1 / baseScale
    const X = v => v * k
    const Y = v => PH - v * k

    if (!pe || (!pe.lines.length && !pe.objects.length)) continue

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
              } catch { /* nothing sensible left to draw */ }
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

    for (const o of pe.objects) {
      if (o.kind === 'whiteout') cover(o, '#ffffff')
    }
    for (const ln of pe.lines) {
      if (ln.deleted) cover(ln.rect, ln.bg)
      else if (ln.dirty) cover(patchRect(ln), ln.bg)
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
      replaceExisting: entry.src != null && !!linkPages[entry.src],
      PDFName, PDFString
    })
    writeNewFields({ doc, page, objects: pe.objects, X, Y, k })
  }

  applyFormValues(doc, formValues)

  const out = await doc.save({ useObjectStreams: false })
  return new Blob([out], { type: 'application/pdf' })
}

// Rebuilding the page tree in place keeps the AcroForm and every other
// document-level structure attached, which copying pages into a fresh document
// would not.
function applyPageOrder(doc, originals, order, active, degrees) {
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

function writeLinks({ doc, page, objects, X, Y, replaceExisting, PDFName, PDFString }) {
  const links = objects.filter(o => o.kind === 'link' && o.url)
  if (!links.length && !replaceExisting) return
  const kept = []
  const existing = page.node.Annots()
  if (existing) {
    for (let i = 0; i < existing.size(); i++) {
      const ref = existing.get(i)
      let sub = null
      try { sub = doc.context.lookup(ref)?.get(PDFName.of('Subtype')) } catch { sub = null }
      const isLink = sub === PDFName.of('Link')
      if (replaceExisting && isLink) continue
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

function writeNewFields({ doc, page, objects, X, Y, k }) {
  const fields = objects.filter(o => o.kind === 'field')
  if (!fields.length) return
  let form
  try { form = doc.getForm() } catch { return }
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
function applyFormValues(doc, values) {
  const keys = Object.keys(values || {})
  if (!keys.length) return
  let form
  try { form = doc.getForm() } catch { return }
  let fields = []
  try { fields = form.getFields() } catch { return }
  for (const field of fields) {
    let name
    try { name = field.getName() } catch { continue }
    if (!(name in values)) continue
    const v = values[name]
    try {
      if (typeof field.setText === 'function') field.setText(v == null ? '' : String(v))
      else if (typeof field.check === 'function') { if (v) field.check(); else field.uncheck() }
      else if (typeof field.select === 'function') { if (v) field.select(String(v)) }
    } catch {
      /* value that no longer matches the field's options */
    }
  }
  try { form.updateFieldAppearances() } catch {}
}
