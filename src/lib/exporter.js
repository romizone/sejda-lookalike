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

export async function exportEditedPdf({ bytes, pages, baseScale, canvases, dpr = 1, formValues = {}, linkPages = {} }) {
  const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = await import('pdf-lib')
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

    writeLinks({ doc, page, objects: pe.objects, X, Y, replaceExisting: !!linkPages[pi], PDFName, PDFString })
    writeNewFields({ doc, page, objects: pe.objects, X, Y, k })
  }

  applyFormValues(doc, formValues)

  const out = await doc.save({ useObjectStreams: false })
  return new Blob([out], { type: 'application/pdf' })
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
