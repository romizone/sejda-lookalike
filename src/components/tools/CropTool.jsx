import React, { useEffect, useRef, useState } from 'react'
import { PAGE_SIZES, cropPdf } from '../../lib/pdfops'
import { DropArea, Result, ToolShell, baseOf, download, usePdf } from './shell'

const FULL = { left: 0, top: 0, right: 0, bottom: 0 }
const PREVIEW_W = 420

const SIZE_LABELS = [
  ['keep', 'Keep as is'],
  ['a4', 'A4'],
  ['letter', 'Letter'],
  ['legal', 'Legal'],
  ['a3', 'A3'],
  ['a5', 'A5']
]

export default function CropTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [box, setBox] = useState(FULL)
  const [size, setSize] = useState('keep')
  const [pageNo, setPageNo] = useState(0)
  const [scope, setScope] = useState('all')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: PREVIEW_W, h: PREVIEW_W * 1.414 })

  useEffect(() => {
    if (!pdf.doc) return
    let cancelled = false
    pdf.doc.getPage(pageNo + 1).then(page => {
      const c = canvasRef.current
      if (!c || cancelled) return
      const v1 = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: PREVIEW_W / v1.width })
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      setDims({ w: c.width, h: c.height })
      return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pdf.doc, pageNo])

  const reset = () => { clear(); setBox(FULL); setDone(null); setError(null); setPageNo(0); setSize('keep') }

  // Drag anywhere on the page to sweep out what should be kept.
  const startDrag = e => {
    const r = wrapRef.current.getBoundingClientRect()
    const p0 = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    const move = ev => {
      const p1 = { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height }
      const clamp = v => Math.max(0, Math.min(1, v))
      const left = clamp(Math.min(p0.x, p1.x))
      const right = 1 - clamp(Math.max(p0.x, p1.x))
      const top = clamp(Math.min(p0.y, p1.y))
      const bottom = 1 - clamp(Math.max(p0.y, p1.y))
      if (1 - left - right > 0.04 && 1 - top - bottom > 0.04) setBox({ left, top, right, bottom })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const trimmed = box.left || box.top || box.right || box.bottom
      const blob = await cropPdf(pdf.bytes, {
        box: trimmed ? box : null,
        size,
        pages: scope === 'all' ? null : [pageNo]
      })
      const name = `${baseOf(pdf.name)}-cropped.pdf`
      download(blob, name)
      setDone(`${name} downloaded.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  const pct = v => `${(v * 100).toFixed(1)}%`
  const nothingToDo = !box.left && !box.top && !box.right && !box.bottom && size === 'keep'

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <div className="crop-layout">
          <div>
            <div className="crop-stage" ref={wrapRef} onPointerDown={startDrag} style={{ width: dims.w, height: dims.h }}>
              <canvas ref={canvasRef} className="crop-canvas" />
              <div className="crop-shade" style={{ top: 0, left: 0, right: 0, height: pct(box.top) }} />
              <div className="crop-shade" style={{ bottom: 0, left: 0, right: 0, height: pct(box.bottom) }} />
              <div className="crop-shade" style={{ top: pct(box.top), bottom: pct(box.bottom), left: 0, width: pct(box.left) }} />
              <div className="crop-shade" style={{ top: pct(box.top), bottom: pct(box.bottom), right: 0, width: pct(box.right) }} />
              <div
                className="crop-frame"
                style={{ top: pct(box.top), bottom: pct(box.bottom), left: pct(box.left), right: pct(box.right) }}
              />
            </div>
            {pdf.count > 1 && (
              <div className="crop-pager">
                <button className="btn btn-white sm" disabled={pageNo === 0} onClick={() => setPageNo(p => p - 1)}>Previous</button>
                <span>Page {pageNo + 1} of {pdf.count}</span>
                <button className="btn btn-white sm" disabled={pageNo >= pdf.count - 1} onClick={() => setPageNo(p => p + 1)}>Next</button>
              </div>
            )}
          </div>

          <div className="crop-side">
            <p className="tool-note">Drag across the page to sweep out the part you want to keep. Everything outside the frame is trimmed away.</p>

            <label className="tool-field">
              <span>Apply to</span>
              <select className="tool-select" value={scope} onChange={e => setScope(e.target.value)}>
                <option value="all">All {pdf.count} pages</option>
                <option value="page">This page only</option>
              </select>
            </label>

            <label className="tool-field">
              <span>Page size</span>
              <select className="tool-select" value={size} onChange={e => setSize(e.target.value)}>
                {SIZE_LABELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>

            {size !== 'keep' && (
              <p className="tool-fine">The page becomes {PAGE_SIZES[size][0].toFixed(0)} × {PAGE_SIZES[size][1].toFixed(0)} pt and its contents are scaled to fit.</p>
            )}

            <div className="crop-margins">
              {['top', 'right', 'bottom', 'left'].map(side => (
                <div key={side}>
                  <span>{side}</span>
                  <strong>{(box[side] * 100).toFixed(1)}%</strong>
                </div>
              ))}
            </div>

            <button className="btn btn-white sm" onClick={() => setBox(FULL)}>Reset frame</button>

            <div className="tool-actions">
              <button className="btn btn-white" onClick={reset}>Choose another file</button>
              <button className="btn btn-primary" disabled={busy || nothingToDo} onClick={run}>
                {busy ? 'Working…' : 'Crop PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
