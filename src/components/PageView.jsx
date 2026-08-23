import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BASE_SCALE, famCss, uid, slackOf, topForBaseline } from '../utils/misc'
import { sampleTextColor, sampleBgColor } from '../lib/colors'

function useSyncText(ref, text, isActive) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement !== el && el.textContent !== text) {
      el.textContent = text
    }
  }, [text, isActive])
}

function LineBox({ ln, isActive, handlers }) {
  const ref = useRef(null)
  useSyncText(ref, ln.text, isActive)
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
    useSyncText(tRef, ob.text, isActive)
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

  if (ob.kind === 'line') {
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
          <line
            x1={ob.x - x0 + 3} y1={ob.y - y0 + 3}
            x2={ob.x1 - x0 + 3} y2={ob.y1 - y0 + 3}
            stroke={ob.stroke || '#2563eb'}
            strokeWidth={ob.strokeWidth || 2}
            strokeLinecap="round"
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

export default function PageView({ idx, pdfPage, zoom, pageState, tool, activeText, selection, pendingImage, dispatch, ACT, docRef }) {
  const holderRef = useRef(null)
  const overlayRef = useRef(null)
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [band, setBand] = useState(null)
  const bandRef = useRef(null)
  const pendingPointRef = useRef(null)
  const pendingCaretRef = useRef(null)

  const dims = docRef.pageDims?.[idx] || { w: 595 * BASE_SCALE, h: 842 * BASE_SCALE }
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
    const vp = pdfPage.getViewport({ scale: BASE_SCALE })
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

  const toBase = (clientX, clientY) => {
    const r = overlayRef.current.getBoundingClientRect()
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom }
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
    if (ob.kind === 'line') {
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
      let t = e.currentTarget.innerText
      if (t.endsWith('\n')) t = t.slice(0, -1)
      dispatch({ type: ACT.TEXT_PATCH, page: idx, kind, id: activeText.id, patch: { text: t } })
    }
  })

  const lineInputHandlers = makeInputHandlers('line')
  const objInputHandlers = makeInputHandlers('obj')

  /* ---------- keyboard: move, join and split across text blocks ---------- */

  const lineIndexOf = id => liveLines.findIndex(l => l.id === id)

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
    dispatch({ type: ACT.TEXT_MERGE, page: idx, dstId: prev.id, srcId: ln.id, text: prev.text + glue + ln.text })
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
    dispatch({ type: ACT.TEXT_MERGE, page: idx, dstId: ln.id, srcId: next.id, text: merged })
    // The box keeps focus, so React will not re-sync its text for us.
    el.textContent = merged
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

    if (tool === 'whiteout' || tool === 'rect' || tool === 'ellipse' || tool === 'line') {
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
        if (tool === 'whiteout') {
          if (bw > 4 && bh > 4) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: 'whiteout', x: bx, y: by, w: bw, h: bh } })
          else dispatch({ type: ACT.UNDO_REVERT })
        } else if (tool === 'line') {
          if (Math.hypot(bw, bh) > 8) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: 'line', x: cur.x0, y: cur.y0, x1: cur.x1, y1: cur.y1, stroke: '#e11d48', strokeWidth: 2 } })
          else dispatch({ type: ACT.UNDO_REVERT })
        } else {
          if (bw > 4 && bh > 4) dispatch({ type: ACT.OBJ_ADD, page: idx, obj: { id, kind: tool, x: bx, y: by, w: bw, h: bh, stroke: '#2563eb', fill: 'none', strokeWidth: 2 } })
          else dispatch({ type: ACT.UNDO_REVERT })
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
      className={`page-holder ${visible ? '' : 'placeholder'}`}
      style={{ width: W * zoom, height: H * zoom }}
      data-page={idx}
    >
      {!visible ? (
        <span>Page {idx + 1}</span>
      ) : (
        <div className="page" style={{ width: W, height: H, zoom }}>
          <canvas ref={canvasRef} className="pgcanvas" />
          <div ref={overlayRef} className={`overlay tool-${tool}`} onPointerDown={onOverlayDown}>
            {deadLines.map(ln => (
              <div
                key={ln.id}
                className="pline-patch"
                style={{ left: ln.rect.x, top: ln.rect.y, width: ln.rect.w, height: ln.rect.h, background: ln.bg || '#fff' }}
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
