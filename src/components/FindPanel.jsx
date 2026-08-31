import React, { useMemo, useState } from 'react'
import { ACT } from '../store'

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Pages are keyed by page-order entry, which is not a number once a blank page
// has been inserted, so the walk follows the order rather than the key names.
function matchesIn(pages, order, needle, caseSensitive) {
  if (!needle) return []
  const re = new RegExp(escape(needle), caseSensitive ? 'g' : 'gi')
  const out = []
  order.forEach((entry, pos) => {
    const pi = entry.key
    const page = pages[pi]
    if (!page) return
    for (const ln of page.lines) {
      if (ln.deleted) continue
      re.lastIndex = 0
      let m
      while ((m = re.exec(ln.text))) {
        out.push({ page: pi, pos, id: ln.id, index: m.index })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
    for (const ob of page.objects) {
      if (ob.kind !== 'text') continue
      re.lastIndex = 0
      let m
      while ((m = re.exec(ob.text || ''))) {
        out.push({ page: pi, pos, id: ob.id, kind: 'obj', index: m.index })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
  })
  return out
}

export default function FindPanel({ state, dispatch, onGoTo }) {
  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [cursor, setCursor] = useState(0)

  const hits = useMemo(
    () => matchesIn(state.pages, state.pageOrder, needle, caseSensitive),
    [state.pages, state.pageOrder, needle, caseSensitive]
  )

  const close = () => dispatch({ type: ACT.PANEL, panel: null })

  const step = dir => {
    if (!hits.length) return
    const next = (cursor + dir + hits.length) % hits.length
    setCursor(next)
    const h = hits[next]
    onGoTo(h.pos)
    dispatch({
      type: ACT.TEXT_ACTIVATE,
      target: { kind: h.kind === 'obj' ? 'obj' : 'line', page: h.page, id: h.id }
    })
  }

  const replaceAll = () => {
    if (!needle || !hits.length) return
    const re = new RegExp(escape(needle), caseSensitive ? 'g' : 'gi')
    dispatch({ type: ACT.PUSH })
    const seen = new Set()
    for (const h of hits) {
      const key = h.page + '/' + h.id
      if (seen.has(key)) continue
      seen.add(key)
      const kind = h.kind === 'obj' ? 'obj' : 'line'
      const bag = kind === 'obj' ? state.pages[h.page].objects : state.pages[h.page].lines
      const item = bag.find(x => x.id === h.id)
      if (!item) continue
      re.lastIndex = 0
      dispatch({
        type: ACT.TEXT_PATCH,
        page: h.page,
        kind,
        id: h.id,
        patch: { text: (item.text || '').replace(re, replacement), runs: undefined }
      })
    }
    setCursor(0)
  }

  return (
    <div className="findbar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input
        className="find-input"
        placeholder="Find in document"
        value={needle}
        onChange={e => { setNeedle(e.target.value); setCursor(0) }}
        autoFocus
      />
      <span className="find-count">
        {needle ? (hits.length ? `${Math.min(cursor + 1, hits.length)} / ${hits.length}` : 'No results') : ''}
      </span>
      <button className="fb-btn" title="Previous" disabled={!hits.length} onClick={() => step(-1)}>‹</button>
      <button className="fb-btn" title="Next" disabled={!hits.length} onClick={() => step(1)}>›</button>

      <div className="fb-sep" />

      <input
        className="find-input"
        placeholder="Replace with"
        value={replacement}
        onChange={e => setReplacement(e.target.value)}
      />
      <button className="btn btn-white find-replace" disabled={!hits.length} onClick={replaceAll}>
        Replace all
      </button>

      <label className="find-case">
        <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
        Match case
      </label>

      <div style={{ flex: 1 }} />
      <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={close}>Done</button>
    </div>
  )
}
