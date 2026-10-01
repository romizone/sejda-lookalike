// exportEditedPdf turns the editor's state into the saved file. Every test here
// builds a small document, describes an edit the way the editor would - in
// pdf.js viewport pixels at BASE_SCALE - and reads the result back with pdf.js
// to see where things really ended up.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PDFBool, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { exportEditedPdf, PROTECTED_MESSAGE } from '../src/lib/exporter'
import { cropPdf } from '../src/lib/pdfops'
import { ACT, initialState, reducer } from '../src/store'
import { BASE_SCALE, makePdf, openPdf, pdfjsLib, textOf, textPositions, toBytes, toEditor } from './helpers'

const { OPS, Util } = pdfjsLib

/* ---------- helpers ---------- */

// The bundled faces, read from where the app serves them.
const diskFont = async name => {
  const buf = await readFile(new URL(`../public/fonts/${name}.ttf`, import.meta.url))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}
const offline = async () => { throw new Error('offline') }

const save = async (bytes, pages = {}, extra = {}) => {
  const { blob, warnings } = await exportEditedPdf({ bytes, pages, baseScale: BASE_SCALE, loadFont: offline, ...extra })
  return { blob, warnings, out: await toBytes(blob) }
}

const onPage = (objects = [], lines = []) => ({ 0: { lines, objects } })

const textAt = (at, text = 'ADDED', more = {}) => ({
  id: 't1', kind: 'text', x: at.x, y: at.y, baselineY: at.y, text, fontSize: 24, color: '#000000', ...more
})

// A rectangle given in the page's own coordinates, as the box the editor
// would hold for it.
const editorBox = async (pdf, [x0, y0, x1, y1], pageNo = 1) => {
  const tl = await toEditor(pdf, pageNo, x0, y1)
  const br = await toEditor(pdf, pageNo, x1, y0)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

const near = (a, b, tol = 0.5) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)
const find = (pos, str, pageIndex = 0) => pos.pages[pageIndex].find(t => t.str === str)

const getPage = async (b, pageNo = 1) => (await openPdf(b)).getPage(pageNo)

// The bounding box, in the page's own coordinates, of every path and image the
// page content paints. Annotation appearances are left out.
async function paintedBoxes(b, pageNo = 1) {
  const { fnArray, argsArray } = await (await getPage(b, pageNo)).getOperatorList()
  const boxes = []
  const stack = []
  let ctm = [1, 0, 0, 1, 0, 0]
  let inAnnotation = false
  const add = (x0, y0, x1, y1) => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(p => Util.applyTransform(p, ctm))
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
  }
  fnArray.forEach((fn, i) => {
    const args = argsArray[i]
    if (fn === OPS.beginAnnotation) inAnnotation = true
    else if (fn === OPS.endAnnotation) inAnnotation = false
    else if (inAnnotation) return
    else if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || ctm
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args)
    else if (fn === OPS.constructPath) add(...args[2])
    else if (fn === OPS.paintImageXObject) add(0, 0, 1, 1)
  })
  return boxes
}

const annotations = async (b, pageNo = 1) => (await getPage(b, pageNo)).getAnnotations()

// What a viewer shows inside each form field: the text its appearance stream
// draws, keyed by field name.
async function fieldLooks(b) {
  const page = await getPage(b)
  const names = Object.fromEntries((await page.getAnnotations()).map(a => [a.id, a.fieldName]))
  const { fnArray, argsArray } = await page.getOperatorList()
  const looks = {}
  let name = null
  fnArray.forEach((fn, i) => {
    if (fn === OPS.beginAnnotation) { name = names[argsArray[i][0]]; looks[name] = looks[name] || '' }
    else if (fn === OPS.endAnnotation) name = null
    else if (fn === OPS.showText && name) {
      looks[name] += argsArray[i][0].map(g => (g && typeof g === 'object' ? g.unicode : '')).join('')
    }
  })
  return looks
}

// Each word is drawn on its own, so pdf.js reports the spaces between them too.
const words = async b => (await textOf(b)).replace(/\s+/g, ' ')

const anchorPdf = () => makePdf((p, f) => p.drawText('ANCHOR', { x: 200, y: 500, size: 12, font: f }))

/* ---------- the result ---------- */

describe('what the exporter hands back', () => {
  it('resolves with the document and an empty list of warnings when everything was written', async () => {
    const pdf = await anchorPdf()
    const { blob, warnings, out } = await save(pdf, onPage([textAt({ x: 100, y: 100 }, 'Plain Latin text')]))
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(warnings).toEqual([])
    expect(await words(out)).toContain('Plain Latin text')
  })

  it('takes the pdf.js handles the caller passes without needing them', async () => {
    const pdf = await anchorPdf()
    const { warnings, out } = await save(pdf, onPage([textAt({ x: 100, y: 100 })]), { pdfPages: {}, pdfjsLib })
    expect(warnings).toEqual([])
    expect(await textOf(out)).toContain('ADDED')
  })
})

/* ---------- 1. page box origin ---------- */

describe('page box origin', () => {
  const setBoxes = async (pdf, fn) => {
    const doc = await PDFDocument.load(pdf)
    fn(doc.getPages()[0])
    return (await doc.save()).buffer
  }

  const variants = {
    'a plain page': anchorPdf,
    // The Crop tool moves MediaBox and CropBox together, to x=119 y=252.6 here.
    'a page cropped by the Crop tool': async () =>
      toBytes(await cropPdf(await anchorPdf(), { box: { left: 0.2, right: 0.1, top: 0.1, bottom: 0.3 } })),
    'a CropBox smaller than the MediaBox': async () =>
      setBoxes(await anchorPdf(), p => p.setCropBox(50, 60, 495, 700)),
    'a MediaBox that does not start at the origin': async () =>
      setBoxes(await anchorPdf(), p => p.setMediaBox(-40, 30, 700, 900)),
    'a CropBox that reaches outside the MediaBox': async () =>
      setBoxes(await anchorPdf(), p => p.setCropBox(-30, 100, 430, 700)),
    'a CropBox that misses the MediaBox altogether': async () =>
      setBoxes(await anchorPdf(), p => p.setCropBox(2000, 2000, 100, 100)),
    'a page with a UserUnit': async () =>
      setBoxes(await anchorPdf(), p => {
        p.setCropBox(50, 60, 495, 700)
        p.node.set(PDFName.of('UserUnit'), p.doc.context.obj(2))
      })
  }

  for (const [name, build] of Object.entries(variants)) {
    it(`puts new text exactly where it was placed on ${name}`, async () => {
      const pdf = await build()
      const at = await toEditor(pdf, 1, 200, 500)
      const { out } = await save(pdf, onPage([textAt(at)]))
      const pos = await textPositions(out)
      const word = find(pos, 'ANCHOR')
      const added = find(pos, 'ADDED')
      expect(added).toBeTruthy()
      expect(Math.abs(added.x - word.x)).toBeLessThan(0.5)
      expect(Math.abs(added.y - word.y)).toBeLessThan(0.5)
      // The page boxes themselves are none of the exporter's business.
      const before = (await textPositions(pdf)).boxes[0]
      expect(pos.boxes[0]).toEqual(before)
    })

    it(`puts a link and a rectangle where they were drawn on ${name}`, async () => {
      const pdf = await build()
      const want = [210, 470, 300, 520]
      const box = await editorBox(pdf, want)
      const { out } = await save(pdf, onPage([
        { id: 'k1', kind: 'link', url: 'https://example.com/', ...box },
        { id: 'r1', kind: 'rect', stroke: '#ff0000', strokeWidth: 2, fill: 'none', ...box }
      ]))
      const link = (await annotations(out)).find(a => a.subtype === 'Link')
      expect(link.url).toBe('https://example.com/')
      expect(near(link.rect, want)).toBe(true)
      expect((await paintedBoxes(out)).some(b => near(b, want))).toBe(true)
    })
  }

  it('puts every other kind of object in the right place on a cropped page', async () => {
    const pdf = await variants['a page cropped by the Crop tool']()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const white = [130, 300, 180, 320]
    const mark = [200, 300, 260, 316]
    const image = [300, 300, 350, 360]
    const field = [130, 400, 330, 424]
    const stroke = [400, 300, 450, 340]
    const a = await toEditor(pdf, 1, stroke[0], stroke[1])
    const b = await toEditor(pdf, 1, stroke[2], stroke[3])
    const { out, warnings } = await save(pdf, onPage([
      { id: 'w', kind: 'whiteout', ...(await editorBox(pdf, white)) },
      { id: 'm', kind: 'mark', variant: 'highlight', ...(await editorBox(pdf, mark)) },
      { id: 'i', kind: 'image', src: png, ...(await editorBox(pdf, image)) },
      { id: 'f', kind: 'field', fieldType: 'text', name: 'text_f', value: '', ...(await editorBox(pdf, field)) },
      { id: 'l', kind: 'line', stroke: '#0000ff', strokeWidth: 2, x: a.x, y: a.y, x1: b.x, y1: b.y }
    ]))
    expect(warnings).toEqual([])
    const boxes = await paintedBoxes(out)
    const has = want => boxes.some(box => near(box, want))
    // A whiteout is drawn a point larger all round so no hairline shows.
    expect(has([white[0] - 1, white[1] - 1, white[2] + 1, white[3] + 1])).toBe(true)
    expect(has(mark)).toBe(true)
    expect(has(image)).toBe(true)
    expect(has(stroke)).toBe(true)
    const widget = (await annotations(out)).find(x => x.subtype === 'Widget')
    // pdf-lib grows a widget by half its border width on each side.
    expect(near(widget.rect, field, 1)).toBe(true)
  })

  it('still writes onto a blank page the editor inserted', async () => {
    const pdf = await anchorPdf()
    const { out } = await save(pdf, {
      0: { lines: [], objects: [] },
      blank: { lines: [], objects: [textAt({ x: 100, y: 200 }, 'BLANK')] }
    }, {
      pageOrder: [{ key: 0, src: 0, rotate: 0 }, { key: 'blank', src: null, rotate: 0, size: [300, 400] }]
    })
    const pos = await textPositions(out)
    expect(pos.pages.length).toBe(2)
    const added = find(pos, 'BLANK', 1)
    expect(Math.abs(added.x - 50)).toBeLessThan(0.5)
    expect(Math.abs(added.y - 300)).toBeLessThan(0.5)
  })
})

/* ---------- 2. links ---------- */

describe('links that were already in the document', () => {
  const RECT = { dest: [50, 700, 150, 720], goto: [50, 660, 150, 680], uri: [50, 620, 150, 640], relative: [50, 580, 150, 600] }

  const linkPdf = (withRelative = false) => makePdf((page, font, doc) => {
    const link = (rect, extra) => doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...extra
    }))
    const all = [
      link(RECT.dest, { Dest: [page.ref, 'Fit'] }),
      link(RECT.goto, { A: { Type: 'Action', S: 'GoTo', D: [page.ref, 'Fit'] } }),
      link(RECT.uri, { A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') } })
    ]
    if (withRelative) all.push(link(RECT.relative, { A: { Type: 'Action', S: 'URI', URI: PDFString.of('chapter2.html') } }))
    page.node.set(PDFName.of('Annots'), doc.context.obj(all))
  })

  // What App.jsx does when a file is opened: the links pdf.js reports a URL
  // for become editable objects, and their annotation ids are remembered.
  const importLinks = async pdf => {
    const page = await getPage(pdf)
    const vp = page.getViewport({ scale: BASE_SCALE, rotation: 0 })
    const links = (await page.getAnnotations({ intent: 'display' })).filter(a => a.subtype === 'Link' && a.url)
    const objects = links.map((a, i) => {
      const r = vp.convertToViewportRectangle(a.rect)
      return {
        id: `K0_${i}`, kind: 'link', url: a.url, imported: true,
        x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1])
      }
    })
    return { objects, ids: links.map(a => a.id) }
  }

  const linksOf = async b => (await annotations(b)).filter(a => a.subtype === 'Link')
  const internal = links => links.filter(a => a.dest)
  const external = links => links.filter(a => a.url || a.unsafeUrl)

  it('keeps links that jump inside the document when nothing was edited', async () => {
    const pdf = await linkPdf()
    const { objects } = await importLinks(pdf)
    expect(objects.length).toBe(1)
    const { out } = await save(pdf, onPage(objects), { linkPages: { 0: true } })
    const links = await linksOf(out)
    expect(internal(links).map(a => a.rect)).toEqual([RECT.dest, RECT.goto])
    expect(external(links).length).toBe(1)
    expect(external(links)[0].url).toBe('https://example.com/')
    expect(near(external(links)[0].rect, RECT.uri)).toBe(true)
  })

  it('removes only the link whose object the user deleted', async () => {
    const pdf = await linkPdf()
    const { out } = await save(pdf, onPage([]), { linkPages: { 0: true } })
    const links = await linksOf(out)
    expect(internal(links).map(a => a.rect)).toEqual([RECT.dest, RECT.goto])
    expect(external(links)).toEqual([])
  })

  it('writes an edited address once, in place of the original', async () => {
    const pdf = await linkPdf()
    const { objects, ids } = await importLinks(pdf)
    const edited = objects.map(o => ({ ...o, url: 'https://changed.example/' }))
    const { out } = await save(pdf, onPage(edited), { linkPages: { 0: ids } })
    const links = await linksOf(out)
    expect(internal(links).length).toBe(2)
    expect(external(links).map(a => a.url)).toEqual(['https://changed.example/'])
  })

  it('leaves alone a link the editor never imported, whatever its action', async () => {
    // pdf.js gives no usable URL for a relative address, so the editor never
    // shows this link - and so must not delete it either.
    const pdf = await linkPdf(true)
    const { objects, ids } = await importLinks(pdf)
    expect(objects.length).toBe(1)
    const kept = await save(pdf, onPage(objects), { linkPages: { 0: ids } })
    expect(external(await linksOf(kept.out)).map(a => a.unsafeUrl).sort()).toEqual(['chapter2.html', 'https://example.com/'])
    const removed = await save(pdf, onPage([]), { linkPages: { 0: ids } })
    const links = await linksOf(removed.out)
    expect(external(links).map(a => a.unsafeUrl)).toEqual(['chapter2.html'])
    expect(internal(links).length).toBe(2)
  })

  it('does not touch the annotations of a page that was not imported', async () => {
    const pdf = await linkPdf()
    const { out } = await save(pdf, onPage([textAt({ x: 100, y: 100 })]))
    const links = await linksOf(out)
    expect(internal(links).length).toBe(2)
    expect(external(links).length).toBe(1)
  })
})

/* ---------- 3. form values ---------- */

describe('form values', () => {
  const formPdf = async (extra) => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const form = doc.getForm()
    const name = form.createTextField('name')
    name.setText('old value')
    name.addToPage(page, { x: 50, y: 700, width: 300, height: 24 })
    form.createCheckBox('agree').addToPage(page, { x: 50, y: 650, width: 16, height: 16 })
    const pick = form.createDropdown('pick')
    pick.addOptions(['Alpha', 'Beta', 'Gamma'])
    pick.select('Alpha')
    pick.addToPage(page, { x: 50, y: 600, width: 200, height: 24 })
    const size = form.createRadioGroup('size')
    size.addOptionToPage('Small', page, { x: 50, y: 550, width: 16, height: 16 })
    size.addOptionToPage('Large', page, { x: 80, y: 550, width: 16, height: 16 })
    if (extra) await extra(doc, page, form)
    return (await doc.save()).buffer
  }

  const reload = async out => {
    const doc = await PDFDocument.load(out)
    return { doc, form: doc.getForm() }
  }
  const needAppearances = form => form.acroForm.dict.lookup(PDFName.of('NeedAppearances')) === PDFBool.True
  const hasAppearance = field => field.acroField.getWidgets().every(w => !!w.dict.lookup(PDFName.of('AP')))

  it('saves ordinary values and draws them, as before', async () => {
    const pdf = await formPdf()
    const { out, warnings } = await save(pdf, {}, {
      formValues: { name: 'Jane Doe', agree: true, pick: 'Beta', size: 'Large' }
    })
    expect(warnings).toEqual([])
    const { form } = await reload(out)
    expect(form.getTextField('name').getText()).toBe('Jane Doe')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(form.getDropdown('pick').getSelected()).toEqual(['Beta'])
    expect(form.getRadioGroup('size').getSelected()).toBe('Large')
    expect(needAppearances(form)).toBe(false)
    const looks = await fieldLooks(out)
    expect(looks.name).toBe('Jane Doe')
    expect(looks.pick).toBe('Beta')
  })

  it('unchecks a box and clears a text field', async () => {
    const pdf = await formPdf((doc, page, form) => form.getCheckBox('agree').check())
    const { out } = await save(pdf, {}, { formValues: { name: '', agree: false } })
    const { form } = await reload(out)
    expect(form.getTextField('name').getText()).toBeUndefined()
    expect(form.getCheckBox('agree').isChecked()).toBe(false)
    expect((await fieldLooks(out)).name).toBe('')
  })

  it('draws a value outside WinAnsi with the bundled Unicode face', async () => {
    const pdf = await formPdf()
    const { out, warnings } = await save(pdf, {}, {
      formValues: { name: 'Ānanda Привет', agree: true }, loadFont: diskFont
    })
    expect(warnings).toEqual([])
    const { form } = await reload(out)
    expect(form.getTextField('name').getText()).toBe('Ānanda Привет')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(needAppearances(form)).toBe(false)
    expect((await fieldLooks(out)).name).toBe('Ānanda Привет')
  })

  it('saves a value no built-in font can draw and leaves its appearance to the viewer', async () => {
    const pdf = await formPdf()
    const { out, warnings } = await save(pdf, {}, {
      formValues: { name: 'Ānanda 日本', agree: true, pick: 'Gamma' }, loadFont: diskFont
    })
    const { form } = await reload(out)
    expect(form.getTextField('name').getText()).toBe('Ānanda 日本')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(form.getDropdown('pick').getSelected()).toEqual(['Gamma'])
    expect(needAppearances(form)).toBe(true)
    // The picture of the old value must not outlive the value.
    expect(hasAppearance(form.getTextField('name'))).toBe(false)
    expect(hasAppearance(form.getCheckBox('agree'))).toBe(true)
    expect((await fieldLooks(out)).pick).toBe('Gamma')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('"name"')
    // And a viewer does read the value back.
    expect((await annotations(out)).find(a => a.fieldName === 'name').fieldValue).toBe('Ānanda 日本')
  })

  it('treats a font that cannot be fetched like a font that is not there', async () => {
    const pdf = await formPdf()
    for (const loadFont of [offline, undefined]) {
      // undefined exercises the real loader, whose fetch has nothing to reach here.
      const { blob, warnings } = await exportEditedPdf({
        bytes: pdf, pages: {}, baseScale: BASE_SCALE, formValues: { name: 'Ānanda', agree: true }, loadFont
      })
      const { form } = await reload(await toBytes(blob))
      expect(form.getTextField('name').getText()).toBe('Ānanda')
      expect(form.getCheckBox('agree').isChecked()).toBe(true)
      expect(needAppearances(form)).toBe(true)
      expect(warnings.length).toBe(1)
    }
  })

  it('leaves a field whose value was not changed exactly as it was', async () => {
    // A value drawn by its author in a font of their own: redrawing it in
    // Helvetica is impossible and throwing the appearance away would be a loss.
    const pdf = await formPdf(async (doc, page, form) => {
      doc.registerFontkit(fontkit)
      const face = await doc.embedFont(await diskFont('LiberationSerif-Regular'))
      const city = form.createTextField('city')
      city.setText('Москва')
      city.addToPage(page, { x: 50, y: 500, width: 200, height: 24, font: face })
      city.updateAppearances(face)
    })
    const seeded = { name: 'old value', city: 'Москва', agree: false, pick: 'Alpha', size: '' }
    const { out, warnings } = await save(pdf, {}, { formValues: seeded })
    expect(warnings).toEqual([])
    const { form } = await reload(out)
    expect(needAppearances(form)).toBe(false)
    expect(form.getTextField('city').getText()).toBe('Москва')
    const looks = await fieldLooks(out)
    expect(looks.city).toBe('Москва')
    expect(looks.name).toBe('old value')
  })

  it('says so when a field refuses what was typed into it', async () => {
    const pdf = await formPdf((doc, page, form) => {
      const code = form.createTextField('code')
      code.setMaxLength(3)
      code.setText('abc')
      code.addToPage(page, { x: 50, y: 500, width: 100, height: 24 })
    })
    const { out, warnings } = await save(pdf, {}, { formValues: { code: 'abcdef', name: 'Jane' } })
    const { form } = await reload(out)
    expect(form.getTextField('code').getText()).toBe('abc')
    expect(form.getTextField('name').getText()).toBe('Jane')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('"code"')
  })

  it('adds new fields next to filled-in ones', async () => {
    const pdf = await formPdf()
    const { out, warnings } = await save(pdf, onPage([
      { id: 'f1', kind: 'field', fieldType: 'text', name: 'text_f1', value: '', x: 100, y: 1000, w: 300, h: 40 },
      { id: 'f2', kind: 'field', fieldType: 'check', name: 'check_f2', x: 100, y: 1100, w: 30, h: 30 }
    ]), { formValues: { name: 'Jane Doe' } })
    expect(warnings).toEqual([])
    const { form } = await reload(out)
    expect(form.getFields().map(f => f.getName()).sort()).toEqual(['agree', 'check_f2', 'name', 'pick', 'size', 'text_f1'])
    expect(form.getTextField('name').getText()).toBe('Jane Doe')
  })
})

/* ---------- 4. protected files ---------- */

describe('a file protected by its owner', () => {
  const protectedPdf = async () => {
    const { PDFDocument: Cantoo, StandardFonts: Fonts } = await import('@cantoo/pdf-lib')
    const doc = await Cantoo.create()
    const font = await doc.embedFont(Fonts.Helvetica)
    doc.addPage([595, 842]).drawText('ANCHOR', { x: 200, y: 500, size: 12, font })
    doc.encrypt({ userPassword: '', ownerPassword: 'owner', permissions: { modifying: false } })
    return (await doc.save({ useObjectStreams: false })).buffer
  }

  it('opens without a password, and pdf.js says it is encrypted', async () => {
    // This is what App.jsx looks at when the file is opened.
    const pdf = await protectedPdf()
    expect(await textOf(pdf)).toContain('ANCHOR')
    expect((await (await openPdf(pdf)).getMetadata()).info.EncryptFilterName).toBe('Standard')
    expect((await (await openPdf(await anchorPdf())).getMetadata()).info.EncryptFilterName).toBeFalsy()
  })

  it('is refused with a clear message instead of being saved as garbage', async () => {
    const pdf = await protectedPdf()
    const at = await toEditor(pdf, 1, 200, 500)
    await expect(save(pdf, onPage([textAt(at)]))).rejects.toThrow(PROTECTED_MESSAGE)
    expect(PROTECTED_MESSAGE).toMatch(/protected against changes by its owner/)
  })
})

/* ---------- 5. stray graphics state ---------- */

describe('content that leaves graphics state behind', () => {
  // Each stream draws ANCHOR at 200,500 in 12pt by way of a half-size
  // transform that is never undone.
  const SHOW = 'BT /F1 24 Tf 400 1000 Td (ANCHOR) Tj ET\n'
  const HALF = '0.5 0 0 0.5 0 0 cm\n'

  const rawPdf = async (streams, compress = false) => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([595, 842])
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }))
    const refs = streams.map(s => doc.context.register(compress ? doc.context.flateStream(s) : doc.context.stream(s)))
    page.node.set(PDFName.of('Contents'), refs.length > 1 ? doc.context.obj(refs) : refs[0])
    return (await doc.save()).buffer
  }

  // The page's content streams as text; the ones pdf-lib compresses - its own
  // q, Q and the edit - are of no interest here and come back as null.
  const contentsOf = async out => {
    const doc = await PDFDocument.load(out)
    const contents = doc.getPages()[0].node.Contents()
    return Array.from({ length: contents.size() }, (_, i) => {
      const stream = doc.context.lookup(contents.get(i))
      return stream.dict.has(PDFName.of('Filter')) ? null : new TextDecoder().decode(stream.contents)
    })
  }

  // open: states the content leaves open; unopened: states it closes without
  // having opened them.
  const cases = {
    'a transform with no q/Q around it, in one stream': { streams: [HALF + SHOW] },
    'a transform with no q/Q around it, in an array of streams': { streams: [HALF, SHOW] },
    'a q that is never closed': { streams: [HALF + 'q\n' + SHOW], open: 1 },
    'several q that are never closed': { streams: ['q\n' + HALF + 'q 1 0 0 1 0 0 cm q\n', SHOW], open: 3 },
    'a Q too many before the transform': { streams: ['Q\n' + HALF + SHOW], unopened: 1 },
    'a Q too many and a q left open': { streams: ['Q Q\n' + HALF + 'q\n' + SHOW], open: 1, unopened: 2 }
  }

  for (const [name, { streams, open = 0, unopened = 0 }] of Object.entries(cases)) {
    it(`draws an edit at its own place and size after ${name}`, async () => {
      const pdf = await rawPdf(streams)
      const at = await toEditor(pdf, 1, 200, 500)
      const { out } = await save(pdf, onPage([textAt(at)]))
      const pos = await textPositions(out)
      const word = find(pos, 'ANCHOR')
      const added = find(pos, 'ADDED')
      expect(Math.abs(word.x - 200)).toBeLessThan(0.5)
      expect(Math.abs(added.x - word.x)).toBeLessThan(0.5)
      expect(Math.abs(added.y - word.y)).toBeLessThan(0.5)
      const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
      expect(Math.abs(added.w - font.widthOfTextAtSize('ADDED', 12))).toBeLessThan(0.1)
      // The original streams, the q and Q pdf-lib puts around them, the edit -
      // and exactly as many more q and Q as it takes to come out level.
      const contents = await contentsOf(out)
      expect(contents.length).toBe(streams.length + 3 + (open ? 1 : 0) + (unopened ? 1 : 0))
      if (unopened) expect(contents[0]).toBe('q\n'.repeat(unopened))
      if (open) expect(contents[contents.length - 2]).toBe('Q\n'.repeat(open))
      expect(contents.filter(c => c !== null && !/^[qQ\n]+$/.test(c))).toEqual(streams)
    })
  }

  it('reads compressed content just the same', async () => {
    const pdf = await rawPdf([HALF + 'q\n', 'q\n' + SHOW], true)
    const at = await toEditor(pdf, 1, 200, 500)
    const { out } = await save(pdf, onPage([textAt(at)]))
    const pos = await textPositions(out)
    expect(Math.abs(find(pos, 'ADDED').x - 200)).toBeLessThan(0.5)
    expect(Math.abs(find(pos, 'ADDED').y - 500)).toBeLessThan(0.5)
    const contents = await contentsOf(out)
    expect(contents.length).toBe(6)
    expect(contents[4]).toBe('Q\nQ\n')
  })

  it('is not fooled by a q inside a string, a name, a comment or image data', async () => {
    const decoys =
      '% q q q\n' +
      '/q BMC EMC\n' +
      'BT /F1 8 Tf 10 10 Td (q \\( q \\) (q) q) Tj <71207120> Tj ET\n' +
      'BI /W 1 /H 1 /BPC 8 /CS /G ID q EI\n' +
      'q 1 0 0 1 0 0 cm Q\n'
    const pdf = await rawPdf([decoys + HALF + SHOW])
    const at = await toEditor(pdf, 1, 200, 500)
    const { out } = await save(pdf, onPage([textAt(at)]))
    const pos = await textPositions(out)
    expect(Math.abs(find(pos, 'ADDED').x - 200)).toBeLessThan(0.5)
    expect(Math.abs(find(pos, 'ADDED').y - 500)).toBeLessThan(0.5)
    // Balanced content gets pdf-lib's bracket and nothing more.
    expect((await contentsOf(out)).length).toBe(4)
  })

  it('leaves the content of a page it does not draw on alone', async () => {
    const pdf = await rawPdf([HALF + 'q\n' + SHOW])
    const box = await editorBox(pdf, [100, 100, 200, 120])
    const { out } = await save(pdf, onPage([{ id: 'k', kind: 'link', url: 'https://example.com/', ...box }]))
    const doc = await PDFDocument.load(out)
    expect(doc.getPages()[0].node.Contents().constructor.name).not.toBe('PDFArray')
  })
})

/* ---------- 6. characters that cannot be drawn ---------- */

describe('characters the fonts cannot draw', () => {
  it('names the characters the bundled faces do not have', async () => {
    const pdf = await anchorPdf()
    const { out, warnings } = await save(pdf, onPage([textAt({ x: 100, y: 100 }, 'Tokyo 日本 東京 日')]), { loadFont: diskFont })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/built-in fonts do not include them: 日 本 東 京$/)
    expect(await textOf(out)).toContain('Tokyo')
  })

  it('reports them for an existing line that was edited, too', async () => {
    const pdf = await anchorPdf()
    const at = await toEditor(pdf, 1, 200, 500)
    const line = {
      id: 'L1', dirty: true, text: 'مرحبا', x: at.x, y: at.y - 24, baselineY: at.y, fontSize: 24,
      color: '#000000', bg: '#ffffff', rect: { x: at.x, y: at.y - 24, w: 120, h: 30 }
    }
    const { warnings } = await save(pdf, onPage([], [line]), { loadFont: diskFont })
    expect(warnings.length).toBe(1)
    for (const ch of new Set('مرحبا')) expect(warnings[0]).toContain(ch)
  })

  it('says nothing when the Unicode face has every character', async () => {
    const pdf = await anchorPdf()
    const { out, warnings } = await save(pdf, onPage([textAt({ x: 100, y: 100 }, 'Привет, Ānanda — «ок»')]), { loadFont: diskFont })
    expect(warnings).toEqual([])
    const text = await textOf(out)
    expect(text).toContain('Привет,')
    expect(text).toContain('Ānanda')
  })

  it('says which characters became "?" when the Unicode face cannot be loaded', async () => {
    const pdf = await anchorPdf()
    for (const loadFont of [offline, async () => new ArrayBuffer(16), undefined]) {
      const { blob, warnings } = await exportEditedPdf({
        bytes: pdf, baseScale: BASE_SCALE, loadFont,
        pages: onPage([textAt({ x: 100, y: 100 }, 'Ānanda Привет')])
      })
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toMatch(/could not be loaded/)
      expect(warnings[0]).toContain('Ā')
      expect(warnings[0]).toContain('П')
      expect(await textOf(await toBytes(blob))).toContain('?nanda')
    }
  })

  it('lists a long run of missing characters only in part', async () => {
    const pdf = await anchorPdf()
    const cjk = '一二三四五六七八九十百千万円時日本語東京大阪'
    const { warnings } = await save(pdf, onPage([textAt({ x: 100, y: 100 }, cjk)]), { loadFont: diskFont })
    expect(warnings[0]).toMatch(/and \d+ more$/)
  })

  it('says so when an image could not be read', async () => {
    const pdf = await anchorPdf()
    const broken = 'data:image/png;base64,' + btoa('\x89Pnot really a png')
    const { warnings } = await save(pdf, onPage([{ id: 'i', kind: 'image', src: broken, x: 10, y: 10, w: 50, h: 50 }]))
    expect(warnings).toEqual(['One image could not be read and was left out.'])
  })
})

/* ---------- 7. undo after Delete ---------- */

describe('undo after removing an object with the Delete key', () => {
  // The key handler in App.jsx now sends these two actions; without the first,
  // Undo went back past the removal to whatever was done before it.
  it('brings back the object and nothing else', () => {
    const obj = id => ({ id, kind: 'rect', x: 0, y: 0, w: 10, h: 10 })
    let s = reducer(initialState, { type: ACT.OPEN_DONE, fileName: 'a.pdf', numPages: 1 })
    s = reducer(s, { type: ACT.PUSH })
    s = reducer(s, { type: ACT.OBJ_ADD, page: 0, obj: obj('a') })
    s = reducer(s, { type: ACT.PUSH })
    s = reducer(s, { type: ACT.OBJ_ADD, page: 0, obj: obj('b') })
    s = reducer(s, { type: ACT.SELECT, sel: { kind: 'obj', page: 0, id: 'b' } })

    s = reducer(s, { type: ACT.PUSH })
    s = reducer(s, { type: ACT.OBJ_REMOVE, page: 0, id: 'b' })
    expect(s.pages[0].objects.map(o => o.id)).toEqual(['a'])

    s = reducer(s, { type: ACT.UNDO })
    expect(s.pages[0].objects.map(o => o.id)).toEqual(['a', 'b'])
  })
})
