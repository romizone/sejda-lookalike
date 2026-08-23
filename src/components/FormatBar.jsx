import React from 'react'
import { ACT } from '../store'

export default function FormatBar({ state, dispatch }) {
  const { activeText, selection, pages } = state
  const target = activeText

  let el = null
  if (target) {
    const p = pages[target.page]
    if (p) el = target.kind === 'line' ? p.lines.find(l => l.id === target.id) : p.objects.find(o => o.id === target.id)
  }

  const selObj = selection && selection.kind === 'obj'
    ? (pages[selection.page]?.objects || []).find(o => o.id === selection.id)
    : null

  const patch = p => {
    if (!target) return
    dispatch({ type: ACT.TEXT_PATCH, page: target.page, kind: target.kind, id: target.id, patch: p })
  }

  const patchObj = p => {
    if (!selObj) return
    dispatch({ type: ACT.PUSH })
    dispatch({ type: ACT.OBJ_PATCH, page: selection.page, id: selObj.id, patch: p })
  }

  const remove = () => {
    if (target && target.kind === 'obj') {
      dispatch({ type: ACT.OBJ_REMOVE, page: target.page, id: target.id })
      dispatch({ type: ACT.TEXT_DEACTIVATE })
    } else if (target && target.kind === 'line') {
      dispatch({ type: ACT.PUSH })
      dispatch({ type: ACT.OBJ_REMOVE, page: target.page, id: '__none__', lineId: target.id })
      dispatch({ type: ACT.TEXT_DEACTIVATE })
    } else if (selObj) {
      dispatch({ type: ACT.OBJ_REMOVE, page: selection.page, id: selObj.id })
    }
  }

  if (!el && !selObj) return null

  return (
    <div className="formatbar" onMouseDown={e => e.preventDefault()}>
      {el && (
        <>
          <span className="fb-label">Font</span>
          <select
            className="fb-select"
            value={el.family || 'sans-serif'}
            onChange={e => patch({ family: e.target.value })}
          >
            <option value="sans-serif">Helvetica / Sans</option>
            <option value="serif">Times / Serif</option>
            <option value="monospace">Courier / Mono</option>
          </select>

          <input
            className="fb-num" type="number" min={4} max={200}
            value={Math.round((el.fontSize || 12) * 10) / 10}
            onChange={e => patch({ fontSize: Math.max(4, Math.min(200, Number(e.target.value) || 12)) })}
            title="Font size"
          />
          <button className="fb-btn" title="Smaller" onClick={() => patch({ fontSize: Math.max(4, (el.fontSize || 12) - 1) })}>−</button>
          <button className="fb-btn" title="Bigger" onClick={() => patch({ fontSize: (el.fontSize || 12) + 1 })}>+</button>

          <div className="fb-sep" />

          <button className={`fb-btn ${el.bold ? 'on' : ''}`} style={{ fontWeight: 800 }} onClick={() => patch({ bold: !el.bold })}>B</button>
          <button className={`fb-btn ${el.italic ? 'on' : ''}`} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }} onClick={() => patch({ italic: !el.italic })}>I</button>
          <button className={`fb-btn ${el.underline ? 'on' : ''}`} style={{ textDecoration: 'underline' }} onClick={() => patch({ underline: !el.underline })}>U</button>

          <div className="fb-sep" />

          <input
            className="fb-color" type="color"
            value={el.color || '#111111'}
            title="Text color"
            onChange={e => patch({ color: e.target.value })}
          />

          <div className="fb-sep" />
        </>
      )}

      {selObj && selObj.kind !== 'text' && selObj.kind !== 'whiteout' && selObj.kind !== 'image' && (
        <>
          <span className="fb-label">Stroke</span>
          <input className="fb-color" type="color" value={selObj.stroke || '#2563eb'} onChange={e => patchObj({ stroke: e.target.value })} />
          {(selObj.kind === 'rect' || selObj.kind === 'ellipse') && (
            <>
              <span className="fb-label">Fill</span>
              <input className="fb-color" type="color" value={selObj.fill && selObj.fill !== 'none' ? selObj.fill : '#ffffff'} onChange={e => patchObj({ fill: e.target.value })} />
              <button className={`fb-btn ${(!selObj.fill || selObj.fill === 'none') ? 'on' : ''}`} onClick={() => patchObj({ fill: (!selObj.fill || selObj.fill === 'none') ? '#dbeedd' : 'none' })}>
                {(!selObj.fill || selObj.fill === 'none') ? 'No fill' : 'Clear fill'}
              </button>
            </>
          )}
          <label className="fb-label">Width</label>
          <input
            className="fb-num" type="number" min={1} max={40}
            value={selObj.strokeWidth || 2}
            onChange={e => patchObj({ strokeWidth: Math.max(1, Math.min(40, Number(e.target.value) || 2)) })}
          />
          <div className="fb-sep" />
        </>
      )}

      <button className="fb-btn" title="Delete" onClick={remove}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d33" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
      </button>
      <div style={{ flex: 1 }} />
      <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => { dispatch({ type: ACT.TEXT_DEACTIVATE }); dispatch({ type: ACT.SELECT, sel: null }) }}>
        Done
      </button>
    </div>
  )
}
