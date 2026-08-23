import React, { useEffect, useRef, useState } from 'react'

const STYLES = [
  { id: 'dancing', label: 'Dancing Script', css: "'Dancing Script', cursive" },
  { id: 'greatvibes', label: 'Great Vibes', css: "'Great Vibes', cursive" },
  { id: 'caveat', label: 'Caveat', css: "'Caveat', cursive" },
  { id: 'sacramento', label: 'Sacramento', css: "'Sacramento', cursive" }
]

function trimCanvas(src) {
  const ctx = src.getContext('2d')
  const { width: w, height: h } = src
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export default function SignModal({ onClose, onPlace }) {
  const [tab, setTab] = useState('draw')
  const [typed, setTyped] = useState('')
  const [style, setStyle] = useState(STYLES[0].id)
  const [color, setColor] = useState('#12203a')
  const [drawn, setDrawn] = useState(false)
  const cvRef = useRef(null)
  const drawing = useRef(false)

  useEffect(() => {
    if (tab !== 'draw') return
    const c = cvRef.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [tab])

  const pos = e => {
    const r = cvRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = e => {
    e.preventDefault()
    const ctx = cvRef.current.getContext('2d')
    ctx.strokeStyle = color
    ctx.lineWidth = 2.6
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    drawing.current = true
    cvRef.current.setPointerCapture(e.pointerId)
  }
  const move = e => {
    if (!drawing.current) return
    const ctx = cvRef.current.getContext('2d')
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    setDrawn(true)
  }
  const up = () => { drawing.current = false }

  const clear = () => {
    const c = cvRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setDrawn(false)
  }

  const fromUpload = e => {
    const f = e.target.files?.[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      const im = new Image()
      im.onload = () => onPlace({ src: rd.result, nw: im.naturalWidth || 300, nh: im.naturalHeight || 120 })
      im.src = rd.result
    }
    rd.readAsDataURL(f)
    e.target.value = ''
  }

  const useDrawn = () => {
    const t = trimCanvas(cvRef.current)
    if (!t) return
    onPlace({ src: t.toDataURL('image/png'), nw: t.width, nh: t.height })
  }

  const useTyped = () => {
    const text = typed.trim()
    if (!text) return
    const css = STYLES.find(s => s.id === style)?.css || 'cursive'
    const size = 96
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    ctx.font = `${size}px ${css}`
    const w = Math.ceil(ctx.measureText(text).width) + 40
    c.width = w
    c.height = Math.round(size * 1.9)
    const g = c.getContext('2d')
    g.font = `${size}px ${css}`
    g.fillStyle = color
    g.textBaseline = 'alphabetic'
    g.fillText(text, 20, Math.round(size * 1.25))
    const t = trimCanvas(c)
    if (!t) return
    onPlace({ src: t.toDataURL('image/png'), nw: t.width, nh: t.height })
  }

  return (
    <div className="modal-wrap" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal sign-modal">
        <div className="sign-head">
          <strong>Add your signature</strong>
          <button className="icon-btn" onClick={onClose} title="Close">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="sign-tabs">
          {[['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']].map(([id, lbl]) => (
            <button key={id} className={`sign-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
          ))}
          <div style={{ flex: 1 }} />
          <label className="sign-color">
            Ink
            <input type="color" value={color} onChange={e => setColor(e.target.value)} />
          </label>
        </div>

        {tab === 'draw' && (
          <>
            <canvas
              ref={cvRef}
              className="sign-pad"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
            <div className="sign-actions">
              <button className="btn btn-white" onClick={clear}>Clear</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={!drawn} onClick={useDrawn}>Use signature</button>
            </div>
          </>
        )}

        {tab === 'type' && (
          <>
            <input
              className="sign-input"
              placeholder="Type your name"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoFocus
            />
            <div className="sign-styles">
              {STYLES.map(s => (
                <button
                  key={s.id}
                  className={`sign-style ${style === s.id ? 'on' : ''}`}
                  style={{ fontFamily: s.css, color }}
                  onClick={() => setStyle(s.id)}
                >
                  {typed.trim() || 'Your name'}
                </button>
              ))}
            </div>
            <div className="sign-actions">
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={!typed.trim()} onClick={useTyped}>Use signature</button>
            </div>
          </>
        )}

        {tab === 'upload' && (
          <div className="sign-upload">
            <p>Pick a photo or scan of your signature. A PNG with a transparent background works best.</p>
            <input type="file" accept="image/*" onChange={fromUpload} />
          </div>
        )}
      </div>
    </div>
  )
}
