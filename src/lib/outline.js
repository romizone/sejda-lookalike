import { BASE_SCALE } from '../utils/misc'
import { extractLines } from './extract'

async function destinationPage(doc, item) {
  let dest = item.dest
  if (typeof dest === 'string') {
    try { dest = await doc.getDestination(dest) } catch { return null }
  }
  if (!Array.isArray(dest) || !dest[0]) return null
  try { return await doc.getPageIndex(dest[0]) } catch { return null }
}

// The outline the document already carries, flattened.
export async function readOutline(doc) {
  let tree = null
  try { tree = await doc.getOutline() } catch { return [] }
  if (!tree || !tree.length) return []

  const out = []
  const walk = async (items, depth) => {
    for (const item of items) {
      const page = await destinationPage(doc, item)
      if (page != null) out.push({ title: item.title || 'Untitled', page, depth })
      if (item.items?.length) await walk(item.items, depth + 1)
    }
  }
  await walk(tree, 0)
  out.sort((a, b) => a.page - b.page)
  return out
}

// Lines set noticeably larger than the body text read as headings.
export async function detectHeadings(doc, { maxPerPage = 3 } = {}) {
  const found = []
  const sizes = []
  const perPage = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const lines = (await extractLines(page, BASE_SCALE, i - 1)).filter(l => l.text.trim())
    perPage.push(lines)
    for (const l of lines) sizes.push(l.fontSize)
  }
  if (!sizes.length) return []

  sizes.sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)]
  const threshold = median * 1.28

  perPage.forEach((lines, pageIndex) => {
    lines
      .filter(l => l.fontSize >= threshold && l.text.trim().length > 2 && l.text.trim().length < 120)
      .sort((a, b) => b.fontSize - a.fontSize || a.baselineY - b.baselineY)
      .slice(0, maxPerPage)
      .sort((a, b) => a.baselineY - b.baselineY)
      .forEach(l => found.push({ title: l.text.trim().replace(/\s+/g, ' '), page: pageIndex }))
  })

  return found
}

// The value a page is grouped by: either a pattern's first capture, or the
// first line of text on the page.
export async function pageKeys(doc, pattern) {
  const re = pattern ? new RegExp(pattern, 'i') : null
  const keys = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const lines = (await extractLines(page, BASE_SCALE, i - 1)).filter(l => l.text.trim())
    const text = lines.map(l => l.text).join('\n')
    if (re) {
      const m = re.exec(text)
      keys.push(m ? (m[1] ?? m[0]).trim() : '')
    } else {
      keys.push((lines[0]?.text || '').trim())
    }
  }
  return keys
}

// Page numbers where the grouping value changes.
export const boundariesOf = keys =>
  keys.map((k, i) => (i > 0 && k !== keys[i - 1] ? i : -1)).filter(i => i > 0)

export async function firstLines(doc, pageIndex, limit = 20) {
  const page = await doc.getPage(pageIndex + 1)
  const lines = await extractLines(page, BASE_SCALE, pageIndex)
  return lines
    .map(l => l.text.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, limit)
}
