import pdfjs from './pdfjs'

async function renderPage(page, dpi) {
  const vp = page.getViewport({ scale: dpi / 72 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  return canvas
}

const toBytes = (canvas, type, quality) =>
  new Promise(resolve => canvas.toBlob(async b => {
    resolve(b ? new Uint8Array(await b.arrayBuffer()) : null)
  }, type, quality))

export async function pagesToImages(bytes, { format = 'jpeg', dpi = 150, quality = 0.9, baseName }, onProgress) {
  const clone = new Uint8Array(bytes.byteLength)
  clone.set(new Uint8Array(bytes))
  const doc = await pdfjs.getDocument({ data: clone }).promise
  const ext = format === 'png' ? 'png' : 'jpg'
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  const files = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const canvas = await renderPage(page, dpi)
    const data = await toBytes(canvas, mime, quality)
    if (data) files.push({ name: `${baseName}-${String(i).padStart(2, '0')}.${ext}`, data, mime })
    onProgress?.(i / doc.numPages)
  }
  if (!files.length) throw new Error('Nothing could be rendered from this document.')
  return files
}

export async function pdfToText(bytes, onProgress) {
  const clone = new Uint8Array(bytes.byteLength)
  clone.set(new Uint8Array(bytes))
  const doc = await pdfjs.getDocument({ data: clone }).promise
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    // Items carry their own position, so lines are rebuilt from the y they sit on.
    const rows = new Map()
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str) continue
      const y = Math.round(it.transform[5])
      let bucket = null
      for (const key of rows.keys()) if (Math.abs(key - y) <= 2) { bucket = key; break }
      const list = rows.get(bucket ?? y) || []
      list.push({ x: it.transform[4], s: it.str })
      rows.set(bucket ?? y, list)
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, list]) => list.sort((a, b) => a.x - b.x).map(i => i.s).join('').replace(/\s+$/, ''))
    out.push(lines.join('\n'))
    onProgress?.(i / doc.numPages)
  }
  const text = out.join('\n\n\f\n\n')
  if (!text.trim()) throw new Error('This PDF holds no text — it looks like a scan. Run OCR on it in the PDF Editor first.')
  return text
}

// pdf.js decodes every image kind into a bitmap, so pulling them out through
// the operator list works for JPEG, PNG-like and mask-backed pictures alike.
export async function extractImages(bytes, { baseName }, onProgress) {
  const clone = new Uint8Array(bytes.byteLength)
  clone.set(new Uint8Array(bytes))
  const doc = await pdfjs.getDocument({ data: clone }).promise
  const files = []
  const seen = new Set()

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const ops = await page.getOperatorList()
    for (let k = 0; k < ops.fnArray.length; k++) {
      const name = ops.argsArray[k]?.[0]
      if (typeof name !== 'string' || !/^(img_|g_)/.test(name)) continue
      if (seen.has(name)) continue
      let obj = null
      try {
        obj = page.objs.has(name) ? page.objs.get(name) : null
      } catch { obj = null }
      if (!obj || !obj.width || !obj.height) continue
      seen.add(name)

      const canvas = document.createElement('canvas')
      canvas.width = obj.width
      canvas.height = obj.height
      const ctx = canvas.getContext('2d')
      try {
        if (obj.bitmap) ctx.drawImage(obj.bitmap, 0, 0)
        else if (obj.data) {
          const img = ctx.createImageData(obj.width, obj.height)
          const src = obj.data
          if (src.length === obj.width * obj.height * 4) img.data.set(src)
          else if (src.length === obj.width * obj.height * 3) {
            for (let p = 0, q = 0; p < src.length; p += 3, q += 4) {
              img.data[q] = src[p]; img.data[q + 1] = src[p + 1]; img.data[q + 2] = src[p + 2]; img.data[q + 3] = 255
            }
          } else continue
          ctx.putImageData(img, 0, 0)
        } else continue
      } catch { continue }

      const data = await toBytes(canvas, 'image/png')
      if (data && obj.width > 8 && obj.height > 8) {
        files.push({ name: `${baseName}-p${i}-${files.length + 1}.png`, data, mime: 'image/png' })
      }
    }
    onProgress?.(i / doc.numPages)
  }
  if (!files.length) throw new Error('No pictures were found inside this PDF.')
  return files
}
