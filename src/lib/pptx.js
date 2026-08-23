import { zipSync } from './zip'

// One slide per page, each carrying a picture of that page. A layout-faithful
// conversion would have to rebuild every shape; this keeps the pages exactly as
// they look, which is what a deck made from a PDF is usually for.

const EMU = 914400 // English metric units per inch
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PML = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const DML = 'http://schemas.openxmlformats.org/drawingml/2006/main'

const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function slideXml(index) {
  return `${head}<p:sld xmlns:a="${DML}" xmlns:r="${RELS}" xmlns:p="${PML}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${index + 1}"/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="__CX__" cy="__CY__"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" ' +
    'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" ' +
    'accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>'
}

const slideRels = ext => `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${RELS}/image" Target="../media/image1.${ext}"/>` +
  `<Relationship Id="rId2" Type="${RELS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  '</Relationships>'

const BLANK_LAYOUT = `${head}<p:sldLayout xmlns:a="${DML}" xmlns:r="${RELS}" xmlns:p="${PML}" type="blank" preserve="1">` +
  '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'

const MASTER = `${head}<p:sldMaster xmlns:a="${DML}" xmlns:r="${RELS}" xmlns:p="${PML}">` +
  '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  '</p:spTree></p:cSld>' +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
  'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'

const MASTER_RELS = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${RELS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="${RELS}/theme" Target="../theme/theme1.xml"/>` +
  '</Relationships>'

const LAYOUT_RELS = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${RELS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
  '</Relationships>'

const colour = (name, val) => `<a:${name}><a:srgbClr val="${val}"/></a:${name}>`

const THEME = `${head}<a:theme xmlns:a="${DML}" name="Blank"><a:themeElements>` +
  '<a:clrScheme name="Blank">' +
  colour('dk1', '000000') + colour('lt1', 'FFFFFF') + colour('dk2', '44546A') + colour('lt2', 'E7E6E6') +
  colour('accent1', '4472C4') + colour('accent2', 'ED7D31') + colour('accent3', 'A5A5A5') +
  colour('accent4', 'FFC000') + colour('accent5', '5B9BD5') + colour('accent6', '70AD47') +
  colour('hlink', '0563C1') + colour('folHlink', '954F72') +
  '</a:clrScheme>' +
  '<a:fontScheme name="Blank"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Blank">' +
  '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements></a:theme>'

export function buildPptx(slides, { widthInches, heightInches }) {
  const cx = Math.round(widthInches * EMU)
  const cy = Math.round(heightInches * EMU)

  const presentation = `${head}<p:presentation xmlns:a="${DML}" xmlns:r="${RELS}" xmlns:p="${PML}">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:sldIdLst>' +
    slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('') +
    '</p:sldIdLst>' +
    `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/></p:presentation>`

  const presentationRels = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${RELS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${RELS}/slide" Target="slides/slide${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${slides.length + 2}" Type="${RELS}/theme" Target="theme/theme1.xml"/>` +
    '</Relationships>'

  const ext = slides[0]?.mime === 'image/png' ? 'png' : 'jpeg'

  const contentTypes = `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Default Extension="${ext}" ContentType="image/${ext === 'png' ? 'png' : 'jpeg'}"/>` +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') +
    '</Types>'

  const rootRels = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${RELS}/officeDocument" Target="ppt/presentation.xml"/>` +
    '</Relationships>'

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: MASTER_RELS },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: BLANK_LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: LAYOUT_RELS },
    { name: 'ppt/theme/theme1.xml', data: THEME }
  ]

  slides.forEach((slide, i) => {
    entries.push({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: slideXml(i).replace('__CX__', String(cx)).replace('__CY__', String(cy))
    })
    entries.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${RELS}/image" Target="../media/image${i + 1}.${ext}"/>` +
        `<Relationship Id="rId2" Type="${RELS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        '</Relationships>'
    })
    entries.push({ name: `ppt/media/image${i + 1}.${ext}`, data: slide.data })
  })

  return new Blob([zipSync(entries)], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  })
}

export { esc, slideRels }
