// The scrubber has to do two things at once: make the chosen words impossible
// to recover from the saved file, and leave every other glyph exactly where it
// was. Each case below builds a small page, removes a word from it and then
// reads the SAVED file back with pdf.js to check both.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, degrees
} from 'pdf-lib'
import { openPdf, pdfjsLib, textOf, textPositions } from './helpers'
import { glyphsInRects, scrubPageText } from '../src/lib/scrub'

const N = s => PDFName.of(s)
const latin1 = b => Array.from(b, c => String.fromCharCode(c)).join('')
const hexOf = s => Array.from(s, ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase()

// Helvetica's metrics, to work out where a word must be without asking the
// code under test. One character at a time, so that pdf-lib's kerning stays out.
const helv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
const adv = (s, { size = 12, tc = 0, tw = 0, th = 1 } = {}) =>
  [...s].reduce((n, ch) => n + (helv.widthOfTextAtSize(ch, 1) * size + tc + (ch === ' ' ? tw : 0)) * th, 0)

const through = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

// The rectangle that holds the text running from xs to xe on the baseline y in
// text space, after matrix m. `size` is signed, as in Tf.
function zone(xs, xe, y, { size = 12, m = [1, 0, 0, 1, 0, 0] } = {}) {
  const inset = 0.4 * Math.sign(xe - xs)
  const pts = [[xs + inset, y + 0.05 * size], [xe - inset, y + 0.6 * size]]
    .flatMap(([x, yy], i, all) => [through(m, x, yy), through(m, x, all[1 - i][1])])
  const xsAll = pts.map(p => p[0])
  const ysAll = pts.map(p => p[1])
  const x = Math.min(...xsAll)
  const y0 = Math.min(...ysAll)
  return { x, y: y0, w: Math.max(...xsAll) - x, h: Math.max(...ysAll) - y0 }
}

// Where "beta" sits in "alpha beta gamma" started at x.
const beta = (x, y, opts = {}) => zone(x + adv('alpha ', opts), x + adv('alpha beta', opts), y, opts)

// A one-page document whose content is exactly the given stream(s), with
// Helvetica as /F1 and Helvetica-Bold as /F2.
async function written(streams, setup) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  page.node.setFontDictionary(N('F1'), (await doc.embedFont(StandardFonts.Helvetica)).ref)
  page.node.setFontDictionary(N('F2'), (await doc.embedFont(StandardFonts.HelveticaBold)).ref)
  const refs = [].concat(streams).map(s => doc.context.register(doc.context.stream(s)))
  page.node.set(N('Contents'), refs.length === 1 ? refs[0] : doc.context.obj(refs))
  if (setup) await setup(doc, page)
  return new Uint8Array(await doc.save({ useObjectStreams: false }))
}

async function scrub(bytes, rects, pageNo = 1, around = {}) {
  const pdfPage = await (await openPdf(bytes)).getPage(pageNo)
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[pageNo - 1]
  if (around.before) await around.before(doc, page)
  const contents = page.node.get(N('Contents'))
  const result = await scrubPageText({ doc, page, pdfPage, rects: [].concat(rects), pdfjsLib })
  const touched = page.node.get(N('Contents')) !== contents
  if (around.after) await around.after(doc, page)
  return { result, touched, out: new Uint8Array(await doc.save()) }
}

// What every successful scrub must leave behind: a file pdf.js still reads
// from end to end, with no glyph left under the rectangles.
async function clean(out, rects, pageNo = 1, limit) {
  const pdfPage = await (await openPdf(out)).getPage(pageNo)
  const list = await pdfPage.getOperatorList()
  expect(list.fnArray.length).toBeGreaterThan(0)
  expect(await glyphsInRects({ pdfPage, rects: [].concat(rects), pdfjsLib, limit })).toBe(0)
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

async function contentOf(bytes, pageNo = 1) {
  const doc = await PDFDocument.load(bytes)
  const node = doc.getPages()[pageNo - 1].node
  const top = node.Contents()
  const streams = top instanceof PDFRawStream ? [top] : top.asArray().map(r => doc.context.lookup(r))
  return streams.map(s => latin1(decodePDFRawStream(s).decode())).join('\n')
}

const runsOf = async bytes => (await textPositions(bytes)).pages
const runWith = (runs, word) => runs.find(r => r.str.includes(word))

// The usual shape of a case: "beta" goes, its neighbours stay, and the run
// that follows on the same line has not moved.
async function expectBetaGone(bytes, rect, { anchor = 'NEXT', removed = 4 } = {}) {
  const before = runWith((await runsOf(bytes))[0], anchor)
  const { result, out } = await scrub(bytes, rect)
  expect(result).toMatchObject({ ok: true, removed, left: 0 })
  const text = await textOf(out)
  expect(text).not.toContain('beta')
  expect(text).toContain('alpha')
  expect(text).toContain('gamma')
  const after = runWith((await runsOf(out))[0], anchor)
  expect(after.str).toBe(before.str)
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.01)
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.01)
  await clean(out, rect)
  return { result, out }
}

const LINE = '(alpha beta gamma) Tj /F2 12 Tf (NEXT) Tj'

describe('scrubPageText', () => {
  it('removes a word drawn on its own and leaves its neighbours where they were', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([595, 842])
    page.drawText('alpha', { x: 100, y: 700, size: 12, font })
    page.drawText('beta', { x: 200, y: 700, size: 12, font })
    page.drawText('gamma', { x: 300, y: 700, size: 12, font })
    const bytes = new Uint8Array(await doc.save())
    const rect = zone(200, 200 + adv('beta'), 700)

    const { result, out, touched } = await scrub(bytes, rect)
    expect(result).toMatchObject({ ok: true, removed: 4, left: 0, textOps: 3, shared: 0 })
    expect(touched).toBe(true)
    expect((await textOf(out)).split(/\s+/)).toEqual(['alpha', 'gamma'])
    const before = (await runsOf(bytes))[0]
    for (const run of (await runsOf(out))[0]) {
      const was = runWith(before, run.str)
      expect(Math.abs(run.x - was.x)).toBeLessThan(0.01)
      expect(Math.abs(run.y - was.y)).toBeLessThan(0.01)
    }
    await clean(out, rect)
  })

  it('removes the middle word of a single string', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([595, 842]).drawText('alpha beta gamma', { x: 100, y: 700, size: 12, font })
    const bytes = new Uint8Array(await doc.save())
    const rect = beta(100, 700)

    const { result, out } = await scrub(bytes, rect)
    expect(result).toMatchObject({ ok: true, removed: 4, left: 0, textOps: 1 })
    expect(await textOf(out)).not.toContain('beta')
    const gamma = runWith((await runsOf(out))[0], 'gamma')
    expect(gamma.str.startsWith('gamma')).toBe(true)
    expect(Math.abs(gamma.x - (100 + adv('alpha beta ')))).toBeLessThan(0.01)
    await clean(out, rect)
  })

  it('keeps what follows on the same line in place', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    const next = runWith((await runsOf(bytes))[0], 'NEXT')
    expect(Math.abs(next.x - (100 + adv('alpha beta gamma')))).toBeLessThan(0.01)
    const { out } = await expectBetaGone(bytes, beta(100, 700))
    const gamma = runWith((await runsOf(out))[0], 'gamma')
    expect(Math.abs(gamma.x - (100 + adv('alpha beta ')))).toBeLessThan(0.01)
  })

  it('leaves no copy of the removed words anywhere in the saved file', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    expect((await allStreams(bytes)).some(s => s.includes('beta'))).toBe(true)
    const { out } = await scrub(bytes, beta(100, 700))
    for (const s of await allStreams(out)) {
      expect(s).not.toContain('beta')
      expect(s.toUpperCase()).not.toContain(hexOf('beta'))
    }
  })

  describe('text state', () => {
    it('TJ with kerning numbers', async () => {
      const bytes = await written(
        'BT /F1 12 Tf 100 700 Td [(al) -50 (pha ) 30 (be) -20 (ta) 100 ( gamma)] TJ /F2 12 Tf (NEXT) Tj ET')
      const xs = 100 + adv('al') + 0.6 + adv('pha ') - 0.36
      const xe = xs + adv('be') + 0.24 + adv('ta')
      const { out } = await expectBetaGone(bytes, zone(xs, xe, 700))
      // the numbers that were there are still there, merged with the new ones
      expect(await contentOf(out)).toMatch(/\[<616C> -50 <70686120> [-\d.]+ <2067616D6D61>\] TJ/)
    })

    it("the ' operator", async () => {
      const bytes = await written(`BT /F1 12 Tf 14 TL 100 700 Td (first line) Tj (alpha beta gamma) ' /F2 12 Tf (NEXT) Tj ET`)
      const { out } = await expectBetaGone(bytes, beta(100, 686))
      expect(await textOf(out)).toContain('first line')
    })

    it('the " operator', async () => {
      const bytes = await written('BT /F1 12 Tf 14 TL 100 700 Td (first line) Tj 2 1 (alpha beta gamma) " /F2 12 Tf (NEXT) Tj ET')
      const { out } = await expectBetaGone(bytes, beta(100, 686, { tc: 1, tw: 2 }))
      expect(await contentOf(out)).toContain('2 Tw 1 Tc T* [')
    })

    it('character spacing, word spacing and horizontal scaling', async () => {
      const bytes = await written(`BT /F1 12 Tf 1.5 Tc 3 Tw 80 Tz 100 700 Td ${LINE} ET`)
      await expectBetaGone(bytes, beta(100, 700, { tc: 1.5, tw: 3, th: 0.8 }))
    })

    it('text rise', async () => {
      const bytes = await written(`BT /F1 12 Tf 30 Ts 100 700 Td ${LINE} ET`)
      await expectBetaGone(bytes, beta(100, 730))
      // without the rise the rectangle is in the wrong place and nothing goes
      const { result } = await scrub(bytes, beta(100, 700))
      expect(result).toMatchObject({ ok: true, removed: 0, left: 0 })
    })

    it('a negative font size', async () => {
      const bytes = await written('BT /F1 -12 Tf 400 700 Td (alpha beta gamma) Tj /F2 -12 Tf (NEXT) Tj ET')
      await expectBetaGone(bytes, beta(400, 700, { size: -12 }))
    })

    it('a text matrix that scales', async () => {
      const bytes = await written(`BT /F1 12 Tf 2 0 0 2 100 600 Tm ${LINE} ET`)
      await expectBetaGone(bytes, beta(0, 0, { m: [2, 0, 0, 2, 100, 600] }))
    })

    it('a rotated and scaled cm', async () => {
      const bytes = await written(`q 0 2 -2 0 400 100 cm BT /F1 12 Tf 10 20 Td ${LINE} ET Q`)
      await expectBetaGone(bytes, beta(10, 20, { m: [0, 2, -2, 0, 400, 100] }))
    })

    it('nested q/Q', async () => {
      const bytes = await written(
        `q 1 0 0 1 50 0 cm /F1 12 Tf q 3 0 0 3 0 0 cm /F2 40 Tf 5 Tc Q q 1 0 0 1 0 -100 cm BT 100 700 Td ${LINE} ET Q Q`)
      await expectBetaGone(bytes, beta(150, 600))
    })
  })

  it('reads literal strings with escapes', async () => {
    const bytes = await written('BT /F1 12 Tf 100 700 Td (al\\(pha\\) b\\145ta \\101gain\\\n!) Tj /F2 12 Tf (NEXT) Tj ET')
    expect(await textOf(bytes)).toContain('al(pha) beta Again!')
    const xs = 100 + adv('al(pha) ')
    const rect = zone(xs, xs + adv('beta'), 700)
    const before = runWith((await runsOf(bytes))[0], 'NEXT')
    const { result, out } = await scrub(bytes, rect)
    expect(result).toMatchObject({ ok: true, removed: 4, left: 0 })
    const text = await textOf(out)
    expect(text).toContain('al(pha)')
    expect(text).toContain('Again!')
    expect(text).not.toContain('beta')
    expect(Math.abs(runWith((await runsOf(out))[0], 'NEXT').x - before.x)).toBeLessThan(0.01)
    await clean(out, rect)
  })

  it('reads hex strings, odd digit counts included', async () => {
    // the final lone 6 means 0x60
    const bytes = await written(`BT /F1 12 Tf 100 700 Td <${hexOf('alpha beta gamma')} 6> Tj /F2 12 Tf (NEXT) Tj ET`)
    expect(await textOf(bytes)).toContain('alpha beta gamma`')
    const { out } = await expectBetaGone(bytes, beta(100, 700))
    expect(await textOf(out)).toContain('gamma`')
  })

  it('reads run-together operators, comments and escaped names', async () => {
    const bytes = await written('qBT/F#31 12 Tf 100 700 Td(alpha beta gamma)Tj/F2 12 Tf(NEXT)Tj ETQ % (beta) Tj\n')
    await expectBetaGone(bytes, beta(100, 700))
  })

  it('stops reading where pdf.js stops reading', async () => {
    // A stray ) ends the page for pdf.js, and its two tokens of read-ahead
    // take the operator just before it with them: the second Tj is never run.
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET BT 100 600 Td (lost) Tj ) BT 100 500 Td (never) Tj ET`)
    expect(await textOf(bytes)).not.toContain('lost')
    const { result, out } = await expectBetaGone(bytes, beta(100, 700))
    expect(result.textOps).toBe(2)
    // what pdf.js cannot see is not ours to touch
    expect(await contentOf(out)).toContain('(lost) Tj ) BT 100 500 Td (never) Tj ET')
  })

  it('reads an inline image with an ASCII filter to its end-of-data mark', async () => {
    // The data spells out an operator sequence; only the ~> ends it.
    const bytes = await written(
      `q 10 0 0 10 50 50 cm BI /W 1 /H 1 /BPC 8 /CS /G /F /A85 ID EI (aa) Tj ~>\nEI Q BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    await expectBetaGone(bytes, beta(100, 700))
  })

  it('handles /Contents given as several streams', async () => {
    const bytes = await written(['BT /F1 12 Tf 100 700 Td (alpha beta gamma)', 'Tj /F2 12 Tf', '(NEXT) Tj ET'])
    const { out } = await expectBetaGone(bytes, beta(100, 700))
    const doc = await PDFDocument.load(out)
    expect(doc.getPages()[0].node.Contents().size()).toBe(1)
  })

  it('accepts streams that touch without white space where pdf.js still tells the operators apart', async () => {
    const bytes = await written(['q', `BT /F1 12 Tf 100 700 Td ${LINE} ET`, 'Q'])
    const { out } = await expectBetaGone(bytes, beta(100, 700))
    expect(await contentOf(out)).toMatch(/^q\nBT[^]*ET\nQ$/)
  })

  it('refuses streams that are cut in the middle of a token', async () => {
    const bytes = await written(['BT /F1 12 Tf 100 7', '00 Td (alpha beta gamma) Tj ET'])
    expect(await textOf(bytes)).toContain('beta')
    const { result, touched } = await scrub(bytes, beta(100, 700))
    expect(result.ok).toBe(false)
    expect(result.reason).not.toBe('')
    expect(touched).toBe(false)
  })

  describe('Form XObjects', () => {
    const sourcePage = async () => {
      const src = await PDFDocument.create()
      const font = await src.embedFont(StandardFonts.Helvetica)
      src.addPage([300, 100]).drawText('public SECRET words', { x: 10, y: 50, size: 12, font })
      return src.save()
    }
    const secretAt = (x, y) => zone(x + 10 + adv('public '), x + 10 + adv('public SECRET'), y + 50)

    it('removes text inside a form from this page and not from the page that shares it', async () => {
      const doc = await PDFDocument.create()
      const [form] = await doc.embedPdf(await sourcePage())
      doc.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
      doc.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
      const bytes = new Uint8Array(await doc.save())
      const rect = secretAt(50, 500)

      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0, textOps: 1, shared: 1 })
      const [first, second] = (await textOf(out)).split('\n')
      expect(first).not.toContain('SECRET')
      expect(first).toContain('public')
      expect(first).toContain('words')
      expect(second).toContain('public SECRET words')
      await clean(out, rect)
      const words = runWith((await runsOf(out))[0], 'words')
      expect(Math.abs(words.x - (60 + adv('public SECRET ')))).toBeLessThan(0.01)
    })

    it('drops the old form altogether when nothing else draws it', async () => {
      const draft = await PDFDocument.create()
      const [form] = await draft.embedPdf(await sourcePage())
      draft.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
      // embedPdf leaves an unreferenced copy of the source page's content in
      // the file; copying the page into a fresh document sheds it, so that the
      // form is the only place the words are.
      const doc = await PDFDocument.create()
      const [copy] = await doc.copyPages(await PDFDocument.load(await draft.save()), [0])
      doc.addPage(copy)
      const bytes = new Uint8Array(await doc.save())
      expect((await allStreams(bytes)).filter(s => s.toUpperCase().includes(hexOf('SECRET')))).toHaveLength(1)
      const { result, out } = await scrub(bytes, secretAt(50, 500))
      expect(result).toMatchObject({ ok: true, removed: 6, shared: 0 })
      for (const s of await allStreams(out)) expect(s.toUpperCase()).not.toContain(hexOf('SECRET'))
    })

    it('names the shared form it had to keep, and lets go of it with its last use', async () => {
      const draft = await PDFDocument.create()
      const [form] = await draft.embedPdf(await sourcePage())
      draft.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
      draft.addPage([595, 842]).drawPage(form, { x: 50, y: 500 })
      // copied into a fresh document so that the form is the only place the
      // words are (see the test above)
      const fresh = await PDFDocument.create()
      for (const p of await fresh.copyPages(await PDFDocument.load(await draft.save()), [0, 1])) fresh.addPage(p)
      const bytes = new Uint8Array(await fresh.save())
      const rects = [secretAt(50, 500)]

      const view = await openPdf(bytes)
      const doc = await PDFDocument.load(bytes)
      const [one, two] = doc.getPages()
      const first = await scrubPageText({ doc, page: one, pdfPage: await view.getPage(1), rects, pdfjsLib })
      expect(first).toMatchObject({ ok: true, removed: 6, shared: 1 })
      expect(first.held).toHaveLength(1)
      const kept = doc.context.lookup(first.held[0])
      expect(latin1(decodePDFRawStream(kept).decode()).toUpperCase()).toContain(hexOf('SECRET'))

      // the second page was the other user; once it is scrubbed too the form goes
      const second = await scrubPageText({ doc, page: two, pdfPage: await view.getPage(2), rects, pdfjsLib })
      expect(second).toMatchObject({ ok: true, removed: 6, shared: 0, held: [] })
      expect(doc.context.lookup(first.held[0])).toBeUndefined()
      const out = new Uint8Array(await doc.save())
      expect(await textOf(out)).not.toContain('SECRET')
      for (const s of await allStreams(out)) expect(s.toUpperCase()).not.toContain(hexOf('SECRET'))
    })

    it('tells two drawings of the same form on one page apart', async () => {
      const doc = await PDFDocument.create()
      const [form] = await doc.embedPdf(await sourcePage())
      const page = doc.addPage([595, 842])
      page.drawPage(form, { x: 50, y: 500 })
      page.drawPage(form, { x: 50, y: 300 })
      const bytes = new Uint8Array(await doc.save())
      const rect = secretAt(50, 500)
      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0, textOps: 2, shared: 1 })
      expect((await textOf(out)).match(/SECRET/g)).toHaveLength(1)
      const secret = runWith((await runsOf(out))[0], 'SECRET')
      expect(Math.round(secret.y)).toBe(350)
      await clean(out, rect)
    })

    it('follows the matrix a form is drawn with', async () => {
      const doc = await PDFDocument.create()
      const [form] = await doc.embedPdf(await sourcePage())
      doc.addPage([595, 842]).drawPage(form, { x: 100, y: 200, xScale: 2, yScale: 0.5 })
      const bytes = new Uint8Array(await doc.save())
      const rect = zone(10 + adv('public '), 10 + adv('public SECRET'), 50, { m: [2, 0, 0, 0.5, 100, 200] })
      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0 })
      expect(await textOf(out)).not.toContain('SECRET')
      await clean(out, rect)
    })

    it('copies resources that are inherited rather than changing them', async () => {
      const doc = await PDFDocument.create()
      const [form] = await doc.embedPdf(await sourcePage())
      const pages = [doc.addPage([595, 842]), doc.addPage([595, 842])]
      pages.forEach(p => p.drawPage(form, { x: 50, y: 500 }))
      // one Resources dictionary on the page tree, none on the pages; each
      // page draws the form under a name of its own
      const names = d => d.lookup(N('XObject')).keys().map(k => k.decodeText())
      const shared = pages[0].node.Resources()
      const [mine] = names(shared)
      for (const [k, v] of pages[1].node.Resources().lookup(N('XObject')).entries()) shared.lookup(N('XObject')).set(k, v)
      doc.catalog.Pages().set(N('Resources'), shared)
      pages.forEach(p => p.node.delete(N('Resources')))
      const bytes = new Uint8Array(await doc.save())
      expect(await textOf(bytes)).toBe('public SECRET words\npublic SECRET words')

      const { result, out } = await scrub(bytes, secretAt(50, 500))
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0, shared: 1 })
      const [first, second] = (await textOf(out)).split('\n')
      expect(first).not.toContain('SECRET')
      expect(second).toBe('public SECRET words')
      const saved = await PDFDocument.load(out)
      const inherited = names(saved.catalog.Pages().lookup(N('Resources')))
      expect(inherited).toHaveLength(2)
      expect(inherited).toContain(mine)
      const own = names(saved.getPages()[0].node.lookup(N('Resources')))
      expect(own).toContain('Scrub1')
      expect(own).not.toContain(mine)
      expect(saved.getPages()[1].node.get(N('Resources'))).toBeUndefined()
    })

    it('handles a form that borrows the resources of the page', async () => {
      const bytes = await written('q /Fm0 Do Q', (doc, page) => {
        const form = doc.context.stream(`BT /F1 12 Tf 100 700 Td ${LINE} ET`, {
          Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842]
        })
        page.node.Resources().set(N('XObject'), doc.context.obj({ Fm0: doc.context.register(form) }))
      })
      const { result, out } = await expectBetaGone(bytes, beta(100, 700))
      expect(result.shared).toBe(0)
      expect(await contentOf(out)).toBe('q /Scrub1 Do Q')
      for (const s of await allStreams(out)) expect(s).not.toContain('beta')
    })

    it('counts text in a soft mask and leaves it alone', async () => {
      const bytes = await written(`/GS1 gs BT /F1 12 Tf 100 700 Td ${LINE} ET`, (doc, page) => {
        const group = doc.context.register(doc.context.stream('BT /F1 40 Tf 100 400 Td (MASK) Tj ET', {
          Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842],
          Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: page.node.get(N('Resources'))
        }))
        page.node.Resources().set(N('ExtGState'),
          doc.context.obj({ GS1: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: group } } }))
      })
      const { result } = await expectBetaGone(bytes, beta(100, 700))
      expect(result.textOps).toBe(3)

      const { result: masked, touched } = await scrub(bytes, { x: 90, y: 395, w: 200, h: 40 })
      expect(masked).toMatchObject({ ok: true, removed: 0, left: 4 })
      expect(touched).toBe(false)
    })

    it('follows a form inside a form', async () => {
      const mid = await PDFDocument.create()
      const [inner] = await mid.embedPdf(await sourcePage())
      mid.addPage([400, 200]).drawPage(inner, { x: 20, y: 30 })
      const doc = await PDFDocument.create()
      const [outer] = await doc.embedPdf(await mid.save())
      doc.addPage([595, 842]).drawPage(outer, { x: 50, y: 500 })
      doc.addPage([595, 842]).drawPage(outer, { x: 50, y: 500 })
      const bytes = new Uint8Array(await doc.save())
      const rect = secretAt(70, 530)

      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0 })
      const [first, second] = (await textOf(out)).split('\n')
      expect(first).not.toContain('SECRET')
      expect(first).toContain('words')
      expect(second).toContain('SECRET')
      await clean(out, rect)
    })
  })

  describe('Type0 fonts', () => {
    const liberation = readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url))
    const make = async text => {
      const doc = await PDFDocument.create()
      doc.registerFontkit(fontkit)
      const font = await doc.embedFont(liberation, { subset: true })
      doc.addPage([595, 842]).drawText(text, { x: 60, y: 700, size: 14, font })
      return { bytes: new Uint8Array(await doc.save()), width: s => font.widthOfTextAtSize(s, 14) }
    }

    it('removes part of an Identity-H string', async () => {
      const { bytes, width } = await make('plain hidden text')
      const rect = zone(60 + width('plain '), 60 + width('plain hidden'), 700, { size: 14 })
      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0 })
      const text = await textOf(out)
      expect(text).not.toContain('hidden')
      expect(text).toContain('plain')
      const tail = runWith((await runsOf(out))[0], 'text')
      expect(Math.abs(tail.x - (60 + width('plain hidden ')))).toBeLessThan(0.05)
      await clean(out, rect)
    })

    it('removes part of a Cyrillic string', async () => {
      const { bytes, width } = await make('Привет секрет друзья')
      expect(await textOf(bytes)).toContain('секрет')
      const rect = zone(60 + width('Привет '), 60 + width('Привет секрет'), 700, { size: 14 })
      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0 })
      const text = await textOf(out)
      expect(text).not.toContain('секрет')
      expect(text).toContain('Привет')
      expect(text).toContain('друзья')
      const tail = runWith((await runsOf(out))[0], 'друзья')
      expect(Math.abs(tail.x - (60 + width('Привет секрет ')))).toBeLessThan(0.05)
      await clean(out, rect)
    })
  })

  describe('fonts whose strings cannot be split into glyphs', () => {
    const liberation = readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url))
    // Two strings in a Type0 font, whose /Encoding is then swapped for
    // something that is not plain Identity-H.
    const make = async encoding => {
      const draft = await PDFDocument.create()
      draft.registerFontkit(fontkit)
      const font = await draft.embedFont(liberation, { subset: true })
      const page = draft.addPage([595, 842])
      page.drawText('secret', { x: 60, y: 700, size: 14, font })
      page.drawText('keep hidden words', { x: 60, y: 600, size: 14, font })
      const doc = await PDFDocument.load(await draft.save())
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (obj.get && obj.get(N('Subtype')) === N('Type0')) obj.set(N('Encoding'), encoding(doc))
      }
      return { bytes: new Uint8Array(await doc.save()), width: s => font.widthOfTextAtSize(s, 14) }
    }
    const embeddedCMap = doc => doc.context.register(doc.context.stream([
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
      '/CMapName /Custom def /CMapType 1 def',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '1 begincidrange <0000> <FFFF> 0 endcidrange',
      'endcmap CMapName currentdict /CMap defineresource pop end end'
    ].join('\n'), { Type: 'CMap', CMapName: 'Custom', CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 } }))

    it('removes an operator whole when all of it is hit', async () => {
      const { bytes, width } = await make(embeddedCMap)
      expect(await textOf(bytes)).toContain('secret')
      const rect = zone(60, 60 + width('secret'), 700, { size: 14 })
      const { result, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 6, left: 0 })
      const text = await textOf(out)
      expect(text).not.toContain('secret')
      expect(text).toContain('keep hidden words')
      await clean(out, rect)
    })

    it('leaves an operator that is only partly hit, and says so', async () => {
      const { bytes, width } = await make(embeddedCMap)
      const rect = zone(60 + width('keep '), 60 + width('keep hidden'), 600, { size: 14 })
      const { result, touched, out } = await scrub(bytes, rect)
      expect(result).toMatchObject({ ok: true, removed: 0, left: 6 })
      expect(result.reason).not.toBe('')
      expect(touched).toBe(false)
      expect(await textOf(out)).toContain('keep hidden words')
    })

    it('does not attempt vertical writing', async () => {
      const { bytes } = await make(() => N('Identity-V'))
      const everything = { x: -2000, y: -2000, w: 5000, h: 5000 }
      const { result, touched } = await scrub(bytes, everything)
      expect(result).toMatchObject({ ok: true, removed: 0, left: 23 })
      expect(touched).toBe(false)
    })
  })

  it('is not derailed by an inline image whose data contains "EI"', async () => {
    const data = [0x00, 0x45, 0x49, 0x20, 0xff, 0x80, 0x10, 0x20]
    const stream = Uint8Array.from([
      ...Buffer.from('q 40 0 0 20 50 50 cm\nBI /W 4 /H 2 /BPC 8 /CS /G ID '), ...data,
      ...Buffer.from(`\nEI\nQ\nBT /F1 12 Tf 100 700 Td ${LINE} ET\n`)
    ])
    const bytes = await written(stream)
    const { out } = await expectBetaGone(bytes, beta(100, 700))
    // the image went through untouched
    expect(await contentOf(out)).toContain(latin1(Uint8Array.from(data)))
  })

  describe('replacement text in marked content', () => {
    const SPAN = 'BT /F1 12 Tf 100 700 Td (alpha ) Tj /Span <</ActualText (beta) /MCID 7>> BDC (beta) Tj EMC ( gamma) Tj ET'

    it('drops /ActualText when the glyphs it stood for are removed', async () => {
      const bytes = await written(`/P <</MCID 0>> BDC ${SPAN} EMC`)
      const { result, out } = await scrub(bytes, beta(100, 700))
      expect(result).toMatchObject({ ok: true, removed: 4, left: 0 })
      const content = await contentOf(out)
      expect(content).not.toContain('ActualText')
      expect(content).not.toContain('beta')
      expect(content).toContain('/MCID 7')
      expect(content).toContain('/MCID 0')
      for (const s of await allStreams(out)) expect(s).not.toContain('beta')
      await clean(out, beta(100, 700))
    })

    it('keeps /ActualText when its glyphs stay', async () => {
      const bytes = await written(SPAN)
      const { result, out } = await scrub(bytes, zone(100, 100 + adv('alpha'), 700))
      expect(result).toMatchObject({ ok: true, removed: 5, left: 0 })
      expect(await contentOf(out)).toContain('/ActualText (beta)')
      expect(await textOf(out)).toContain('beta')
    })

    it('drops a named property list that carries /ActualText', async () => {
      const bytes = await written(
        'BT /F1 12 Tf 100 700 Td (alpha ) Tj /Span /MC0 BDC (beta) Tj EMC ( gamma) Tj ET',
        (doc, page) => page.node.Resources().set(N('Properties'),
          doc.context.obj({ MC0: { ActualText: PDFString.of('beta'), MCID: 3 }, MC1: { MCID: 4 } })))
      expect(latin1(bytes)).toContain('/ActualText (beta)')
      const { result, out } = await scrub(bytes, beta(100, 700))
      expect(result).toMatchObject({ ok: true, removed: 4, left: 0, shared: 0 })
      expect(await contentOf(out)).toContain('/Span <</MCID 3>> BDC')
      const saved = latin1(await (await PDFDocument.load(out)).save({ useObjectStreams: false }))
      expect(saved).not.toContain('ActualText')
      expect(saved).toContain('/MC1')
    })
  })

  it('changes nothing when the rectangles hit nothing', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    const { result, touched, out } = await scrub(bytes, { x: 300, y: 100, w: 50, h: 50 })
    expect(result).toMatchObject({ ok: true, removed: 0, left: 0, textOps: 2, reason: '' })
    expect(touched).toBe(false)
    expect(await contentOf(out)).toBe(await contentOf(bytes))
  })

  it('refuses a page it cannot line up with what pdf.js draws', async () => {
    // pdf.js skips text shown before any font is set, so it sees one operator
    // where the stream has two.
    const bytes = await written('BT 100 750 Td (ghost) Tj ET BT /F1 12 Tf 100 700 Td (alpha beta gamma) Tj ET')
    const { result, touched, out } = await scrub(bytes, beta(100, 700))
    expect(result.ok).toBe(false)
    expect(result.removed).toBe(0)
    expect(result.reason).not.toBe('')
    expect(touched).toBe(false)
    expect(await contentOf(out)).toBe(await contentOf(bytes))
    expect(await textOf(out)).toContain('beta')
  })

  it('reports what it cannot split instead of guessing', async () => {
    // a stray name inside the array: pdf.js ignores it, we do not rewrite it
    const bytes = await written('BT /F1 12 Tf 100 700 Td [(alpha beta) /Odd ( gamma)] TJ ET')
    const { result, touched, out } = await scrub(bytes, beta(100, 700))
    expect(result).toMatchObject({ ok: true, removed: 0, left: 4 })
    expect(result.reason).not.toBe('')
    expect(touched).toBe(false)
    expect(await textOf(out)).toContain('beta')
  })

  it('works in unrotated user space on a page with /Rotate 90', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`, (doc, page) => page.setRotation(degrees(90)))
    expect((await (await openPdf(bytes)).getPage(1)).rotate).toBe(90)
    await expectBetaGone(bytes, beta(100, 700))
  })

  it('takes several rectangles at once', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    const rects = [zone(100, 100 + adv('alpha'), 700), zone(100 + adv('alpha beta '), 100 + adv('alpha beta gamma'), 700)]
    const { result, out } = await scrub(bytes, rects)
    expect(result).toMatchObject({ ok: true, removed: 10, left: 0 })
    const text = await textOf(out)
    expect(text).toContain('beta')
    expect(text).not.toContain('alpha')
    expect(text).not.toContain('gamma')
    await clean(out, rects)
  })

  it('follows a font set through an ExtGState', async () => {
    const bytes = await written('/GS1 gs BT 100 700 Td (alpha beta gamma) Tj /F2 12 Tf (NEXT) Tj ET', async (doc, page) => {
      const font = await doc.embedFont(StandardFonts.Helvetica)
      page.node.Resources().set(N('ExtGState'), doc.context.obj({ GS1: { Font: [font.ref, 12] } }))
    })
    expect(await textOf(bytes)).toContain('alpha beta gamma')
    await expectBetaGone(bytes, beta(100, 700))
  })

  it('removes glyphs of a Type3 font', async () => {
    const bytes = await written('BT /T3 12 Tf 100 700 Td (abcabc) Tj /F2 12 Tf (NEXT) Tj ET', (doc, page) => {
      const box = doc.context.register(doc.context.stream('600 0 0 0 500 700 d1 0 0 500 700 re f'))
      page.node.setFontDictionary(N('T3'), doc.context.register(doc.context.obj({
        Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 600, 700], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: { a: box, b: box, c: box },
        Encoding: { Type: 'Encoding', Differences: [97, N('a'), N('b'), N('c')] },
        FirstChar: 97, LastChar: 99, Widths: [600, 600, 600], Resources: {}
      })))
    })
    // glyphs are 7.2pt wide; take the third and fourth
    const rect = zone(100 + 14.4, 100 + 28.8, 700)
    const before = runWith((await runsOf(bytes))[0], 'NEXT')
    expect(Math.abs(before.x - (100 + 6 * 7.2))).toBeLessThan(0.01)
    const { result, out } = await scrub(bytes, rect)
    expect(result).toMatchObject({ ok: true, removed: 2, left: 0 })
    expect((await textOf(out)).replace(/\s+/g, '')).toBe('abbcNEXT')
    expect(Math.abs(runWith((await runsOf(out))[0], 'NEXT').x - before.x)).toBeLessThan(0.01)
    await clean(out, rect)
  })

  describe('a page pdf-lib has already drawn on', () => {
    it('leaves what was drawn in this session alone, before and after', async () => {
      const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
      const rect = beta(100, 700)
      const { result, out } = await scrub(bytes, rect, 1, {
        // a replacement word, typed exactly where the old one was
        before: async (doc, page) => page.drawText('COVER', {
          x: 100 + adv('alpha '), y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica)
        }),
        after: async (doc, page) => page.drawText('LATER', {
          x: 100, y: 600, size: 12, font: await doc.embedFont(StandardFonts.Helvetica)
        })
      })
      expect(result).toMatchObject({ ok: true, removed: 4, left: 0, textOps: 2 })
      const text = await textOf(out)
      for (const word of ['alpha', 'gamma', 'NEXT', 'COVER', 'LATER']) expect(text).toContain(word)
      expect(text).not.toContain('beta')

      // The original operators come first, so looking at only those shows
      // that the old word is gone even though a new one sits in its place.
      const pdfPage = await (await openPdf(out)).getPage(1)
      expect(await glyphsInRects({ pdfPage, rects: [rect], pdfjsLib, limit: result.textOps })).toBe(0)
      expect(await glyphsInRects({ pdfPage, rects: [rect], pdfjsLib })).toBeGreaterThan(0)
    })
  })

  it('never throws', async () => {
    expect(await scrubPageText()).toMatchObject({ ok: false, removed: 0, left: 0 })
    expect(await scrubPageText({ rects: [{ x: 0, y: 0, w: 10, h: 10 }] })).toMatchObject({ ok: false })
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    const pdfPage = await (await openPdf(bytes)).getPage(1)
    const broken = await scrubPageText({ doc: {}, page: {}, pdfPage, rects: [beta(100, 700)], pdfjsLib })
    expect(broken.ok).toBe(false)
    expect(broken.reason).not.toBe('')
  })
})

describe('glyphsInRects', () => {
  it('counts the glyphs whose centre is inside', async () => {
    const bytes = await written(`BT /F1 12 Tf 100 700 Td ${LINE} ET`)
    const pdfPage = await (await openPdf(bytes)).getPage(1)
    expect(await glyphsInRects({ pdfPage, rects: [beta(100, 700)], pdfjsLib })).toBe(4)
    expect(await glyphsInRects({ pdfPage, rects: [{ x: 0, y: 0, w: 595, h: 842 }], pdfjsLib })).toBe(20)
    expect(await glyphsInRects({ pdfPage, rects: [{ x: 0, y: 0, w: 595, h: 842 }], pdfjsLib, limit: 1 })).toBe(16)
    expect(await glyphsInRects({ pdfPage, rects: [{ x: 0, y: 0, w: 595, h: 842 }], pdfjsLib, limit: 0 })).toBe(0)
    expect(await glyphsInRects({ pdfPage, rects: [], pdfjsLib })).toBe(0)
  })

  it('answers -1 when the page cannot be walked', async () => {
    expect(await glyphsInRects()).toBe(-1)
    expect(await glyphsInRects({ pdfPage: {}, rects: [], pdfjsLib })).toBe(-1)
  })
})
