import React, { useEffect, useRef, useState } from 'react'

const W = 118

const Ic = {
  rotate: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
}

function Thumb({ entry, pos, docRef, current, onGoTo, onRotate, onDelete, revision, drag }) {
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [done, setDone] = useState(false)
  const rot = ((entry.rotate || 0) % 360 + 360) % 360
  const swap = rot % 180 !== 0

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || done || entry.src == null) return
    const page = docRef.pagesMap?.[entry.src]
    const c = canvasRef.current
    if (!page || !c) return
    let cancelled = false
    const v1 = page.getViewport({ scale: 1, rotation: 0 })
    const vp = page.getViewport({ scale: W / v1.width, rotation: 0 })
    c.width = Math.floor(vp.width)
    c.height = Math.floor(vp.height)
    page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      .then(() => { if (!cancelled) setDone(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [visible, done, entry.src, revision])

  const h = done && canvasRef.current
    ? Math.round((canvasRef.current.height / canvasRef.current.width) * W)
    : 152

  return (
    <div
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
