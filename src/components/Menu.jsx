import React, { useEffect, useRef, useState } from 'react'

export default function Menu({ label, glyph, icon, active, items }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(null)
  const ref = useRef(null)
  const btnRef = useRef(null)

  // The toolbar scrolls horizontally, which clips anything absolutely
  // positioned inside it, so the popover is anchored in viewport space.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setAt({ left: Math.min(r.left, window.innerWidth - 190), top: r.bottom + 4 })
    }
    place()
    const away = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('pointerdown', away)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  return (
    <div className="tb-menu" ref={ref}>
      <button ref={btnRef} className={`tool ${active ? 'active' : ''}`} onClick={() => setOpen(o => !o)} title={label}>
        {glyph ? <span style={{ fontSize: 16, fontWeight: 800, lineHeight: '20px' }}>{glyph}</span> : icon}
        {label}
        <svg className="caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 9 7 7 7-7" /></svg>
      </button>
      {open && at && (
        <div className="tb-pop" style={{ left: at.left, top: at.top }}>
          {items.map(it => (
            it.sep
              ? <div className="pop-sep" key={it.key} />
              : (
                <button
                  key={it.key}
                  className={`pop-item ${it.on ? 'on' : ''}`}
                  onClick={() => { setOpen(false); it.run() }}
                >
                  {it.swatch && <span className="pop-swatch" style={{ background: it.swatch }} />}
                  <span>{it.label}</span>
                  {it.hint && <em>{it.hint}</em>}
                </button>
              )
          ))}
        </div>
      )}
    </div>
  )
}
