// A text block is stored as a plain string plus, when the user has formatted
// part of it, a list of runs. Keeping `text` in sync with the runs means find &
// replace, joining blocks and the exporter's fallback path all keep working
// without knowing about runs at all.

const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

export function cssColorToHex(v) {
  if (!v) return null
  const s = String(v).trim()
  if (s.startsWith('#')) {
    if (s.length === 4) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
    return s.slice(0, 7).toLowerCase()
  }
  const m = /rgba?\(([^)]+)\)/i.exec(s)
  if (!m) return null
  const p = m[1].split(',').map(x => parseFloat(x))
  if (p.length < 3 || p.some(Number.isNaN)) return null
  return '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2])
}

const sameStyle = (a, b) =>
  !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u &&
  (a.c || null) === (b.c || null) && (a.s || null) === (b.s || null)

export function mergeRuns(runs) {
  const out = []
  for (const r of runs) {
    if (!r.t) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, r)) last.t += r.t
    else out.push({ ...r })
  }
  return out
}

export function runsText(runs) {
  return (runs || []).map(r => r.t).join('')
}

export function isPlain(runs) {
  return !runs || runs.length === 0 || (runs.length === 1 && !runs[0].b && !runs[0].i && !runs[0].u && !runs[0].c && !runs[0].s)
}

export function domToRuns(el) {
  const runs = []
  const walk = (node, style) => {
    if (node.nodeType === 3) {
      if (node.nodeValue) runs.push({ t: node.nodeValue, ...style })
      return
    }
    if (node.nodeType !== 1) return
    const name = node.nodeName
    if (name === 'BR') { runs.push({ t: '\n', ...style }); return }

    const s = { ...style }
    const cs = node.style || {}
    const weight = cs.fontWeight || ''
    if (name === 'B' || name === 'STRONG' || weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600) s.b = true
    if (name === 'I' || name === 'EM' || cs.fontStyle === 'italic') s.i = true
    const deco = `${cs.textDecoration || ''} ${cs.textDecorationLine || ''}`
    if (name === 'U' || deco.includes('underline')) s.u = true
    if (name === 'S' || name === 'STRIKE' || deco.includes('line-through')) s.u = s.u || false
    const col = cssColorToHex(cs.color)
    if (col) s.c = col
    const fs = parseFloat(cs.fontSize)
    if (fs) s.s = fs

    node.childNodes.forEach(ch => walk(ch, s))
  }
  el.childNodes.forEach(n => walk(n, {}))
  return mergeRuns(runs)
}

const escapeHtml = t =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function runsToHtml(runs) {
  return (runs || [])
    .map(r => {
      const st = []
      if (r.b) st.push('font-weight:700')
      if (r.i) st.push('font-style:italic')
      if (r.u) st.push('text-decoration:underline')
      if (r.c) st.push(`color:${r.c}`)
      if (r.s) st.push(`font-size:${r.s}px`)
      const body = escapeHtml(r.t)
      return st.length ? `<span style="${st.join(';')}">${body}</span>` : body
    })
    .join('')
}

// Used when a block-level change (font size, family, colour) should reset the
// per-run overrides it would otherwise fight with.
export function stripRunProp(runs, prop) {
  if (!runs) return runs
  return mergeRuns(runs.map(r => {
    const c = { ...r }
    delete c[prop]
    return c
  }))
}

// Rebuild runs after the text changed wholesale (find & replace, joining two
// blocks): keep the styling only when the text is unchanged.
export function runsForText(prev, text) {
  if (!prev || !prev.length) return undefined
  if (runsText(prev) === text) return prev
  return undefined
}
