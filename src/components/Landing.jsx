import React, { useRef, useState } from 'react'

export default function Landing({ onFile, onSample, error }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

  const pick = e => {
    const f = e.target.files?.[0] || e.dataTransfer?.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div className="landing">
      <div className="brand">
        <div className="brand-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fff" />
            <path d="M14 3l4 4h-4z" fill="#c9e8ce" />
            <path d="M8.6 15.2l5-5 1.7 1.7-5 5-2 .3z" fill="#3fa54a" />
          </svg>
        </div>
        <div className="brand-name">Edit<span>PDF</span></div>
      </div>

      <h1>Edit PDF files for free</h1>
      <p className="sub">
        Click any paragraph to retype it in place and watch it re-flow. Format a single
        word, fill forms, sign, highlight, add links, images and shapes, reorder or rotate
        pages, and recognise text on scans. Everything is processed locally in your
        browser; your file never leaves your device.
      </p>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e) }}
      >
        <div className="dz-icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </div>
        <div className="dz-title">Drop your PDF here</div>
        <div className="dz-sub">or click to browse your computer</div>
        <button className="btn btn-primary" onClick={e => { e.stopPropagation(); inputRef.current?.click() }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Choose PDF file
        </button>
        <div className="or">— or —</div>
        <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); onSample() }}>
          Try a sample document
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="privacy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        100% private — files are processed in your browser and never uploaded
      </div>

      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden-input" onChange={pick} />
    </div>
  )
}
