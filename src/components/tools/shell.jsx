import React, { useCallback, useEffect, useRef, useState } from 'react'
import pdfjs from '../../lib/pdfjs'

export const download = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const baseOf = n => (n || 'document').replace(/\.[a-z0-9]+$/i, '')

export const prettySize = n => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function ToolShell({ tool, onBack, children }) {
  return (
    <div className="tool-screen">
      <div className="tool-head">
        <button className="tool-back" onClick={onBack}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
          All tools
        </button>
        <div className="tool-id">
          <span className="tool-ic" style={{ background: tool.tint, color: tool.ink }}>{tool.icon}</span>
          <div>
            <h2>{tool.name}</h2>
            <p>{tool.blurb}</p>
          </div>
        </div>
      </div>
      <div className="tool-body">{children}</div>
    </div>
  )
}

export function DropArea({ accept = 'application/pdf,.pdf', multiple = false, label, hint, onFiles }) {
  const ref = useRef(null)
  const [over, setOver] = useState(false)

  const take = list => {
    const files = Array.from(list || [])
    if (files.length) onFiles(multiple ? files : [files[0]])
  }

  return (
    <div
      className={`tool-drop ${over ? 'over' : ''}`}
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
    >
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <div className="dz-title">{label}</div>
      <div className="dz-sub">{hint}</div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden-input"
        onChange={e => { take(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

// Loads a PDF for preview and keeps the original bytes for the operation.
export function usePdf() {
  const [state, setState] = useState({ name: '', bytes: null, doc: null, count: 0, error: null, busy: false })

  const open = useCallback(async file => {
    setState(s => ({ ...s, busy: true, error: null }))
    try {
      const bytes = await file.arrayBuffer()
      const clone = new Uint8Array(bytes.byteLength)
      clone.set(new Uint8Array(bytes))
      const doc = await pdfjs.getDocument({ data: clone }).promise
      setState({ name: file.name, bytes, doc, count: doc.numPages, size: file.size, error: null, busy: false })
    } catch (err) {
      setState(s => ({ ...s, busy: false, error: `Could not open this PDF. ${err?.message || ''}` }))
    }
  }, [])

  const clear = useCallback(() => setState({ name: '', bytes: null, doc: null, count: 0, error: null, busy: false }), [])

  return [state, open, clear, setState]
}

export function PageThumb({ doc, index, width = 132, rotate = 0 }) {
  const ref = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!doc) return
    doc.getPage(index + 1).then(page => {
      const c = ref.current
      if (!c || cancelled) return
      const v1 = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: width / v1.width })
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
        .then(() => { if (!cancelled) setReady(true) })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [doc, index, width])

  return (
    <canvas
      ref={ref}
      className="tool-thumb-canvas"
      style={{ width, opacity: ready ? 1 : 0, transform: rotate ? `rotate(${rotate}deg)` : undefined }}
    />
  )
}

export function PageGrid({ doc, count, selected, onToggle, onSelectAll, hint }) {
  const all = selected.size === count
  return (
    <>
      <div className="tool-bar">
        <span>{selected.size} of {count} selected</span>
        <button className="btn btn-white sm" onClick={() => onSelectAll(!all)}>
          {all ? 'Clear selection' : 'Select all'}
        </button>
        {hint && <em className="tool-hint">{hint}</em>}
      </div>
      <div className="tool-grid">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            className={`tool-page ${selected.has(i) ? 'on' : ''}`}
            onClick={() => onToggle(i)}
          >
            <PageThumb doc={doc} index={i} />
            <span className="tool-page-num">{i + 1}</span>
            <span className="tool-check">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

export function Result({ text, onReset }) {
  return (
    <div className="tool-done">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>
      <span>{text}</span>
      <button className="btn btn-white sm" onClick={onReset}>Start another</button>
    </div>
  )
}
