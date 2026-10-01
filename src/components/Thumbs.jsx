import React, { useEffect, useRef, useState } from 'react'

const W = 118

const Ic = {
  rotate: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
}

function Thumb({ entry, pos, docRef, current, onGoTo, onRotate, onDelete, drag }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const queueRef = useRef(Promise.resolve())
  const [visible, setVisible] = useState(false)
  const [drawn, setDrawn] = useState(null)
  const rot = ((entry.rotate || 0) % 360 + 360) % 360
  const swap = rot % 180 !== 0

  // Pages are handed over one at a time while the document loads, so the
  // lookup is repeated on every render. Workspace passes a `revision` that
  // changes as they arrive, and that is what brings this component back here.
  const page = entry.src == null ? null : docRef.pagesMap?.[entry.src] || null
  const done = !!page && drawn === page

  // The canvas stays display:none until it has been painted, and an element
  // without a box never intersects anything - so it is the wrapper, which
  // always has one, that is watched. The panel is the root so that the margin
  // reaches thumbnails just outside it rather than being clipped by it.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { root: el.closest('.thumbs'), rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // pdf.js refuses a second render() on a canvas that is still being drawn to,
  // so paints for this canvas are queued: one that is superseded is cancelled,
  // and the next waits for it to let go before it starts.
  useEffect(() => {
    const c = canvasRef.current
    if (!visible || !page || done || !c) return
    let cancelled = false
    let task = null
    const paint = () => {
      if (cancelled) return
      const v1 = page.getViewport({ scale: 1, rotation: 0 })
      const vp = page.getViewport({ scale: W / v1.width, rotation: 0 })
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      task = page.render({ canvasContext: c.getContext('2d'), viewport: vp })
      return task.promise.then(() => {
        task = null
        if (!cancelled) setDrawn(page)
      })
    }
    queueRef.current = queueRef.current.then(paint).catch(err => {
      if (!cancelled && err?.name !== 'RenderingCancelledException') console.warn('thumbnail', err)
    })
    return () => {
      cancelled = true
      try { task?.cancel() } catch {}
    }
  }, [visible, page, done])

  const h = done && canvasRef.current
    ? Math.round((canvasRef.current.height / canvasRef.current.width) * W)
    : 152

  return (
    <div
      ref={wrapRef}
      className={`thumb-wrap ${drag.overPos === pos ? 'drop' : ''}`}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; drag.start(pos) }}
      onDragOver={e => { e.preventDefault(); drag.over(pos) }}
      onDragEnd={drag.end}
      onDrop={e => { e.preventDefault(); drag.drop(pos) }}
    >
      <div
        className={`thumb ${current ? 'current' : ''}`}
        onClick={() => onGoTo(pos)}
        style={{ width: swap ? h : W, height: swap ? W : h }}
      >
        <div className="thumb-inner" style={{ width: W, height: h, transform: rot ? `translate(-50%, -50%) rotate(${rot}deg)` : 'translate(-50%, -50%)' }}>
          {entry.src == null ? (
            <div className="thumb-blank" style={{ width: W, height: h }} />
          ) : (
            <>
              <canvas ref={canvasRef} style={{ display: done ? 'block' : 'none', width: W }} />
              {!done && <div className="thumb-pending" style={{ width: W, height: h }}>{pos + 1}</div>}
            </>
          )}
        </div>

        <div className="thumb-tools">
          <button title="Rotate right" onClick={e => { e.stopPropagation(); onRotate(pos, 90) }}>{Ic.rotate}</button>
          <button title="Delete page" onClick={e => { e.stopPropagation(); onDelete(pos) }}>{Ic.trash}</button>
        </div>
      </div>
      <div className="thumb-num">{pos + 1}</div>
    </div>
  )
}

export default function Thumbs({ open, order, current, docRef, onGoTo, onRotate, onDelete, onReorder, revision }) {
  const [from, setFrom] = useState(null)
  const [overPos, setOverPos] = useState(null)
  if (!open) return null

  const drag = {
    overPos,
    start: p => setFrom(p),
    over: p => setOverPos(p),
    end: () => { setFrom(null); setOverPos(null) },
    drop: p => {
      if (from != null && from !== p) onReorder(from, p)
      setFrom(null)
      setOverPos(null)
    }
  }

  return (
    <div className="thumbs">
      {order.map((entry, i) => (
        <Thumb
          key={entry.key}
          entry={entry}
          pos={i}
          docRef={docRef}
          current={current === i}
          onGoTo={onGoTo}
          onRotate={onRotate}
          onDelete={onDelete}
          onReorder={onReorder}
          revision={revision}
          drag={drag}
        />
      ))}
    </div>
  )
}
