import { zipSync } from './zip'

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const FONT = {
  serif: 'Times New Roman',
  'sans-serif': 'Arial',
  monospace: 'Courier New'
}

const TWIP = 20 // twentieths of a point

function paragraph(block, pageWidthPt) {
  const sizeHalfPoints = Math.max(2, Math.round(block.fontSizePt * 2))
  const font = FONT[block.family] || FONT['sans-serif']

  const leftPt = block.xPt
  const rightPt = Math.max(0, pageWidthPt - (block.xPt + block.wPt))
  const centred = leftPt > pageWidthPt * 0.12 && Math.abs(leftPt - rightPt) < pageWidthPt * 0.06

  const pPr = [
    centred ? '<w:jc w:val="center"/>' : '',
    !centred && leftPt > 4 ? `<w:ind w:left="${Math.round(leftPt * TWIP)}"/>` : '',
    '<w:spacing w:after="80"/>'
  ].join('')

  const rPr = [
    `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}"/>`,
    block.bold ? '<w:b/>' : '',
    block.italic ? '<w:i/>' : '',
    block.color && block.color !== '#000000' ? `<w:color w:val="${block.color.replace('#', '').toUpperCase()}"/>` : '',
    `<w:sz w:val="${sizeHalfPoints}"/><w:szCs w:val="${sizeHalfPoints}"/>`
  ].join('')

  // A block holds one flowing paragraph; hard breaks inside it stay as breaks.
  const runs = String(block.text)
    .split('\n')
    .map((line, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t>`)
    .join('')

  return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr>${runs}</w:r></w:p>`
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

export function buildDocx(pages) {
  const first = pages[0] || { widthPt: 595, heightPt: 842 }
  const body = pages
    .map(page => page.blocks.map(b => paragraph(b, page.widthPt)).join(''))
    .join(PAGE_BREAK)

  const sectPr =
    `<w:sectPr><w:pgSz w:w="${Math.round(first.widthPt * TWIP)}" w:h="${Math.round(first.heightPt * TWIP)}"/>` +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}${sectPr}</w:body></w:document>`

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>'

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>'

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'

  const zip = zipSync([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/document.xml', data: document }
  ])

  return new Blob([zip], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
}
