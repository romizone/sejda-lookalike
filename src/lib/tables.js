import { groupRows, pageSegments } from './extract'

// A cell boundary is a horizontal gap much wider than the spaces inside a
// phrase. Below this the runs belong to the same cell.
const CELL_GAP = 1.4

function rowToCells(group) {
  const runs = group.segs.filter(s => s.str.trim()).sort((a, b) => a.x - b.x)
  if (!runs.length) return null
  const cells = []
  let cur = null
  let pen = null
  for (const s of runs) {
    const gap = pen ? s.x - (pen.x + pen.w) : 0
    if (!cur || (pen && gap > Math.max(pen.h, s.h) * CELL_GAP)) {
      cur = { x: s.x, right: s.x + s.w, text: s.str }
      cells.push(cur)
    } else {
      if (gap > pen.h * 0.12 && !/\s$/.test(cur.text)) cur.text += ' '
      cur.text += s.str
      cur.right = s.x + s.w
    }
    pen = s
  }
  return { y: group.y, cells: cells.map(c => ({ ...c, text: c.text.replace(/\s+$/, '') })) }
}

// Cells that start at roughly the same place down the page belong to the same
// column, so the left edges are clustered and every cell snapped to one.
function buildColumns(rows, tolerance) {
  const starts = rows.flatMap(r => r.cells.map(c => c.x)).sort((a, b) => a - b)
  const columns = []
  for (const x of starts) {
    const last = columns[columns.length - 1]
    if (last && x - last.at <= tolerance) {
      last.at = (last.at * last.n + x) / (last.n + 1)
      last.n++
    } else {
      columns.push({ at: x, n: 1 })
    }
  }
  return columns.map(c => c.at)
}

const columnOf = (columns, x) => {
  let best = 0
  let dist = Infinity
  columns.forEach((at, i) => {
    const d = Math.abs(at - x)
    if (d < dist) { dist = d; best = i }
  })
  return best
}

export async function readTable(page, scale) {
  const { segs, width } = await pageSegments(page, scale)
  const rows = groupRows(segs).map(rowToCells).filter(Boolean)
  if (!rows.length) return { columns: 0, rows: [] }

  const columns = buildColumns(rows, Math.max(width * 0.012, 8))
  const grid = rows.map(row => {
    const line = new Array(columns.length).fill('')
    for (const cell of row.cells) {
      const i = columnOf(columns, cell.x)
      line[i] = line[i] ? `${line[i]} ${cell.text}` : cell.text
    }
    // Trailing empties carry no information and only widen the sheet.
    while (line.length && line[line.length - 1] === '') line.pop()
    return line
  })

  const used = grid.reduce((m, r) => Math.max(m, r.length), 0)
  return { columns: used, rows: grid.filter(r => r.some(c => c.trim())) }
}
