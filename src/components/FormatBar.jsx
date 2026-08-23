import React from 'react'
import { ACT } from '../store'
import { domToRuns, runsText, isPlain } from '../lib/runs'

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

  // The format bar preserves the page selection (it cancels its own mousedown),
  // so a live selection means the change belongs to those characters rather
  // than to the whole block.
  const selectedBox = () => {
    if (!target) return null
    const el = document.querySelector(`[data-id="${target.id}"]`)
    const sel = window.getSelection()
    if (!el || !sel || !sel.rangeCount || sel.isCollapsed) return null
    return el.contains(sel.getRangeAt(0).commonAncestorContainer) ? el : null
  }

  const commitRuns = el => {
    const runs = domToRuns(el)
    dispatch({
      type: ACT.TEXT_PATCH,
      page: target.page,
      kind: target.kind,
      id: target.id,
      patch: { text: runsText(runs), runs: isPlain(runs) ? undefined : runs }
    })
  }

  const onSelection = fn => {
    const el = selectedBox()
    if (!el) return false
    dispatch({ type: ACT.PUSH })
    fn(el)
    commitRuns(el)
    return true
  }

  const cmd = (name, value) => onSelection(() => {
    document.execCommand('styleWithCSS', false, true)
    document.execCommand(name, false, value)
  })

  const sizeSelection = px => onSelection(el => {
    // execCommand only speaks the 1-7 scale, so the marker it leaves behind is
    // swapped for a span carrying the exact size.
    document.execCommand('styleWithCSS', false, false)
    document.execCommand('fontSize', false, '7')
    el.querySelectorAll('font[size="7"]').forEach(f => {
      const span = document.createElement('span')
      span.style.fontSize = `${px}px`
      while (f.firstChild) span.appendChild(f.firstChild)
      f.replaceWith(span)
    })
  })

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
            onChange={e => patch({ family: e.target.value, pdfFont: null })}
          >
            <option value="sans-serif">Helvetica / Sans</option>
            <option value="serif">Times / Serif</option>
            <option value="monospace">Courier / Mono</option>
          </select>

          <input
            className="fb-num" type="number" min={4} max={200}
            value={Math.round((el.fontSize || 12) * 10) / 10}
            onChange={e => {
              const px = Math.max(4, Math.min(200, Number(e.target.value) || 12))
              if (!sizeSelection(px)) patch({ fontSize: px })
            }}
            title="Font size"
          />
          <button className="fb-btn" title="Smaller" onClick={() => { const px = Math.max(4, (el.fontSize || 12) - 1); if (!sizeSelection(px)) patch({ fontSize: px }) }}>−</button>
          <button className="fb-btn" title="Bigger" onClick={() => { const px = (el.fontSize || 12) + 1; if (!sizeSelection(px)) patch({ fontSize: px }) }}>+</button>

          <div className="fb-sep" />

          <button className={`fb-btn ${el.bold ? 'on' : ''}`} style={{ fontWeight: 800 }} onClick={() => { if (!cmd('bold')) patch({ bold: !el.bold }) }}>B</button>
          <button className={`fb-btn ${el.italic ? 'on' : ''}`} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }} onClick={() => { if (!cmd('italic')) patch({ italic: !el.italic }) }}>I</button>
          <button className={`fb-btn ${el.underline ? 'on' : ''}`} style={{ textDecoration: 'underline' }} onClick={() => { if (!cmd('underline')) patch({ underline: !el.underline }) }}>U</button>

          <div className="fb-sep" />

          <input
            className="fb-color" type="color"
            value={el.color || '#111111'}
            title="Text color"
            onChange={e => { if (!cmd('foreColor', e.target.value)) patch({ color: e.target.value }) }}
          />

          <div className="fb-sep" />
        </>
      )}

      {selObj && selObj.kind === 'link' && (
        <>
          <span className="fb-label">Link URL</span>
          <input
            className="fb-url"
            type="url"
            placeholder="https://example.com"
            value={selObj.url || ''}
            onChange={e => patchObj({ url: e.target.value })}
          />
          <div className="fb-sep" />
        </>
      )}

      {selObj && selObj.kind === 'field' && (
        <>
          <span className="fb-label">Field name</span>
          <input
            className="fb-url"
            value={selObj.name || ''}
            onChange={e => patchObj({ name: e.target.value })}
          />
          {(selObj.fieldType === 'dropdown' || selObj.fieldType === 'radio') && (
            <>
              <span className="fb-label">Choices</span>
              <input
                className="fb-url"
                placeholder="Option 1, Option 2"
                value={(selObj.options || []).join(', ')}
                onChange={e => patchObj({ options: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
              />
            </>
          )}
          <div className="fb-sep" />
        </>
      )}

      {selObj && selObj.kind === 'mark' && (
        <>
          <span className="fb-label">{selObj.variant === 'highlight' ? 'Highlight' : selObj.variant === 'strike' ? 'Strikethrough' : 'Underline'}</span>
          <input
            className="fb-color"
            type="color"
            value={selObj.color || '#ffe14d'}
            onChange={e => patchObj({ color: e.target.value })}
          />
          <div className="fb-sep" />
        </>
      )}

      {selObj && (selObj.kind === 'rect' || selObj.kind === 'ellipse' || selObj.kind === 'line' || selObj.kind === 'arrow') && (
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
