// The editor from end to end. A document is opened the way App.jsx opens it,
// edited through the same reducer the interface dispatches to, saved with
// exportEditedPdf, and the SAVED file is read back with pdf.js. Text that was
// covered - by a whiteout, a deleted line or an edited one - has to be gone
// from the file, and everything else has to be exactly where it was.
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib'
import { exportEditedPdf } from '../src/lib/exporter'
import { extractLines } from '../src/lib/extract'
import { cropPdf } from '../src/lib/pdfops'
import { makeSamplePdf } from '../src/lib/sample'
import { ACT, initialState, reducer } from '../src/store'
import { BASE_SCALE, makePdf, openPdf, pdfjsLib, textOf, textPositions, toBytes, toEditor } from './helpers'

const { OPS, Util } = pdfjsLib

/* ---------- helpers ---------- */

const N = s => PDFName.of(s)
const latin1 = b => Array.from(b, c => String.fromCharCode(c)).join('')
const hexOf = s => Array.from(s, ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase()
const offline = async () => { throw new Error('offline') }

const EXPOSED = 'the text under a whiteout or an edit could not be taken out of the file. ' +
  'It is covered, but it can still be extracted — use Redact for anything confidential.'

// What App.jsx holds once a file is open: the pdf.js pages by source index,
// and a state whose lines came from extractLines and whose page order carries
// each page's own rotation. `act` is its dispatch.
async function openInEditor(bytes) {
  const pdf = await openPdf(bytes)
  const ed = {
    bytes,
    pdfPages: {},
    state: reducer(initialState, { type: ACT.OPEN_DONE, fileName: 'test.pdf', numPages: pdf.numPages }),
    act: action => { ed.state = reducer(ed.state, action) },
    line: (page, part) => ed.state.pages[page].lines.find(l => l.text.includes(part))
  }
  const rotations = {}
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1)
    ed.pdfPages[i] = page
    rotations[i] = (((page.rotate || 0) % 360) + 360) % 360
    ed.act({ type: ACT.SET_LINES, page: i, lines: await extractLines(page, BASE_SCALE, i) })
  }
  ed.act({
    type: ACT.PAGES_SET, seed: true,
    order: ed.state.pageOrder.map(e => (rotations[e.src] ? { ...e, rotate: rotations[e.src] } : e))
  })
  return ed
}

// A stand-in for the openPdf App.jsx passes, that also notes what was asked
// of it.
function reader(open = openPdf) {
  const asked = { opened: 0, pages: [], released: 0 }
  const read = async b => {
    asked.opened++
    const doc = await open(b)
    const getPage = doc.getPage.bind(doc)
    const destroy = doc.destroy.bind(doc)
    doc.getPage = n => { asked.pages.push(n); return getPage(n) }
    doc.destroy = () => { asked.released++; return destroy() }
    return doc
  }
  return { read, asked }
}

async function save(ed, extra = {}) {
  const { blob, warnings } = await exportEditedPdf({
    bytes: ed.bytes,
    pages: ed.state.pages,
    baseScale: BASE_SCALE,
    formValues: ed.state.formValues,
    pageOrder: ed.state.pageOrder,
    pdfPages: ed.pdfPages,
    pdfjsLib,
    loadFont: offline,
    ...extra
  })
  return { warnings, out: await toBytes(blob) }
}

// A rectangle given in the page's own coordinates, as the box the editor
// would hold for it.
async function editorBox(pdf, [x0, y0, x1, y1], pageNo = 1) {
  const tl = await toEditor(pdf, pageNo, x0, y1)
  const br = await toEditor(pdf, pageNo, x1, y0)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

// The box a user would drag around one run of text: a little wider than the
// word, from just under the baseline to just over the capitals.
const around = (run, size = 10.5) => [run.x - 2, run.y - 0.25 * size, run.x + run.w + 2, run.y + 0.95 * size]

let nextId = 0
const whiteout = (ed, page, box) =>
  ed.act({ type: ACT.OBJ_ADD, page, obj: { id: `w${nextId++}`, kind: 'whiteout', ...box } })

// What the format bar's Delete does to an existing line, and what typing does.
const deleteLine = (ed, page, ln) =>
  ed.act({ type: ACT.OBJ_REMOVE, page, id: '__none__', lineId: ln.id })
const retype = (ed, page, ln, text) =>
  ed.act({ type: ACT.TEXT_PATCH, page, kind: 'line', id: ln.id, patch: { text, runs: undefined } })

const runsOf = async bytes => (await textPositions(bytes)).pages

// The text of each page. The exporter draws every word on its own, and pdf.js
// reports the gaps between them as runs of spaces.
const pagesOf = async bytes => (await textOf(bytes)).split('\n').map(t => t.replace(/\s+/g, ' '))
const runNamed = (runs, str) => runs.find(r => r.str === str)

// Every run of text still on the page sits where it sat before. Runs for which
// `isNew` answers true are what the edit itself wrote and are left out.
function expectUnmoved(before, after, isNew = () => false) {
  for (const run of after) {
    if (isNew(run)) continue
    const was = before.some(b => b.str === run.str && Math.abs(b.x - run.x) < 0.01 && Math.abs(b.y - run.y) < 0.01)
    expect(was, `"${run.str}" at ${run.x.toFixed(2)},${run.y.toFixed(2)} was not there before`).toBe(true)
  }
}

// Every stream in the file, decoded - where a forensic look would search.
async function allStreams(bytes) {
  const doc = await PDFDocument.load(bytes)
  const out = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    try { out.push(latin1(decodePDFRawStream(obj).decode())) } catch { out.push(latin1(obj.contents)) }
  }
  return out
}

// pdf-lib writes text as hex strings and a hand-written stream as literals, so
// both spellings are looked for.
async function expectNowhere(bytes, word) {
  for (const s of await allStreams(bytes)) {
    expect(s).not.toContain(word)
    expect(s.toUpperCase()).not.toContain(hexOf(word))
  }
}

// The bounding box, in the page's own coordinates, of every path the page
// content paints.
async function paintedBoxes(bytes, pageNo = 1) {
  const page = await (await openPdf(bytes)).getPage(pageNo)
  const { fnArray, argsArray } = await page.getOperatorList()
  const boxes = []
  const stack = []
  let ctm = [1, 0, 0, 1, 0, 0]
  fnArray.forEach((fn, i) => {
    const args = argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || ctm
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args)
    else if (fn === OPS.constructPath) {
      const [x0, y0, x1, y1] = args[2]
      const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(p => Util.applyTransform(p, ctm))
      const xs = pts.map(p => p[0])
      const ys = pts.map(p => p[1])
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
    }
  })
  return boxes
}
const near = (a, b, tol = 0.5) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

// A document whose pages are exactly the given content streams, with
// Helvetica as /F1. A page given as a list is stored as several streams.
async function written(...pages) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const streams of pages) {
    const page = doc.addPage([595, 842])
    page.node.setFontDictionary(N('F1'), font.ref)
    const refs = [].concat(streams).map(s => doc.context.register(doc.context.stream(s)))
    page.node.set(N('Contents'), refs.length === 1 ? refs[0] : doc.context.obj(refs))
  }
  return new Uint8Array(await doc.save({ useObjectStreams: false }))
}

const LINE = 'BT /F1 12 Tf 100 700 Td (alpha beta gamma) Tj ET'
// Cut in the middle of the number 700: pdf.js glues the two halves together,
// the specification says they are two tokens, and so the page is refused.
const CUT = ['BT /F1 12 Tf 100 7', '00 Td (alpha beta gamma) Tj ET']
// Where "beta" is on such a page, measured rather than assumed.
async function betaBox(bytes, pageNo = 1) {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
  const x = 100 + font.widthOfTextAtSize('alpha ', 12)
  return editorBox(bytes, [x - 1, 697, x + font.widthOfTextAtSize('beta', 12) + 1, 711], pageNo)
}

/* ---------- the sample document ---------- */

describe('a whiteout in the sample document', () => {
  it('takes one table cell out of the file and leaves the rest of the page alone', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const cell = runNamed(before[0], '$860K')
    expect(cell).toBeTruthy()
    // the search used further down does find the word while it is there
    expect((await allStreams(sample)).some(s => s.includes(hexOf('$860K')))).toBe(true)

    const ed = await openInEditor(sample)
    whiteout(ed, 0, await editorBox(sample, around(cell)))
    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })

    expect(warnings).toEqual([])
    const [first, second] = (await textOf(out)).split('\n')
    expect(first).not.toContain('$860K')
    // its neighbours in the row, and the same column in the rows around it
    for (const kept of ['Europe', '+19%', '$800K', '$1.24M', '$540K', 'Revenue', 'Quarterly Business Review']) {
      expect(first).toContain(kept)
    }
    expect(second).toContain('Notes on collaboration')

    const after = await runsOf(out)
    expect(after[0].length).toBe(before[0].length - 1)
    expect(after[1].length).toBe(before[1].length)
    expectUnmoved(before[0], after[0])
    expectUnmoved(before[1], after[1])

    // not in the page, and not left behind anywhere else in the file either
    await expectNowhere(out, '$860K')

    // the saved file was read back, and only the page that was changed
    expect(asked).toEqual({ opened: 1, pages: [1], released: 1 })
  })

  it('still paints the cover, exactly over what it removed', async () => {
    const sample = await makeSamplePdf()
    const cell = runNamed((await runsOf(sample))[0], '$860K')
    const box = around(cell)
    const ed = await openInEditor(sample)
    whiteout(ed, 0, await editorBox(sample, box))
    const { out } = await save(ed)
    const want = [box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1]
    expect((await paintedBoxes(out)).some(b => near(b, want, 0.01))).toBe(true)
  })

  it('removes only the cells whose middle is under the rectangle', async () => {
    const sample = await makeSamplePdf()
    const before = (await runsOf(sample))[0]
    const a = runNamed(before, '+19%')
    const b = runNamed(before, '+27%')
    // one rectangle down the Growth column over two rows
    const box = [a.x - 2, b.y - 3, a.x + a.w + 2, a.y + 10]
    const ed = await openInEditor(sample)
    whiteout(ed, 0, await editorBox(sample, box))
    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    const text = (await textOf(out)).split('\n')[0]
    for (const gone of ['+19%', '+27%']) expect(text).not.toContain(gone)
    for (const kept of ['+31%', '+12%', '$860K', '$800K', '$540K', '$500K']) expect(text).toContain(kept)
    expectUnmoved(before, (await runsOf(out))[0])
  })

  it('changes no text when it covers none', async () => {
    const sample = await makeSamplePdf()
    const ed = await openInEditor(sample)
    // the empty middle of page 1, between the table and the footer
    whiteout(ed, 0, await editorBox(sample, [100, 100, 400, 200]))
    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([])
    expect(await textOf(out)).toBe(await textOf(sample))
    expect(await runsOf(out)).toEqual(await runsOf(sample))
    expect((await paintedBoxes(out)).some(b => near(b, [99, 99, 401, 201], 0.01))).toBe(true)
    // nothing was taken out, so there is nothing to read back
    expect(asked.opened).toBe(0)
  })
})

describe('deleting and editing a line of the sample document', () => {
  it('takes a deleted line out of the file', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const ed = await openInEditor(sample)
    const ln = ed.line(0, 'Churn dropped')
    expect(ln.text).toBe('Churn dropped to an all-time low of 1.8% after the redesign.')
    deleteLine(ed, 0, ln)
    expect(ed.line(0, 'Churn dropped')).toMatchObject({ deleted: true, dirty: true })

    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    const text = await textOf(out)
    expect(text).not.toContain('Churn')
    expect(text).toContain('Revenue grew 24% quarter over quarter across all regions.')
    expect(text).toContain('Two new enterprise customers signed multi-year contracts.')
    const after = await runsOf(out)
    expect(after[0].length).toBe(before[0].length - 1)
    expectUnmoved(before[0], after[0])
    expectUnmoved(before[1], after[1])
    await expectNowhere(out, 'Churn')
  })

  it('replaces an edited line: the old words are gone and the new ones are there once', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const ed = await openInEditor(sample)
    retype(ed, 0, ed.line(0, 'Key highlights'), 'Main points')

    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    // The new words are drawn inside the rectangle the old ones were removed
    // from; the read-back must not take them for a leftover.
    expect(warnings).toEqual([])
    expect(asked.pages).toEqual([1])

    const [text] = await pagesOf(out)
    expect(text).not.toContain('Key highlights')
    expect(text.split('Main points').length - 1).toBe(1)
    await expectNowhere(out, 'Key highlights')

    const after = await runsOf(out)
    const written = after[0].filter(r => !before[0].some(b => b.str === r.str))
    expect(written.map(r => r.str).join(' ')).toBe('Main points')
    // the new line starts where the old one did
    const was = runNamed(before[0], 'Key highlights')
    expect(Math.abs(written[0].x - was.x)).toBeLessThan(1)
    expect(Math.abs(written[0].y - was.y)).toBeLessThan(1)
    expectUnmoved(before[0], after[0], r => written.includes(r))
    expectUnmoved(before[1], after[1])
  })

  it('replaces an edited paragraph', async () => {
    const sample = await makeSamplePdf()
    const ed = await openInEditor(sample)
    const para = ed.line(1, 'Editing a PDF should feel')
    expect(para.id.startsWith('P')).toBe(true)
    retype(ed, 1, para, 'A shorter paragraph that says something else entirely.')

    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    const second = (await pagesOf(out))[1]
    for (const gone of ['Editing a PDF', 'Apply Changes', 'vector graphics', 'rebuilt']) expect(second).not.toContain(gone)
    expect(second.split('A shorter paragraph that says something else entirely.').length - 1).toBe(1)
    expect(second).toContain('Notes on collaboration')
    expect(second).toContain('TIP')
    await expectNowhere(out, 'vector graphics')
  })

  it('also removes what a grown edit is painted over', async () => {
    const sample = await makeSamplePdf()
    const ed = await openInEditor(sample)
    // Long enough to wrap onto a second row, which lands on the line below.
    retype(ed, 0, ed.line(0, 'Quarterly Business Review'), 'Quarterly Business Review for the whole of the company')

    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    const [first] = await pagesOf(out)
    expect(first).toContain('Quarterly Business Review for the')
    // The line underneath is behind the paint now; left in the file it would
    // be invisible and still come out with select-all.
    expect(first).not.toContain('Prepared by the Product Team')
    expect(first).toContain('This is a sample PDF')
  })
})

/* ---------- where the page ends up ---------- */

describe('pages that moved', () => {
  it('scrubs the right page after a reorder, with a blank page inserted in front', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const ed = await openInEditor(sample)
    const [one, two] = ed.state.pageOrder
    ed.act({
      type: ACT.PAGES_SET, addKey: 'bNew',
      order: [{ key: 'bNew', src: null, rotate: 0, size: [595, 842] }, two, one]
    })
    whiteout(ed, 0, await editorBox(sample, around(runNamed(before[0], '$860K'))))
    whiteout(ed, 1, await editorBox(sample, around(runNamed(before[1], 'Sign-off'), 12), 2))
    // on the inserted page there is nothing underneath to take out
    whiteout(ed, 'bNew', { x: 100, y: 100, w: 300, h: 200 })

    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([])

    const pages = (await textOf(out)).split('\n')
    expect(pages.length).toBe(3)
    expect(pages[0].trim()).toBe('')
    expect(pages[1]).toContain('Notes on collaboration')
    expect(pages[1]).not.toContain('Sign-off')
    expect(pages[1]).toContain('Product Lead')
    expect(pages[2]).toContain('Quarterly Business Review')
    expect(pages[2]).not.toContain('$860K')
    expect(pages[2]).toContain('$800K')

    const after = await runsOf(out)
    expectUnmoved(before[1], after[1])
    expectUnmoved(before[0], after[2])
    await expectNowhere(out, '$860K')
    await expectNowhere(out, 'Sign-off')

    // read back at the places the pages have in the saved file
    expect(asked.pages).toEqual([2, 3])
  })

  it('scrubs the right page after the one before it was deleted', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const ed = await openInEditor(sample)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[1]] })
    whiteout(ed, 1, await editorBox(sample, around(runNamed(before[1], 'Sign-off'), 12), 2))

    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([])
    const pages = (await textOf(out)).split('\n')
    expect(pages.length).toBe(1)
    expect(pages[0]).toContain('Notes on collaboration')
    expect(pages[0]).not.toContain('Sign-off')
    expect(asked.pages).toEqual([1])
  })
})

describe('a page the user removed', () => {
  it('leaves nothing of itself in the file', async () => {
    const sample = await makeSamplePdf()
    const before = await runsOf(sample)
    const ed = await openInEditor(sample)
    const whole = await save(ed)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[1]] })
    const { out, warnings } = await save(ed)

    expect(warnings).toEqual([])
    expect((await openPdf(out)).numPages).toBe(1)
    const after = await runsOf(out)
    expect(after[0].length).toBe(before[1].length)
    expectUnmoved(before[1], after[0])
    // gone from the page tree, and not kept anywhere a viewer does not look
    expect((await allStreams(whole.out)).some(s => s.includes(hexOf('Quarterly Business Review')))).toBe(true)
    for (const word of ['Quarterly Business Review', '$860K', 'Key highlights']) await expectNowhere(out, word)
    expect(out.length).toBeLessThan(whole.out.length)
  })

  it('does not take with it what the remaining pages share', async () => {
    const src = await PDFDocument.create()
    const font = await src.embedFont(StandardFonts.Helvetica)
    src.addPage([300, 100]).drawText('shared words', { x: 10, y: 50, size: 12, font })
    const doc = await PDFDocument.create()
    const own = await doc.embedFont(StandardFonts.Helvetica)
    const [form] = await doc.embedPdf(await src.save())
    for (const label of ['first', 'second', 'third']) {
      const page = doc.addPage([595, 842])
      page.drawPage(form, { x: 50, y: 500 })
      page.drawText(`only on the ${label}`, { x: 50, y: 300, size: 12, font: own })
    }
    const pdf = new Uint8Array(await doc.save())

    const ed = await openInEditor(pdf)
    const [, two, three] = ed.state.pageOrder
    ed.act({ type: ACT.PAGES_SET, order: [three, two] })
    const { out, warnings } = await save(ed)
    expect(warnings).toEqual([])
    const pages = await pagesOf(out)
    expect(pages.length).toBe(2)
    expect(pages[0]).toContain('shared words')
    expect(pages[0]).toContain('only on the third')
    expect(pages[1]).toContain('shared words')
    expect(pages[1]).toContain('only on the second')
    await expectNowhere(out, 'only on the first')
    // the font both pages write with is still there to draw them
    for (const no of [1, 2]) {
      const list = await (await (await openPdf(out)).getPage(no)).getOperatorList()
      expect(list.fnArray.filter(fn => fn === OPS.showText).length).toBe(2)
    }
  })

  it('is emptied even when a bookmark still points at it', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const first = doc.addPage([595, 842])
    first.drawText('confidential first page', { x: 50, y: 700, size: 12, font })
    doc.addPage([595, 842]).drawText('second page stays', { x: 50, y: 700, size: 12, font })
    const ctx = doc.context
    const outlines = ctx.nextRef()
    const item = ctx.register(ctx.obj({ Title: PDFString.of('Start'), Parent: outlines, Dest: [first.ref, 'Fit'] }))
    ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }))
    doc.catalog.set(N('Outlines'), outlines)
    const pdf = new Uint8Array(await doc.save({ useObjectStreams: false }))
    expect((await (await openPdf(pdf)).getOutline())[0].title).toBe('Start')

    const ed = await openInEditor(pdf)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[1]] })
    const { out, warnings } = await save(ed)
    expect(warnings).toEqual([])
    expect(await pagesOf(out)).toEqual(['second page stays'])
    await expectNowhere(out, 'confidential first page')
    // the bookmark is still in the file and the file still opens with it
    expect((await (await openPdf(out)).getOutline())[0].title).toBe('Start')
  })

  // Fields on both pages, one that shows on both, and a group with a child
  // on each page - the ways a form can be spread over the pages of a file.
  const formPdf = async () => {
    const doc = await PDFDocument.create()
    const [one, two] = [doc.addPage([595, 842]), doc.addPage([595, 842])]
    const form = doc.getForm()
    const gone = form.createTextField('gone')
    gone.setText('typed on the first page')
    gone.addToPage(one, { x: 50, y: 700, width: 200, height: 20 })
    form.createTextField('kept').addToPage(two, { x: 50, y: 700, width: 200, height: 20 })
    const both = form.createTextField('both')
    both.setText('on both pages')
    both.addToPage(one, { x: 50, y: 600, width: 200, height: 20 })
    both.addToPage(two, { x: 50, y: 600, width: 200, height: 20 })
    form.createTextField('group.first').addToPage(one, { x: 50, y: 500, width: 200, height: 20 })
    form.createTextField('group.second').addToPage(two, { x: 50, y: 500, width: 200, height: 20 })
    form.createCheckBox('alone.box').addToPage(one, { x: 50, y: 400, width: 20, height: 20 })
    return new Uint8Array(await doc.save({ useObjectStreams: false }))
  }
  const fieldNames = async bytes =>
    (await PDFDocument.load(bytes)).getForm().getFields().map(f => f.getName()).sort()
  // How pdf-lib stores a field's value: a hex string of UTF-16.
  const asValue = text =>
    'FEFF' + Array.from(text, ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase()

  it('takes the form fields that were only on it out of the form', async () => {
    const pdf = await formPdf()
    expect(await fieldNames(pdf)).toEqual(['alone.box', 'both', 'gone', 'group.first', 'group.second', 'kept'])
    const ed = await openInEditor(pdf)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[1]] })
    ed.act({ type: ACT.FORM_SET, key: 'kept', value: 'typed in' })
    ed.act({ type: ACT.FORM_SET, key: 'gone', value: 'retyped before the page went' })
    const { out, warnings } = await save(ed)

    expect(warnings).toEqual([])
    expect(await fieldNames(out)).toEqual(['both', 'group.second', 'kept'])
    const page = await (await openPdf(out)).getPage(1)
    const shown = (await page.getAnnotations()).map(a => [a.fieldName, a.fieldValue])
    expect(shown).toEqual([['kept', 'typed in'], ['both', 'on both pages'], ['group.second', '']])
    // neither the value the file came with nor the one typed since is kept,
    // as a value or in the picture of the field
    expect(latin1(pdf)).toContain(asValue('typed on the first page'))
    expect(latin1(out)).toContain(asValue('typed in'))
    for (const text of ['typed on the first page', 'retyped before the page went']) {
      expect(latin1(out)).not.toContain(asValue(text))
      await expectNowhere(out, text)
    }
  })

  it('leaves the form alone when the pages are only reordered', async () => {
    const pdf = await formPdf()
    const ed = await openInEditor(pdf)
    const [one, two] = ed.state.pageOrder
    ed.act({ type: ACT.PAGES_SET, order: [two, one] })
    const { out, warnings } = await save(ed)
    expect(warnings).toEqual([])
    expect(await fieldNames(out)).toEqual(await fieldNames(pdf))
    expect(latin1(out)).toContain(asValue('typed on the first page'))
  })

  it('leaves the file alone when no page was removed', async () => {
    // Something nothing refers to, as a file may well carry: it is not this
    // module's business unless a page went.
    const doc = await PDFDocument.load(await written(LINE, LINE))
    const stray = doc.context.register(doc.context.stream('stray object'))
    const pdf = new Uint8Array(await doc.save({ useObjectStreams: false }))
    const ed = await openInEditor(pdf)
    const [one, two] = ed.state.pageOrder
    ed.act({ type: ACT.PAGES_SET, order: [two, one] })
    const { out } = await save(ed)
    expect(doc.context.lookup(stray)).toBeTruthy()
    expect((await allStreams(out)).some(s => s.includes('stray object'))).toBe(true)
  })
})

describe('a page tree with branches', () => {
  // Two pages under a branch of the page tree that states their size, their
  // rotation and their fonts for them - the pages themselves say none of it.
  const branched = async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const ctx = doc.context
    const leaves = [doc.addPage([300, 400]), doc.addPage([300, 400])]
    const rootRef = doc.catalog.get(N('Pages'))
    const branch = ctx.register(ctx.obj({
      Type: 'Pages', Kids: leaves.map(p => p.ref), Count: 2, Parent: rootRef,
      MediaBox: [10, 20, 310, 420], CropBox: [20, 30, 300, 400], Rotate: 90, Resources: { Font: { F1: font.ref } }
    }))
    doc.catalog.Pages().set(N('Kids'), ctx.obj([branch]))
    leaves.forEach((p, i) => {
      for (const key of ['MediaBox', 'Resources']) p.node.delete(N(key))
      p.node.set(N('Parent'), branch)
      p.node.set(N('Contents'), ctx.register(ctx.stream(`BT /F1 12 Tf 100 300 Td (page ${i + 1} text) Tj ET`)))
    })
    return new Uint8Array(await doc.save({ useObjectStreams: false }))
  }

  const shape = async (bytes, pageNo) => {
    const page = await (await openPdf(bytes)).getPage(pageNo)
    const doc = await PDFDocument.load(bytes)
    const fonts = doc.getPages()[pageNo - 1].node.Resources()?.lookup(N('Font'))
    return { view: page.view, rotate: page.rotate, fonts: fonts ? fonts.keys().map(k => k.toString()) : [] }
  }

  it('starts from pages that inherit everything', async () => {
    const pdf = await branched()
    expect(await shape(pdf, 1)).toEqual({ view: [20, 30, 300, 400], rotate: 90, fonts: ['/F1'] })
    expect(await pagesOf(pdf)).toEqual(['page 1 text', 'page 2 text'])
  })

  it('keeps the size, rotation and fonts of pages that are reordered', async () => {
    const pdf = await branched()
    const ed = await openInEditor(pdf)
    const [one, two] = ed.state.pageOrder
    ed.act({ type: ACT.PAGES_SET, order: [two, one] })
    const { out } = await save(ed)
    expect(await pagesOf(out)).toEqual(['page 2 text', 'page 1 text'])
    for (const no of [1, 2]) expect(await shape(out, no)).toEqual(await shape(pdf, 1))
  })

  it('keeps them for the page that is left when the other is removed', async () => {
    const pdf = await branched()
    const ed = await openInEditor(pdf)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[1]] })
    whiteout(ed, 1, await editorBox(pdf, [95, 295, 128, 312], 2))
    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    expect(await shape(out, 1)).toEqual(await shape(pdf, 2))
    const [text] = await pagesOf(out)
    expect(text).toContain('2 text')
    expect(text).not.toContain('page')
    await expectNowhere(out, 'page 1 text')
  })
})

describe('pages whose boxes do not start at the origin', () => {
  const threeWords = () => makePdf((p, f) => {
    p.drawText('LEFT', { x: 180, y: 500, size: 12, font: f })
    p.drawText('SECRET', { x: 250, y: 500, size: 12, font: f })
    p.drawText('RIGHT', { x: 330, y: 500, size: 12, font: f })
  })
  const reboxed = async fn => {
    const doc = await PDFDocument.load(await threeWords())
    fn(doc.getPages()[0])
    return new Uint8Array(await doc.save())
  }

  const variants = {
    // The Crop tool moves MediaBox and CropBox together, to x=119 y=252.6 here.
    'a page cropped by the Crop tool': async () =>
      toBytes(await cropPdf(await threeWords(), { box: { left: 0.2, right: 0.1, top: 0.1, bottom: 0.3 } })),
    'a CropBox smaller than the MediaBox': () => reboxed(p => p.setCropBox(50, 60, 495, 700)),
    'a MediaBox that does not start at the origin': () => reboxed(p => p.setMediaBox(-40, 30, 700, 900)),
    'a page with a UserUnit': () => reboxed(p => p.node.set(N('UserUnit'), p.doc.context.obj(2))),
    'a page with /Rotate 90': () => reboxed(p => p.setRotation(degrees(90)))
  }

  for (const [name, build] of Object.entries(variants)) {
    it(`removes the word under the whiteout on ${name}`, async () => {
      const pdf = await build()
      const before = (await runsOf(pdf))[0]
      const secret = runNamed(before, 'SECRET')
      const ed = await openInEditor(pdf)
      // the editor saw all three words, so the page really shows them
      expect(ed.state.pages[0].lines.map(l => l.text).join(' ')).toContain('SECRET')
      whiteout(ed, 0, await editorBox(pdf, around(secret, 12)))

      const { out, warnings } = await save(ed, { openPdf })
      expect(warnings).toEqual([])
      const after = (await runsOf(out))[0]
      expect(after.map(r => r.str)).toEqual(['LEFT', 'RIGHT'])
      expectUnmoved(before, after)
      await expectNowhere(out, 'SECRET')
      // and the page is still the page it was
      const [was, is] = [await (await openPdf(pdf)).getPage(1), await (await openPdf(out)).getPage(1)]
      expect(is.view).toEqual(was.view)
      expect(is.rotate).toBe(was.rotate)
      expect(is.userUnit).toBe(was.userUnit)
    })
  }

  it('starts from a page that really is off the origin', async () => {
    const doc = await PDFDocument.load(await variants['a page cropped by the Crop tool']())
    const box = doc.getPages()[0].getMediaBox()
    expect(Math.round(box.x)).toBe(119)
    expect(Math.round(box.y)).toBe(253)
  })
})

/* ---------- when the text cannot be removed ---------- */

describe('a page that cannot be scrubbed', () => {
  it('is still saved with its cover, and the user is told the text is extractable', async () => {
    const pdf = await written(CUT)
    const ed = await openInEditor(pdf)
    const box = await betaBox(pdf)
    whiteout(ed, 0, box)

    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([`Page 1: ${EXPOSED}`])
    // The warning is true: the cover is there, and so are the words.
    expect(await textOf(out)).toContain('alpha beta gamma')
    expect((await paintedBoxes(out)).length).toBe(1)
    // Nothing was taken out, so there is nothing to read back - and the page
    // is not reported a second time.
    expect(asked.opened).toBe(0)
  })

  it('is reported when only some of the text under the cover could go', async () => {
    // A stray name inside the array: pdf.js ignores it, the scrubber will not
    // rewrite an operator it does not fully understand.
    const pdf = await written('BT /F1 12 Tf 100 700 Td [(alpha beta) /Odd ( gamma)] TJ ET')
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await betaBox(pdf))
    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([`Page 1: ${EXPOSED}`])
    expect(await textOf(out)).toContain('beta')
  })

  it('is reported for an edited line too, and the edit is still written', async () => {
    const pdf = await written(CUT)
    const ed = await openInEditor(pdf)
    retype(ed, 0, ed.line(0, 'alpha beta gamma'), 'something new')
    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([`Page 1: ${EXPOSED}`])
    const [text] = await pagesOf(out)
    expect(text).toContain('something new')
    expect(text).toContain('alpha beta gamma')
  })

  it('is named by its place in the saved document, and does not stop other pages being scrubbed', async () => {
    const pdf = await written(LINE, CUT)
    const ed = await openInEditor(pdf)
    const [good, bad] = ed.state.pageOrder
    ed.act({
      type: ACT.PAGES_SET, addKey: 'bNew',
      order: [{ key: 'bNew', src: null, rotate: 0, size: [595, 842] }, good, bad]
    })
    whiteout(ed, 0, await betaBox(pdf, 1))
    whiteout(ed, 1, await betaBox(pdf, 2))

    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([`Page 3: ${EXPOSED}`])
    const pages = (await textOf(out)).split('\n')
    expect(pages[1]).toContain('alpha')
    expect(pages[1]).toContain('gamma')
    expect(pages[1]).not.toContain('beta')
    expect(pages[2]).toContain('alpha beta gamma')
    expect(asked.pages).toEqual([2])
  })

  it('names several pages in one sentence', async () => {
    const pdf = await written(CUT, LINE, CUT)
    const ed = await openInEditor(pdf)
    for (const i of [0, 1, 2]) whiteout(ed, i, await betaBox(pdf, i + 1))
    const { warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([`Pages 1 and 3: ${EXPOSED}`])
  })

  it('is reported when its pdf.js page was not handed over', async () => {
    const pdf = await written(LINE, LINE)
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await betaBox(pdf, 1))
    whiteout(ed, 1, await betaBox(pdf, 2))
    const { out, warnings } = await save(ed, { pdfPages: { 0: ed.pdfPages[0] }, openPdf })
    expect(warnings).toEqual([`Page 2: ${EXPOSED}`])
    const pages = (await textOf(out)).split('\n')
    expect(pages[0]).not.toContain('beta')
    expect(pages[1]).toContain('beta')
  })
})

describe('text that other pages share', () => {
  // The same block of text drawn on two pages, the way a letterhead or a
  // footer is, and nowhere else in the file.
  const sharedPdf = async () => {
    const src = await PDFDocument.create()
    const font = await src.embedFont(StandardFonts.Helvetica)
    src.addPage([300, 100]).drawText('public SECRET words', { x: 10, y: 50, size: 12, font })
    const draft = await PDFDocument.create()
    const [form] = await draft.embedPdf(await src.save())
    draft.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
    draft.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
    // embedPdf leaves a stray copy of the source page behind; copying the
    // pages into a fresh document sheds it
    const doc = await PDFDocument.create()
    for (const p of await doc.copyPages(await PDFDocument.load(await draft.save()), [0, 1])) doc.addPage(p)
    const pdf = new Uint8Array(await doc.save())
    const x = 60 + font.widthOfTextAtSize('public ', 12)
    return { pdf, secret: [x - 1, 547, x + font.widthOfTextAtSize('SECRET', 12) + 1, 561] }
  }

  it('goes from the page it was covered on, and the user is told the other page still has it', async () => {
    const { pdf, secret } = await sharedPdf()
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await editorBox(pdf, secret))
    const { out, warnings } = await save(ed, { openPdf })

    expect(warnings).toEqual(['Page 1: the text under a whiteout or an edit was taken off the page, but it belongs ' +
      'to a block that other pages of the file use too, so it is still stored in the file for those.'])
    const [first, second] = await pagesOf(out)
    expect(first).not.toContain('SECRET')
    expect(first).toContain('public')
    expect(first).toContain('words')
    expect(second).toContain('public SECRET words')
  })

  it('is gone from the file, without a remark, once it is covered on every page that draws it', async () => {
    const { pdf, secret } = await sharedPdf()
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await editorBox(pdf, secret, 1))
    whiteout(ed, 1, await editorBox(pdf, secret, 2))
    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })

    expect(warnings).toEqual([])
    for (const page of await pagesOf(out)) {
      expect(page).not.toContain('SECRET')
      expect(page).toContain('public')
      expect(page).toContain('words')
    }
    await expectNowhere(out, 'SECRET')
    expect(asked.pages).toEqual([1, 2])
  })

  it('is gone from the file when the only other page that drew it was removed', async () => {
    const { pdf, secret } = await sharedPdf()
    const ed = await openInEditor(pdf)
    ed.act({ type: ACT.PAGES_SET, order: [ed.state.pageOrder[0]] })
    whiteout(ed, 0, await editorBox(pdf, secret, 1))
    const { out, warnings } = await save(ed, { openPdf })
    expect(warnings).toEqual([])
    expect(await pagesOf(out)).toHaveLength(1)
    await expectNowhere(out, 'SECRET')
  })
})

/* ---------- the read-back ---------- */

describe('reading the saved file back', () => {
  const edited = async () => {
    const pdf = await written(LINE)
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await betaBox(pdf))
    return { pdf, ed }
  }

  it('reports nothing when the text really went', async () => {
    const { ed } = await edited()
    const { read, asked } = reader()
    const { out, warnings } = await save(ed, { openPdf: read })
    expect(warnings).toEqual([])
    expect(await textOf(out)).not.toContain('beta')
    expect(asked).toEqual({ opened: 1, pages: [1], released: 1 })
  })

  it('reports a page on which the text is found again', async () => {
    // A reader that hands back the file as it was before the edit stands in
    // for a saved file the removal did not make it into.
    const { pdf, ed } = await edited()
    const { warnings } = await save(ed, { openPdf: () => openPdf(pdf) })
    expect(warnings).toEqual([`Page 1: ${EXPOSED}`])
  })

  it('does not fail the export when the file cannot be read back', async () => {
    const { ed } = await edited()
    const { out, warnings } = await save(ed, { openPdf: async () => { throw new Error('no worker') } })
    expect(warnings).toEqual([])
    expect(await textOf(out)).not.toContain('beta')
  })

  it('does not fail the export when a page of the saved file cannot be had', async () => {
    const { ed } = await edited()
    const broken = async b => {
      const doc = await openPdf(b)
      doc.getPage = async () => { throw new Error('gone') }
      return doc
    }
    const { out, warnings } = await save(ed, { openPdf: broken })
    expect(warnings).toEqual([])
    expect(await textOf(out)).not.toContain('beta')
  })

  it('does not hold the download up for ever when the read-back never answers', async () => {
    const { ed } = await edited()
    // Only the clock is faked; the modules the export loads on the way still
    // arrive in real time, so the clock is moved a second at a time with a
    // real turn of the event loop in between.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let result = null
      save(ed, { openPdf: () => new Promise(() => {}) }).then(r => { result = r })
      let waited = 0
      while (!result && waited < 60000) {
        await vi.advanceTimersByTimeAsync(1000)
        await new Promise(resolve => setImmediate(resolve))
        waited += 1000
      }
      vi.useRealTimers()
      expect(waited).toBeGreaterThanOrEqual(30000)
      expect(waited).toBeLessThan(35000)
      expect(result.warnings).toEqual([])
      expect(await textOf(result.out)).not.toContain('beta')
    } finally {
      vi.useRealTimers()
    }
  })

  it('is not needed for the text to be removed', async () => {
    const { ed } = await edited()
    const { out, warnings } = await save(ed)
    expect(warnings).toEqual([])
    expect(await textOf(out)).not.toContain('beta')
  })

  it('leaves the bytes of the download alone', async () => {
    // pdf.js keeps the buffer it is given; the blob must not be that buffer.
    const { ed } = await edited()
    const greedy = async b => {
      const doc = await openPdf(b)
      b.fill(0)
      return doc
    }
    const { out, warnings } = await save(ed, { openPdf: greedy })
    expect(warnings).toEqual([])
    expect(latin1(out.subarray(0, 5))).toBe('%PDF-')
    expect(await textOf(out)).toContain('alpha')
  })
})

describe('a caller without pdf.js', () => {
  it('gets the cover painted and nothing more, without a warning', async () => {
    const pdf = await written(LINE)
    const ed = await openInEditor(pdf)
    whiteout(ed, 0, await betaBox(pdf))
    for (const extra of [{ pdfPages: null }, { pdfjsLib: null }]) {
      const { out, warnings } = await save(ed, extra)
      expect(warnings).toEqual([])
      expect(await textOf(out)).toContain('alpha beta gamma')
      expect((await paintedBoxes(out)).length).toBe(1)
    }
  })
})

/* ---------- what the sample document says about it ---------- */

describe('the tip in the sample document', () => {
  it('says what a whiteout does and does not remove, and fits its box', async () => {
    const runs = (await runsOf(await makeSamplePdf()))[1]
    const label = runNamed(runs, 'TIP')
    // The box is drawn from 54 pt under the label's baseline to 20 pt over it,
    // and from x=50 to x=545.
    const tip = runs.filter(r => r.y < label.y && r.y > label.y - 80)
    const text = tip.map(r => r.str).join(' ')
    expect(text).toMatch(/Whiteout tool takes the text it covers out of the file/)
    expect(text).toMatch(/picture or a scan is only painted over/)
    expect(text).toMatch(/Redact tool/)
    expect(tip.length).toBeLessThanOrEqual(3)
    for (const r of tip) {
      expect(r.y - 3).toBeGreaterThan(label.y - 54)
      expect(r.x + r.w).toBeLessThan(545 - 10)
    }
  })
})
