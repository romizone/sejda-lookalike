import React, { useRef } from 'react'
import { ACT } from '../store'
import Menu from './Menu'

const I = {
  cursor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 3l14 8-6.5 1.5L9 19z" /></svg>,
  whiteout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m7 17 10-10" /></svg>,
  image: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 18 5-5 3 3 3.5-3.5L20 16" /></svg>,
  shapes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="8" width="11" height="11" rx="1.5" /><circle cx="16" cy="8" r="5" /></svg>,
  link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" /></svg>,
  forms: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="6" width="18" height="5" rx="1.5" /><rect x="3" y="14" width="11" height="5" rx="1.5" /></svg>,
  sign: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18c3.5 0 4-11 7-11s2 8 4.5 8S18 9 21 9" /><path d="M4 21h16" /></svg>,
  annotate: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 15 9-9 5 5-9 9H4z" /><path d="M3 21h18" /></svg>,
  find: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>,
  undo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>,
  redo: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
}

const ANNOTATE = ['highlight', 'strike', 'underline']
const SHAPES = ['rect', 'ellipse', 'line', 'arrow']
const FIELDS = ['field-text', 'field-multiline', 'field-check', 'field-radio', 'field-dropdown']

export default function Toolbar({ state, dispatch }) {
  const imgInput = useRef(null)
  const set = tool => dispatch({ type: ACT.SET_TOOL, tool })

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

  const plain = (id, label, icon, glyph) => (
    <button
      className={`tool ${state.tool === id ? 'active' : ''}`}
      onClick={() => set(id)}
      title={label}
      key={id}
    >
      {glyph ? <span style={{ fontSize: 16, fontWeight: 800, lineHeight: '20px' }}>{glyph}</span> : icon}
      {label}
    </button>
  )

  return (
    <div className="toolbar">
      {plain('select', 'Select', I.cursor)}
      <div className="tb-sep" />
      {plain('text', 'Text', null, 'Aa')}
      {plain('link', 'Links', I.link)}

      <Menu
        label="Forms"
        icon={I.forms}
        active={FIELDS.includes(state.tool)}
        items={[
          { key: 'ft', label: 'Text field', on: state.tool === 'field-text', run: () => set('field-text') },
          { key: 'fm', label: 'Multiline text', on: state.tool === 'field-multiline', run: () => set('field-multiline') },
          { key: 'fc', label: 'Checkbox', on: state.tool === 'field-check', run: () => set('field-check') },
          { key: 'fr', label: 'Radio choices', on: state.tool === 'field-radio', run: () => set('field-radio') },
          { key: 'fd', label: 'Dropdown', on: state.tool === 'field-dropdown', run: () => set('field-dropdown') }
        ]}
      />

      <button className="tool" onClick={() => imgInput.current?.click()} title="Images">
        {I.image}Images
      </button>

      <button
        className={`tool ${state.panel === 'sign' ? 'active' : ''}`}
        onClick={() => dispatch({ type: ACT.PANEL, panel: 'sign' })}
        title="Sign"
      >
        {I.sign}Sign
      </button>

      <div className="tb-sep" />
      {plain('whiteout', 'Whiteout', I.whiteout)}

      <Menu
        label="Annotate"
        icon={I.annotate}
        active={ANNOTATE.includes(state.tool)}
        items={[
          { key: 'hl', label: 'Highlight', swatch: '#ffe14d', on: state.tool === 'highlight', run: () => set('highlight') },
          { key: 'st', label: 'Strikethrough', swatch: '#e11d48', on: state.tool === 'strike', run: () => set('strike') },
          { key: 'ul', label: 'Underline', swatch: '#2563eb', on: state.tool === 'underline', run: () => set('underline') }
        ]}
      />

      <Menu
        label="Shapes"
        icon={I.shapes}
        active={SHAPES.includes(state.tool)}
        items={[
          { key: 'r', label: 'Rectangle', on: state.tool === 'rect', run: () => set('rect') },
          { key: 'e', label: 'Ellipse', on: state.tool === 'ellipse', run: () => set('ellipse') },
          { key: 'l', label: 'Line', on: state.tool === 'line', run: () => set('line') },
          { key: 'a', label: 'Arrow', on: state.tool === 'arrow', run: () => set('arrow') }
        ]}
      />

      <div className="tb-sep" />
      <button
        className={`tool ${state.panel === 'find' ? 'active' : ''}`}
        onClick={() => dispatch({ type: ACT.PANEL, panel: state.panel === 'find' ? null : 'find' })}
        title="Find and replace"
      >
        {I.find}Find
      </button>

      <div className="tb-right">
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: ACT.UNDO })}>{I.undo}</button>
        <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={() => dispatch({ type: ACT.REDO })}>{I.redo}</button>
      </div>

      <input ref={imgInput} type="file" accept="image/*" className="hidden-input" onChange={onImgFile} />
    </div>
  )
}
