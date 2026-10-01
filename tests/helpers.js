// Shared by the tests: fixtures are built with pdf-lib and read back with
// pdf.js, the same two libraries the application itself uses.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'

export { pdfjsLib }

export const toBytes = async b =>
  new Uint8Array(b instanceof Blob ? await b.arrayBuffer() : b)

// pdf.js takes ownership of the buffer it is handed, so it always gets a copy.
export const openPdf = async (b, opts = {}) =>
  pdfjsLib.getDocument({ data: (await toBytes(b)).slice(), verbosity: 0, ...opts }).promise

// A one-page document; `draw(page, font, doc)` puts the content on it.
export async function makePdf(draw, size = [595, 842]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage(size)
  if (draw) await draw(page, font, doc)
  return (await doc.save()).buffer
}

// All the text pdf.js can extract, pages separated by newlines.
export async function textOf(b, opts) {
  const doc = await openPdf(b, opts)
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    out.push(tc.items.map(it => it.str).join(' '))
  }
  return out.join('\n')
}

// Where each run of text sits in default user space, whatever the page boxes
// say. pdf.js drops text that falls outside the visible page, so the boxes are
// opened right up before reading.
export async function textPositions(b) {
  const doc = await PDFDocument.load(await toBytes(b))
  const boxes = doc.getPages().map(p => p.getCropBox())
  doc.getPages().forEach(p => {
    p.setMediaBox(-3000, -3000, 6000, 6000)
    p.setCropBox(-3000, -3000, 6000, 6000)
  })
  const view = await openPdf(await doc.save())
  const pages = []
  for (let i = 1; i <= view.numPages; i++) {
    const tc = await (await view.getPage(i)).getTextContent()
    pages.push(tc.items.filter(t => t.str.trim()).map(t => ({
      str: t.str, x: t.transform[4], y: t.transform[5], w: t.width
    })))
  }
  return { boxes, pages }
}

// The editor works in pdf.js viewport pixels at this scale, page unrotated.
export const BASE_SCALE = 2
export async function toEditor(b, pageNo, x, y) {
  const page = await (await openPdf(b)).getPage(pageNo)
  const vp = page.getViewport({ scale: BASE_SCALE, rotation: 0 })
  const [ex, ey] = vp.convertToViewportPoint(x, y)
  return { x: ex, y: ey }
}
