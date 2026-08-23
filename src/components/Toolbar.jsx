import React, { useRef } from 'react'
import { ACT } from '../store'

const I = {
  cursor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 3l14 8-6.5 1.5L9 19z" /></svg>,
  whiteout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m7 17 10-10" /></svg>,
  image: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 18 5-5 3 3 3.5-3.5L20 16" /></svg>,
  rect: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4.5" y="5.5" width="15" height="13" rx="1.5" /></svg>,
  ellipse: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="12" rx="8" ry="6.5" /></svg>,
  line: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 19 19 5" /></svg>,
  undo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>,
  redo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
}

export default function Toolbar({ state, dispatch }) {
  const imgInput = useRef(null)

  const tools = [
    { id: 'select', label: 'Select', icon: I.cursor },
    { id: 'text', label: 'Text', glyph: 'Aa' },
    { id: 'whiteout', label: 'Whiteout', icon: I.whiteout },
    { id: 'image', label: 'Image', icon: I.image, pick: true },
    { id: 'rect', label: 'Rectangle', icon: I.rect },
    { id: 'ellipse', label: 'Ellipse', icon: I.ellipse },
    { id: 'line', label: 'Line', icon: I.line }
  ]

  const onTool = (t) => {
    if (t.pick) {
      dispatch({ type: ACT.PENDING_IMG, img: null })
      imgInput.current?.click()
      return
    }
    dispatch({ type: ACT.SET_TOOL, tool: t.id })
  }

  const onImgFile = e => {
    const f = e.target.files?.[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      const im = new Image()
      im.onload = () => {
        dispatch({ type: ACT.PENDING_IMG, img: { src: rd.result, nw: im.naturalWidth || 200, nh: im.naturalHeight || 200 } })
      }
      im.src = rd.result
    }
    rd.readAsDataURL(f)
    e.target.value = ''
  }

  return (
    <div className="toolbar">
      {tools.map((t, i) => (
        <React.Fragment key={t.id}>
          {(i === 1 || i === 4) && <div className="tb-sep" />}
          <button
            className={`tool ${state.tool === t.id ? 'active' : ''}`}
            onClick={() => onTool(t)}
            title={t.label}
          >
            {t.glyph ? <span style={{ fontSize: 16, fontWeight: 800, lineHeight: '20px' }}>{t.glyph}</span> : t.icon}
            {t.label}
          </button>
        </React.Fragment>
      ))}

      <div className="tb-right">
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: ACT.UNDO })}>{I.undo}</button>
        <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={() => dispatch({ type: ACT.REDO })}>{I.redo}</button>
      </div>

      <input ref={imgInput} type="file" accept="image/*" className="hidden-input" onChange={onImgFile} />
    </div>
  )
}
