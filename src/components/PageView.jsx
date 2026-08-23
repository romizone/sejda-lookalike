import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BASE_SCALE, famCss, uid, slackOf, topForBaseline } from '../utils/misc'
import { sampleTextColor, sampleBgColor } from '../lib/colors'
import { domToRuns, runsToHtml, runsText, isPlain } from '../lib/runs'

// While the box has focus the browser owns its DOM - rewriting it there would
// throw the caret away - so state is only pushed back into a box that is idle.
function useSyncText(ref, item, isActive) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    if (item.runs && item.runs.length) {
      const html = runsToHtml(item.runs)
      if (el.innerHTML !== html) el.innerHTML = html
    } else if (el.textContent !== item.text) {
      el.textContent = item.text
    }
  }, [item.text, item.runs, isActive])
}

function readBack(el) {
  let runs = domToRuns(el)
  // Browsers park a trailing <br> in an editable box; it is not part of the text.
  const last = runs[runs.length - 1]
  if (last && last.t.endsWith('\n')) {
    const t = last.t.slice(0, -1)
    if (t) runs[runs.length - 1] = { ...last, t }
    else runs = runs.slice(0, -1)
  }
  return { text: runsText(runs), runs: isPlain(runs) ? undefined : runs }
}

function LineBox({ ln, isActive, handlers }) {
  const ref = useRef(null)
  useSyncText(ref, ln, isActive)
  const fs = ln.fontSize
  const lh = ln.lineHeight || fs * 1.2
  const st = {
    left: ln.x,
    top: topForBaseline(ln.baselineY, fs, lh, ln.family),
    width: ln.wrapW || ln.w + slackOf(ln.w),
    minHeight: Math.max(ln.rectH, fs * 1.2),
    fontSize: fs,
    lineHeight: lh + 'px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
    fontFamily: famCss(ln.family)
  }
  if (ln.bold) st.fontWeight = 700
  if (ln.italic) st.fontStyle = 'italic'
  if (ln.underline) st.textDecoration = 'underline'
  if (isActive || ln.dirty) {
    st.color = ln.color || '#111111'
    st.background = ln.bg || '#fff'
  }
  return (
    <div
      ref={ref}
      className={`pline ${isActive ? 'active' : ''} ${ln.dirty ? 'dirty' : ''}`}
      style={st}
      data-id={ln.id}
      contentEditable={isActive}
      suppressContentEditableWarning
      onPointerDown={e => handlers.lineDown(e, ln)}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      onInput={handlers.onInput}
      onKeyDown={e => handlers.onKeyDown(e, ln, 'line')}
      onPaste={handlers.onPaste}
    />
  )
}

function ObjBox({ ob, isSel, isActive, idx, handlers }) {
  const base = {
    left: ob.x,
    top: ob.y,
    width: ob.w,
    height: ob.h
  }

  if (ob.kind === 'text') {
    const tRef = useRef(null)
    useSyncText(tRef, ob, isActive)
    const fs = ob.fontSize
    const lh = ob.lineHeight || fs * 1.2
    const st = {
      left: ob.x,
      top: topForBaseline(ob.baselineY ?? ob.y + fs * 0.8, fs, lh, ob.family),
      width: ob.w || 260,
      minWidth: 6,
      minHeight: fs * 1.2,
      fontSize: fs,
      lineHeight: lh + 'px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      fontFamily: famCss(ob.family),
      color: ob.color || '#111111'
    }
    if (ob.bold) st.fontWeight = 700
    if (ob.italic) st.fontStyle = 'italic'
    if (ob.underline) st.textDecoration = 'underline'
    return (
      <div
        ref={tRef}
        className={`pobj textobj ${isSel ? 'selected' : ''} ${isActive ? 'active' : ''}`}
        style={st}
        data-id={ob.id}
        contentEditable={isActive}
        suppressContentEditableWarning
        onPointerDown={e => handlers.textObjDown(e, ob)}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        onInput={handlers.onInputObj}
        onKeyDown={e => handlers.onKeyDown(e, ob, 'obj')}
        onPaste={handlers.onPaste}
      />
    )
  }

  if (ob.kind === 'whiteout') {
    return (
      <div
        className={`pobj whiteout ${isSel ? 'selected' : ''}`}
        style={base}
        data-id={ob.id}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        {isSel && <span className="handle" onPointerDown={e => handlers.resizeDown(e, ob)} />}
      </div>
    )
  }

  if (ob.kind === 'image') {
    return (
      <div
        className={`pobj image ${isSel ? 'selected' : ''}`}
        style={{ ...base, cursor: 'move' }}
        data-id={ob.id}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        <img src={ob.src} alt="" draggable={false} />
        {isSel && <span className="handle" onPointerDown={e => handlers.resizeDown(e, ob)} />}
      </div>
    )
  }

  if (ob.kind === 'mark') {
    const st = { ...base, pointerEvents: 'auto' }
    if (ob.variant === 'highlight') {
      st.background = ob.color || '#ffe14d'
      st.opacity = 0.42
      st.mixBlendMode = 'multiply'
    }
    return (
      <div
        className={`pobj mark mark-${ob.variant} ${isSel ? 'selected' : ''}`}
        style={st}
        data-id={ob.id}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        {ob.variant !== 'highlight' && (
          <span
            className="mark-bar"
            style={{
              background: ob.color || (ob.variant === 'strike' ? '#e11d48' : '#2563eb'),
              top: ob.variant === 'strike' ? '52%' : undefined,
              bottom: ob.variant === 'underline' ? 1 : undefined,
              height: Math.max(1.5, ob.h * 0.09)
            }}
          />
        )}
      </div>
    )
  }

  if (ob.kind === 'link') {
    return (
      <div
        className={`pobj linkbox ${isSel ? 'selected' : ''} ${ob.url ? '' : 'empty'}`}
        style={base}
        data-id={ob.id}
        title={ob.url || 'No URL yet'}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        {isSel && <span className="handle" onPointerDown={e => handlers.resizeDown(e, ob)} />}
      </div>
    )
  }

  if (ob.kind === 'field') {
    return (
      <div
        className={`pobj fieldbox ${isSel ? 'selected' : ''}`}
        style={base}
        data-id={ob.id}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        <span className="field-tag">{ob.fieldType}</span>
        <span className="field-name">{ob.name}</span>
        {isSel && <span className="handle" onPointerDown={e => handlers.resizeDown(e, ob)} />}
      </div>
    )
  }

  if (ob.kind === 'line' || ob.kind === 'arrow') {

    const x0 = Math.min(ob.x, ob.x1), y0 = Math.min(ob.y, ob.y1)
    const w = Math.abs(ob.x1 - ob.x) || 1, h = Math.abs(ob.y1 - ob.y) || 1
    return (
      <div
        className={`pobj shape ${isSel ? 'selected' : ''}`}
        style={{ left: x0, top: y0, width: w + 6, height: h + 6 }}
        data-id={ob.id}
        onPointerDown={e => handlers.objDown(e, ob)}
      >
        <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
          {ob.kind === 'arrow' && (
            <defs>
              <marker id={`ah-${ob.id}`} markerWidth="6" markerHeight="6" refX="4.6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill={ob.stroke || '#e11d48'} />
              </marker>
            </defs>
          )}
          <line
            x1={ob.x - x0 + 3} y1={ob.y - y0 + 3}
            x2={ob.x1 - x0 + 3} y2={ob.y1 - y0 + 3}
            stroke={ob.stroke || '#2563eb'}
            strokeWidth={ob.strokeWidth || 2}
            strokeLinecap="round"
            markerEnd={ob.kind === 'arrow' ? `url(#ah-${ob.id})` : undefined}
          />
        </svg>
      </div>
    )
  }

  const shapeStyle = {
    ...base,
    border: `${ob.strokeWidth || 2}px solid ${ob.stroke || '#2563eb'}`,
    background: ob.fill && ob.fill !== 'none' ? ob.fill : 'transparent',
    cursor: 'move'
  }
  if (ob.kind === 'ellipse') shapeStyle.borderRadius = '50%'
  return (
    <div
      className={`pobj shape ${isSel ? 'selected' : ''}`}
      style={shapeStyle}
      data-id={ob.id}
      onPointerDown={e => handlers.objDown(e, ob)}
    >
      {isSel && <span className="handle" onPointerDown={e => handlers.resizeDown(e, ob)} />}
    </div>
  )
}

const MARK_TOOLS = { highlight: 'highlight', strike: 'strike', underline: 'underline' }
const MARK_COLORS = { highlight: '#ffe14d', strike: '#e11d48', underline: '#2563eb' }
const FIELD_TOOLS = {
  'field-text': 'text',
  'field-multiline': 'multiline',
  'field-check': 'check',
  'field-radio': 'radio',
  'field-dropdown': 'dropdown'
}
const BAND_TOOLS = new Set([
  'whiteout', 'rect', 'ellipse', 'line', 'arrow',
  'highlight', 'strike', 'underline', 'link',
  ...Object.keys(FIELD_TOOLS)
])

/* ---------- form widgets that already exist in the PDF ---------- */

function Widget({ wd, value, onChange }) {
  const box = { left: wd.x, top: wd.y, width: wd.w, height: wd.h }
  const fs = Math.max(9, Math.min(wd.h * 0.62, 22))

  if (wd.type === 'check' || wd.type === 'radio') {
    const on = wd.type === 'radio' ? value === wd.exportValue : !!value
    return (
      <div className={`pwidget check ${wd.readOnly ? 'ro' : ''}`} style={box}>
        <input
          type={wd.type === 'radio' ? 'radio' : 'checkbox'}
          name={wd.name}
          checked={on}
          disabled={wd.readOnly}
          onChange={e => onChange(wd.type === 'radio' ? wd.exportValue : e.target.checked)}
        />
      </div>
    )
  }

  if (wd.type === 'dropdown') {
    return (
      <select
        className={`pwidget input ${wd.readOnly ? 'ro' : ''}`}
        style={{ ...box, fontSize: fs }}
        value={value ?? ''}
        disabled={wd.readOnly}
        onChange={e => onChange(e.target.value)}
      >
        <option value="" />
        {(wd.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  const Tag = wd.multiline ? 'textarea' : 'input'
  return (
    <Tag
      className={`pwidget input ${wd.readOnly ? 'ro' : ''}`}
      style={{ ...box, fontSize: fs }}
      value={value ?? ''}
      readOnly={wd.readOnly}
      onChange={e => onChange(e.target.value)}
    />
  )
}

/* ---------- caret helpers ---------- */

function caretInfo(el) {
  const s = window.getSelection()
  if (!s || !s.rangeCount) return null
  const r = s.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  const post = document.createRange()
  post.selectNodeContents(el)
  post.setStart(r.endContainer, r.endOffset)
  let rect = r.getClientRects()[0] || r.getBoundingClientRect()
  if (!rect || (!rect.height && !rect.top)) rect = el.getBoundingClientRect()
  return {
    collapsed: s.isCollapsed,
    before: pre.toString().length,
    after: post.toString().replace(/\n$/, '').length,
    rect
  }
}

function setCaretAt(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = null
  let local = 0
  let acc = 0
  let n
  while ((n = walker.nextNode())) {
    const len = n.nodeValue.length
    if (acc + len >= offset) { node = n; local = offset - acc; break }
    acc += len
  }
  const r = document.createRange()
  if (node) r.setStart(node, local)
  else { r.selectNodeContents(el); r.collapse(false) }
  r.collapse(true)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
}

function caretFromPoint(el, pt) {
  let range = null
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(pt.x, pt.y)
  else if (document.caretPositionFromPoint) {
    const cp = document.caretPositionFromPoint(pt.x, pt.y)
    if (cp) { range = document.createRange(); range.setStart(cp.offsetNode, cp.offset) }
  }
  if (range && el.contains(range.startContainer)) {
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(range)
    return true
  }
  return false
}

export default function PageView({ idx, src, pos, rotate = 0, pdfPage, zoom, pageState, tool, activeText, selection, pendingImage, formValues, dispatch, ACT, docRef }) {
  const holderRef = useRef(null)
  const overlayRef = useRef(null)
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [band, setBand] = useState(null)
  const bandRef = useRef(null)
  const pendingPointRef = useRef(null)
  const pendingCaretRef = useRef(null)

  const dims = docRef.pageDims?.[src] || { w: 595 * BASE_SCALE, h: 842 * BASE_SCALE }
  const W = dims.w
  const H = dims.h

  const liveLines = (pageState?.lines || []).filter(l => !l.deleted)
  const deadLines = (pageState?.lines || []).filter(l => l.deleted)

  useEffect(() => {
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !pdfPage) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    docRef.dpr = dpr
    const vp = pdfPage.getViewport({ scale: BASE_SCALE, rotation: 0 })
    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    docRef.canvases[idx] = canvas
    const ctx = canvas.getContext('2d')
    const task = pdfPage.render({
      canvasContext: ctx,
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    })
    task.promise.catch(err => {
      if (!cancelled && err?.name !== 'RenderingCancelledException') console.warn('render', err)
    })
    return () => { cancelled = true; try { task.cancel() } catch {} }
  }, [visible, pdfPage])

  // A rotated page keeps its unrotated coordinate system; pointer positions are
  // spun back around the overlay's centre before being used.
  const toBase = (clientX, clientY) => {
    const r = overlayRef.current.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const rad = (-rotate * Math.PI) / 180
    const dx = clientX - cx
    const dy = clientY - cy
    const ux = dx * Math.cos(rad) - dy * Math.sin(rad)
    const uy = dx * Math.sin(rad) + dy * Math.cos(rad)
    return { x: ux / zoom + W / 2, y: uy / zoom + H / 2 }
  }

  // A highlight should follow the rendered rows of text, not the rectangle the
  // pointer swept, so each row the band touches contributes its own bar.
  const marksOverText = (band, tool) => {
    const out = []
    const ov = overlayRef.current
    if (!ov) return out
    const variant = MARK_TOOLS[tool]
    for (const ln of liveLines) {
      const el = ov.querySelector(`[data-id="${ln.id}"]`)
      if (!el) continue
      const range = document.createRange()
      range.selectNodeContents(el)
      for (const cr of Array.from(range.getClientRects())) {
        const p1 = toBase(cr.left, cr.top)
        const p2 = toBase(cr.right, cr.bottom)
        const top = Math.min(p1.y, p2.y)
        const bottom = Math.max(p1.y, p2.y)
        const left = Math.min(p1.x, p2.x)
        const right = Math.max(p1.x, p2.x)
        const rowH = bottom - top
        const x = Math.max(left, band.x)
        const x2 = Math.min(right, band.x + band.w)
        const overlapY = Math.min(bottom, band.y + band.h) - Math.max(top, band.y)
        if (x2 - x > 2 && rowH > 2 && overlapY > rowH * 0.35) {
          out.push({ id: uid(), kind: 'mark', variant, x, y: top, w: x2 - x, h: rowH, color: MARK_COLORS[variant] })
        }
      }
    }
    return out
  }

  const push = () => dispatch({ type: ACT.PUSH })

  const dragRef = useRef(null)

  useEffect(() => {
    if (!activeText || activeText.page !== idx) return
    const el = overlayRef.current?.querySelector(`[data-id="${activeText.id}"]`)
    if (el) {
      if (document.activeElement !== el) el.focus()
      const pc = pendingCaretRef.current
      if (pc && pc.id === activeText.id) {
        pendingCaretRef.current = null
        setCaretAt(el, pc.offset)
      } else {
        const pp = pendingPointRef.current
        if (pp) {
          pendingPointRef.current = null
          caretFromPoint(el, pp)
        }
      }
    }
    if (activeText.kind === 'line') {
      const ln = pageState?.lines.find(l => l.id === activeText.id)
      if (ln && (!ln.color || !ln.bg)) {
        const patch = {}
        if (!ln.color) patch.color = sampleTextColor(docRef.canvases[idx], ln.rect, docRef.dpr || 1)
        if (!ln.bg) patch.bg = sampleBgColor(docRef.canvases[idx], ln.rect, docRef.dpr || 1)
        if (patch.color || patch.bg) dispatch({ type: ACT.TEXT_META, page: idx, kind: 'line', id: ln.id, patch })
      }
    }
  }, [activeText, idx])

  const bindWindow = startState => {
    dragRef.current = startState
    const mv = e => {
      const d = dragRef.current
      if (!d) return
      const p = toBase(e.clientX, e.clientY)
      if (d.mode === 'move') {
        dispatch({ type: ACT.OBJ_PATCH, page: idx, id: d.obj.id, patch: { x: Math.round(d.ox + (p.x - d.x0)), y: Math.round(d.oy + (p.y - d.y0)) } })
      } else if (d.mode === 'moveLine') {
        dispatch({
          type: ACT.OBJ_PATCH, page: idx, id: d.obj.id,
          patch: { x: d.ox + (p.x - d.x0), y: d.oy + (p.y - d.y0), x1: d.ox1 + (p.x - d.x0), y1: d.oy1 + (p.y - d.y0) }
        })
      } else if (d.mode === 'resize') {
        dispatch({
          type: ACT.OBJ_PATCH, page: idx, id: d.obj.id,
          patch: { w: Math.max(8, d.ow + (p.x - d.x0)), h: Math.max(8, d.oh + (p.y - d.y0)) }
        })
      }
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }

  const objDown = (e, ob) => {
    if (e.button !== 0) return
    e.stopPropagation()
    dispatch({ type: ACT.SELECT, sel: { kind: 'obj', page: idx, id: ob.id } })
    push()
    const p = toBase(e.clientX, e.clientY)
    if (ob.kind === 'line' || ob.kind === 'arrow') {
      bindWindow({ mode: 'moveLine', obj: ob, x0: p.x, y0: p.y, ox: ob.x, oy: ob.y, ox1: ob.x1, oy1: ob.y1 })
    } else {
      bindWindow({ mode: 'move', obj: ob, x0: p.x, y0: p.y, ox: ob.x, oy: ob.y })
    }
  }

  const resizeDown = (e, ob) => {
    if (e.button !== 0) return
    e.stopPropagation()
    push()
    const p = toBase(e.clientX, e.clientY)
    bindWindow({ mode: 'resize', obj: ob, x0: p.x, y0: p.y, ow: ob.w, oh: ob.h })
  }

  const textObjDown = (e, ob) => {
    if (e.button !== 0) return
    e.stopPropagation()
    pendingPointRef.current = { x: e.clientX, y: e.clientY }
    dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'obj', page: idx, id: ob.id } })
  }

  const lineDown = (e, ln) => {
    if (e.button !== 0) return
    if (activeText && activeText.kind === 'line' && activeText.id === ln.id) return
    e.stopPropagation()
    pendingPointRef.current = { x: e.clientX, y: e.clientY }
    dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'line', page: idx, id: ln.id } })
  }

  const onFocus = () => push()

  const onBlur = () => {
    if (activeText && activeText.page === idx) dispatch({ type: ACT.TEXT_DEACTIVATE })
  }

  const makeInputHandlers = kind => ({
    onInput: e => {
      if (!activeText || activeText.kind !== kind) return
      dispatch({ type: ACT.TEXT_PATCH, page: idx, kind, id: activeText.id, patch: readBack(e.currentTarget) })
    }
  })

  const lineInputHandlers = makeInputHandlers('line')
  const objInputHandlers = makeInputHandlers('obj')

  /* ---------- keyboard: move, join and split across text blocks ---------- */

  const lineIndexOf = id => liveLines.findIndex(l => l.id === id)

  const joinRuns = (a, glue, b) => {
    if (!a.runs?.length && !b.runs?.length) return undefined
    const left = a.runs?.length ? a.runs : [{ t: a.text }]
    const right = b.runs?.length ? b.runs : [{ t: b.text }]
    return [...left, ...(glue ? [{ t: glue }] : []), ...right].filter(r => r.t)
  }

  const moveCaretToSibling = (dir, ln, ci) => {
    const i = lineIndexOf(ln.id)
    if (i < 0) return false
    const target = liveLines[i + dir]
    if (!target) return false
    const tEl = overlayRef.current?.querySelector(`[data-id="${target.id}"]`)
    if (!tEl) return false
    const tr = tEl.getBoundingClientRect()
    const lh = Math.min(ci.rect.height || 14, tr.height)
    const y = dir > 0 ? tr.top + lh / 2 : tr.bottom - lh / 2
    pendingPointRef.current = { x: ci.rect.left, y }
    pendingCaretRef.current = null
    dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'line', page: idx, id: target.id } })
    return true
  }

  // A merged-away line is unmounted, so nothing would hide the pixels it left
  // on the rendered page; remember its background before it goes.
  const ensureBg = ln => {
    if (ln.bg) return
    const bg = sampleBgColor(docRef.canvases[idx], ln.rect, docRef.dpr || 1)
    if (bg) dispatch({ type: ACT.TEXT_META, page: idx, kind: 'line', id: ln.id, patch: { bg } })
  }

  const joinWithPrev = ln => {
    const i = lineIndexOf(ln.id)
    if (i <= 0) return false
    const prev = liveLines[i - 1]
    const glue = prev.text && ln.text && !/\s$/.test(prev.text) && !/^\s/.test(ln.text) ? ' ' : ''
    push()
    ensureBg(ln)
    pendingCaretRef.current = { id: prev.id, offset: prev.text.length + glue.length }
    dispatch({ type: ACT.TEXT_MERGE, page: idx, dstId: prev.id, srcId: ln.id, text: prev.text + glue + ln.text, runs: joinRuns(prev, glue, ln) })
    return true
  }

  const joinWithNext = (el, ln) => {
    const i = lineIndexOf(ln.id)
    if (i < 0 || i >= liveLines.length - 1) return false
    const next = liveLines[i + 1]
    const glue = ln.text && next.text && !/\s$/.test(ln.text) && !/^\s/.test(next.text) ? ' ' : ''
    const merged = ln.text + glue + next.text
    const caret = ln.text.length
    push()
    ensureBg(next)
    const runs = joinRuns(ln, glue, next)
    dispatch({ type: ACT.TEXT_MERGE, page: idx, dstId: ln.id, srcId: next.id, text: merged, runs })
    // The box keeps focus, so React will not re-sync its content for us.
    if (runs) el.innerHTML = runsToHtml(runs)
    else el.textContent = merged
    setCaretAt(el, caret)
    return true
  }

  const onKeyDown = (e, item, kind) => {
    const el = e.currentTarget
    if (e.key === 'Enter') {
      e.preventDefault()
      document.execCommand('insertLineBreak')
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (kind !== 'line') return

    const ci = caretInfo(el)
    if (!ci) return

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const box = el.getBoundingClientRect()
      const lh = ci.rect.height || 14
      const atFirst = ci.rect.top - box.top < lh * 0.6
      const atLast = box.bottom - ci.rect.bottom < lh * 0.6
      if (e.key === 'ArrowUp' && atFirst && moveCaretToSibling(-1, item, ci)) e.preventDefault()
      else if (e.key === 'ArrowDown' && atLast && moveCaretToSibling(1, item, ci)) e.preventDefault()
      return
    }
    if (e.key === 'ArrowLeft' && ci.collapsed && ci.before === 0) {
      const i = lineIndexOf(item.id)
      const prev = liveLines[i - 1]
      if (prev) {
        e.preventDefault()
        pendingCaretRef.current = { id: prev.id, offset: prev.text.length }
        dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'line', page: idx, id: prev.id } })
      }
      return
    }
    if (e.key === 'ArrowRight' && ci.collapsed && ci.after === 0) {
      const i = lineIndexOf(item.id)
      const next = liveLines[i + 1]
      if (next) {
        e.preventDefault()
        pendingCaretRef.current = { id: next.id, offset: 0 }
        dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'line', page: idx, id: next.id } })
      }
      return
    }
    if (e.key === 'Backspace' && ci.collapsed && ci.before === 0) {
      if (joinWithPrev(item)) e.preventDefault()
      return
    }
    if (e.key === 'Delete' && ci.collapsed && ci.after === 0) {
      if (joinWithNext(el, item)) e.preventDefault()
    }
  }

  const onPaste = e => {
    e.preventDefault()
    const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r\n/g, '\n')
    document.execCommand('insertText', false, t)
  }

  const handlers = {
    lineDown, objDown, resizeDown, textObjDown, onFocus, onBlur,
    onInput: lineInputHandlers.onInput,
    onInputObj: objInputHandlers.onInput,
    onKeyDown, onPaste
  }

  const onOverlayDown = e => {
    if (e.button !== 0) return
    if (e.target !== overlayRef.current) return
    const p = toBase(e.clientX, e.clientY)

    if (pendingImage) {
      push()
      const maxW = W * 0.45
      const sc = Math.min(1, maxW / pendingImage.nw)
      const id = uid()
      dispatch({
        type: ACT.OBJ_ADD, page: idx,
        obj: { id, kind: 'image', x: p.x, y: p.y, w: Math.round(pendingImage.nw * sc), h: Math.round(pendingImage.nh * sc), src: pendingImage.src }
      })
      dispatch({ type: ACT.PENDING_IMG, img: null })
      dispatch({ type: ACT.SELECT, sel: { kind: 'obj', page: idx, id } })
      return
    }

    if (tool === 'text') {
      push()
      const fs = 16
      const id = uid()
      dispatch({
        type: ACT.OBJ_ADD, page: idx,
        obj: { id, kind: 'text', x: p.x, baselineY: p.y + fs * 0.8, fontSize: fs, lineHeight: Math.round(fs * 1.25), w: 260, family: 'sans-serif', bold: false, italic: false, underline: false, color: '#111111', text: '', dirty: true }
      })
      dispatch({ type: ACT.SET_TOOL, tool: 'select' })
      pendingPointRef.current = null
      dispatch({ type: ACT.TEXT_ACTIVATE, target: { kind: 'obj', page: idx, id } })
      return
    }

    if (BAND_TOOLS.has(tool)) {
      push()
      bandRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      setBand(bandRef.current)
      const mv = ev => {
        const q = toBase(ev.clientX, ev.clientY)
        bandRef.current = { ...bandRef.current, x1: q.x, y1: q.y }
        setBand(bandRef.current)
      }
      const up = () => {
        window.removeEventListener('pointermove', mv)
        window.removeEventListener('pointerup', up)
        const cur = bandRef.current
        bandRef.current = null
        setBand(null)
        if (!cur) return
        const bx = Math.min(cur.x0, cur.x1), by = Math.min(cur.y0, cur.y1)
        const bw = Math.abs(cur.x1 - cur.x0), bh = Math.abs(cur.y1 - cur.y0)
        const id = uid()
        const tiny = () => dispatch({ type: ACT.UNDO_REVERT })

        if (tool === 'whiteout') {
          if (bw > 4 && bh > 4) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: 'whiteout', x: bx, y: by, w: bw, h: bh } })
          else tiny()
        } else if (tool === 'line' || tool === 'arrow') {
          if (Math.hypot(bw, bh) > 8) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: tool, x: cur.x0, y: cur.y0, x1: cur.x1, y1: cur.y1, stroke: '#e11d48', strokeWidth: 2 } })
          else tiny()
        } else if (MARK_TOOLS[tool]) {
          const made = marksOverText({ x: bx, y: by, w: bw, h: bh }, tool)
          if (made.length) {
            made.forEach(m => dispatch({ type: ACT.OBJ_ADD, page: idx, obj: m }))
            dispatch({ type: ACT.SET_TOOL, tool: 'select' })
          } else tiny()
        } else if (tool === 'link') {
          if (bw > 6 && bh > 6) {
            dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: 'link', x: bx, y: by, w: bw, h: bh, url: '' } })
            dispatch({ type: ACT.SET_TOOL, tool: 'select' })
            dispatch({ type: ACT.SELECT, sel: { kind: 'obj', page: idx, id } })
          } else tiny()
        } else if (FIELD_TOOLS[tool]) {
          const fieldType = FIELD_TOOLS[tool]
          const box = fieldType === 'check' || fieldType === 'radio'
            ? { x: bx, y: by, w: Math.max(bw, 24), h: Math.max(bh, 24) }
            : { x: bx, y: by, w: Math.max(bw, 60), h: Math.max(bh, fieldType === 'multiline' ? 60 : 30) }
          if (bw > 4 && bh > 4) {
            dispatch({
              type: ACT.OBJ_ADD,
              page: idx,
              obj: {
                id, kind: 'field', fieldType,
                name: `${fieldType}_${id}`,
                ...box,
                value: '',
                options: fieldType === 'dropdown' || fieldType === 'radio' ? ['Option 1', 'Option 2'] : undefined
              }
            })
            dispatch({ type: ACT.SET_TOOL, tool: 'select' })
            dispatch({ type: ACT.SELECT, sel: { kind: 'obj', page: idx, id } })
          } else tiny()
        } else {
          if (bw > 4 && bh > 4) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: tool, x: bx, y: by, w: bw, h: bh, stroke: '#2563eb', fill: 'none', strokeWidth: 2 } })
          else tiny()
        }
      }
      window.addEventListener('pointermove', mv)
      window.addEventListener('pointerup', up)
      return
    }

    dispatch({ type: ACT.TEXT_DEACTIVATE })
    dispatch({ type: ACT.SELECT, sel: null })
  }

  const bandStyle = band ? {
    left: Math.min(band.x0, band.x1),
    top: Math.min(band.y0, band.y1),
    width: Math.abs(band.x1 - band.x0),
    height: Math.abs(band.y1 - band.y0)
  } : null

  return (
    <div
      ref={holderRef}
      className={`page-holder ${visible ? '' : 'placeholder'} ${rotate ? 'rotated' : ''}`}
      style={{
        width: (rotate % 180 ? H : W) * zoom,
        height: (rotate % 180 ? W : H) * zoom
      }}
      data-page={pos}
    >
      {!visible ? (
        <span>Page {pos + 1}</span>
      ) : (
        <div
          className="page"
          style={{
            width: W,
            height: H,
            zoom,
            transform: rotate ? `translate(-50%, -50%) rotate(${rotate}deg)` : undefined
          }}
        >
          <canvas ref={canvasRef} className="pgcanvas" />
          <div ref={overlayRef} className={`overlay tool-${tool}`} onPointerDown={onOverlayDown}>
            {deadLines.map(ln => (
              <div
                key={ln.id}
                className="pline-patch"
                style={{ left: ln.rect.x, top: ln.rect.y, width: ln.rect.w, height: ln.rect.h, background: ln.bg || '#fff' }}
              />
            ))}
            {(docRef.widgets?.[src] || []).map(wd => (
              <Widget
                key={wd.id}
                wd={wd}
                value={formValues?.[wd.key]}
                onChange={v => dispatch({ type: ACT.FORM_SET, key: wd.key, value: v })}
              />
            ))}
            {liveLines.map(ln => (
              <LineBox key={ln.id} ln={ln} isActive={!!(activeText && activeText.kind === 'line' && activeText.id === ln.id)} handlers={handlers} />
            ))}
            {(pageState?.objects || []).map(ob => (
              <ObjBox key={ob.id} ob={ob} idx={idx} isSel={!!(selection && selection.page === idx && selection.id === ob.id)} isActive={!!(activeText && activeText.kind === 'obj' && activeText.id === ob.id)} handlers={handlers} />
            ))}
            {band && bandStyle && <div className="band" style={bandStyle} />}
          </div>
        </div>
      )}
    </div>
  )
}
