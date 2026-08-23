import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

function wrap(font, text, size, maxWidth) {
  const words = text.split(/\s+/)
  const out = []
  let line = ''
  for (const w of words) {
    const t = line ? line + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) > maxWidth && line) {
      out.push(line)
      line = w
    } else line = t
  }
  if (line) out.push(line)
  return out
}

export async function makeSamplePdf() {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)
  const times = await doc.embedFont(StandardFonts.TimesRoman)

  const green = rgb(0.25, 0.65, 0.29)
  const dark = rgb(0.13, 0.15, 0.18)
  const gray = rgb(0.45, 0.48, 0.52)
  const light = rgb(0.92, 0.94, 0.93)

  const p1 = doc.addPage([595, 842])
  p1.drawRectangle({ x: 0, y: 762, width: 595, height: 80, color: green })
  p1.drawText('EditPDF', { x: 50, y: 800, size: 24, font: helvB, color: rgb(1, 1, 1) })
  p1.drawText('Sample document', { x: 50, y: 778, size: 11, font: helv, color: rgb(0.9, 0.97, 0.9) })

  p1.drawText('Quarterly Business Review', { x: 50, y: 700, size: 26, font: helvB, color: dark })
  p1.drawText('Prepared by the Product Team - August 2026', { x: 50, y: 676, size: 12, font: helv, color: gray })
  p1.drawLine({ start: { x: 50, y: 660 }, end: { x: 545, y: 660 }, thickness: 1, color: light })

  const body = 'This is a sample PDF you can use to try the editor. Click on any line of text to edit it in place, just like Sejda. Drag the Whiteout tool over content to erase it, add new text boxes anywhere on the page, insert images and draw shapes. Everything runs locally in your browser - your document is never uploaded anywhere.'
  let y = 630
  for (const ln of wrap(helv, body, 11, 495)) {
    p1.drawText(ln, { x: 50, y, size: 11, font: helv, color: dark })
    y -= 17
  }

  p1.drawText('Key highlights', { x: 50, y: y - 14, size: 16, font: helvB, color: green })
  y -= 44
  const bullets = [
    'Revenue grew 24% quarter over quarter across all regions.',
    'Churn dropped to an all-time low of 1.8% after the redesign.',
    'Two new enterprise customers signed multi-year contracts.',
    'Support response time improved from 6h to 42 minutes.'
  ]
  for (const b of bullets) {
    p1.drawCircle({ x: 56, y: y + 4, size: 2.4, color: green })
    p1.drawText(b, { x: 68, y, size: 11.5, font: helv, color: dark })
    y -= 22
  }

  y -= 20
  p1.drawText('Regional performance', { x: 50, y, size: 16, font: helvB, color: green })
  y -= 26
  const cols = [50, 230, 340, 450]
  const rows = [['Region', 'Revenue', 'Growth', 'Target'], ['North America', '$1.24M', '+31%', '$1.10M'], ['Europe', '$860K', '+19%', '$800K'], ['Asia Pacific', '$540K', '+27%', '$500K'], ['Latin America', '$210K', '+12%', '$220K']]
  p1.drawRectangle({ x: 46, y: y - 6, width: 503, height: 22, color: light })
  rows.forEach((r, ri) => {
    r.forEach((c, ci) => {
      p1.drawText(c, { x: cols[ci] + 4, y: y + (ri === rows.length - 1 ? -26 : 0), size: 10.5, font: ri === 0 ? helvB : helv, color: ri === 0 ? dark : rgb(0.25, 0.28, 0.32) })
    })
    y -= 22
    if (ri === 0 || ri === rows.length - 2) p1.drawLine({ start: { x: 46, y: y + 16 }, end: { x: 549, y: y + 16 }, thickness: 0.7, color: light })
  })

  p1.drawText('EditPDF - page 1 of 2', { x: 50, y: 30, size: 9, font: helv, color: gray })

  const p2 = doc.addPage([595, 842])
  p2.drawText('Notes on collaboration', { x: 50, y: 760, size: 22, font: helvB, color: dark })
  p2.drawLine({ start: { x: 50, y: 744 }, end: { x: 545, y: 744 }, thickness: 2, color: green })

  const para = 'Editing a PDF should feel as easy as editing a text document. Select a line, retype it, change the font size or color, then press Apply Changes to download the result. The original layout, images and vector graphics are preserved exactly - only the parts you touched are rebuilt.'
  y = 710
  for (const ln of wrap(times, para, 12.5, 495)) {
    p2.drawText(ln, { x: 50, y, size: 12.5, font: times, color: dark })
    y -= 19
  }

  p2.drawRectangle({ x: 50, y: y - 66, width: 495, height: 74, color: rgb(0.93, 0.96, 0.99), borderColor: rgb(0.47, 0.67, 0.9), borderWidth: 1 })
  p2.drawText('TIP', { x: 64, y: y - 12, size: 10, font: helvB, color: rgb(0.15, 0.4, 0.75) })
  const tip = 'Use the Whiteout tool to cleanly remove sensitive information before sharing a document.'
  let ty = y - 34
  for (const ln of wrap(helv, tip, 10.5, 440)) {
    p2.drawText(ln, { x: 64, y: ty, size: 10.5, font: helv, color: dark })
    ty -= 15
  }

  p2.drawText('Sign-off', { x: 50, y: 200, size: 12, font: helvB, color: dark })
  p2.drawLine({ start: { x: 50, y: 160 }, end: { x: 300, y: 160 }, thickness: 1, color: gray })
  p2.drawText('Product Lead', { x: 50, y: 142, size: 9.5, font: helv, color: gray })
  p2.drawLine({ start: { x: 330, y: 160 }, end: { x: 545, y: 160 }, thickness: 1, color: gray })
  p2.drawText('Date', { x: 330, y: 142, size: 9.5, font: helv, color: gray })
  p2.drawText('EditPDF - page 2 of 2', { x: 50, y: 30, size: 9, font: helv, color: gray })

  return doc.save()
}
