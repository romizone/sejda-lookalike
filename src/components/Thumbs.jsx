import React, { useEffect, useRef, useState } from 'react'

function Thumb({ idx, docRef, current, onGoTo, revision }) {
  const canvasRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [done, setDone] = useState(false)

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
    if (!visible || done) return
    const page = docRef.pagesMap?.[idx]
    const c = canvasRef.current
    if (!page || !c) return
    let cancelled = false
    const v1 = page.getViewport({ scale: 1 })
    const scale = 118 / v1.width
    const vp = page.getViewport({ scale })
    c.width = Math.floor(vp.width)
    c.height = Math.floor(vp.height)
    page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      .then(() => { if (!cancelled) setDone(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [visible, done, idx, revision])

  return (
    <div className="thumb-wrap">
      <div className={`thumb ${current ? 'current' : ''}`} onClick={() => onGoTo(idx)} style={{ width: 118 }}>
        <canvas ref={canvasRef} style={{ display: done ? 'block' : 'none', width: 118 }} />
        {!done && (
          <div style={{ width: 118, height: 152, background: '#565a5e', lineHeight: '152px', textAlign: 'center', color: '#9aa0a5', fontSize: 12 }}>
            {idx + 1}
          </div>
        )}
      </div>
      <div className="thumb-num">{idx + 1}</div>
    </div>
  )
}

export default function Thumbs({ open, count, current, docRef, onGoTo, revision }) {
  if (!open) return null
  return (
    <div className="thumbs">
      {Array.from({ length: count }, (_, i) => (
        <Thumb key={i} idx={i} docRef={docRef} current={current === i} onGoTo={onGoTo} revision={revision} />
      ))}
    </div>
  )
}
