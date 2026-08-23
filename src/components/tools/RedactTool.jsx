import React, { useEffect, useRef, useState } from 'react'
import { redactPdf } from '../../lib/pdfraster'
import { DropArea, Result, ToolShell, baseOf, download, usePdf } from './shell'

const PREVIEW_W = 460

export default function RedactTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [pageNo, setPageNo] = useState(0)
  const [marks, setMarks] = useState({})
  const [dpi, setDpi] = useState(150)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [band, setBand] = useState(null)
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
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

  const reset = () => { clear(); setMarks({}); setPageNo(0); setDone(null); setError(null) }

  const startDrag = e => {
    const r = stageRef.current.getBoundingClientRect()
    const p0 = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    const clamp = v => Math.max(0, Math.min(1, v))
    const draw = ev => {
      const p1 = { x: clamp((ev.clientX - r.left) / r.width), y: clamp((ev.clientY - r.top) / r.height) }
      setBand({
        x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y),
        w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y)
      })
    }
    const up = ev => {
      window.removeEventListener('pointermove', draw)
      window.removeEventListener('pointerup', up)
      const p1 = { x: clamp((ev.clientX - r.left) / r.width), y: clamp((ev.clientY - r.top) / r.height) }
      const box = {
        x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y),
        w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y)
      }
      setBand(null)
      if (box.w > 0.005 && box.h > 0.005) {
        setMarks(m => ({ ...m, [pageNo]: [...(m[pageNo] || []), box] }))
      }
    }
    window.addEventListener('pointermove', draw)
    window.addEventListener('pointerup', up)
  }

  const total = Object.values(marks).reduce((n, list) => n + list.length, 0)
  const pagesMarked = Object.values(marks).filter(l => l.length).length

  const run = async () => {
    setBusy(true)
    setError(null)
    setPct(0)
    try {
      const { blob, flattened } = await redactPdf(pdf.bytes, marks, { dpi }, setPct)
      const name = `${baseOf(pdf.name)}-redacted.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${total} area${total === 1 ? '' : 's'} blacked out on ${flattened} page${flattened === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  const pct100 = v => `${(v * 100).toFixed(2)}%`

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <div className="crop-layout">
          <div>
            <div className="crop-stage" ref={stageRef} onPointerDown={startDrag} style={{ width: dims.w, height: dims.h }}>
              <canvas ref={canvasRef} className="crop-canvas" />
              {(marks[pageNo] || []).map((m, i) => (
                <div
                  key={i}
                  className="redact-box"
                  style={{ left: pct100(m.x), top: pct100(m.y), width: pct100(m.w), height: pct100(m.h) }}
                  title="Click to remove"
                  onPointerDown={ev => {
                    ev.stopPropagation()
                    setMarks(s => ({ ...s, [pageNo]: s[pageNo].filter((_, j) => j !== i) }))
                  }}
                />
              ))}
              {band && (
                <div className="redact-box drawing" style={{ left: pct100(band.x), top: pct100(band.y), width: pct100(band.w), height: pct100(band.h) }} />
              )}
            </div>
            {pdf.count > 1 && (
              <div className="crop-pager">
                <button className="btn btn-white sm" disabled={pageNo === 0} onClick={() => setPageNo(p => p - 1)}>Previous</button>
                <span>Page {pageNo + 1} of {pdf.count}{(marks[pageNo] || []).length ? ` · ${marks[pageNo].length} marked` : ''}</span>
                <button className="btn btn-white sm" disabled={pageNo >= pdf.count - 1} onClick={() => setPageNo(p => p + 1)}>Next</button>
              </div>
            )}
          </div>

          <div className="crop-side">
            <p className="tool-note">
              Drag over anything that has to go. Click a black box to take it back.
            </p>

            <div className="redact-warning">
              <strong>A marked page is rebuilt as a picture.</strong>
              The words underneath are gone for good — not merely covered — so nothing can be
              selected, searched or copied back out. The price is that those pages stop being
              text. Pages you leave alone keep theirs.
            </div>

            <label className="tool-field">
              <span>Quality of the rebuilt pages</span>
              <select className="tool-select" value={dpi} onChange={e => setDpi(Number(e.target.value))}>
                <option value={110}>Draft — 110 dpi</option>
                <option value={150}>Good — 150 dpi</option>
                <option value={220}>Sharp — 220 dpi</option>
                <option value={300}>Print — 300 dpi</option>
              </select>
            </label>

            <p className="tool-fine">
              {total
                ? `${total} area${total === 1 ? '' : 's'} on ${pagesMarked} page${pagesMarked === 1 ? '' : 's'}.`
                : 'Nothing marked yet.'}
            </p>

            {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

            <div className="tool-actions">
              <button className="btn btn-white" onClick={reset}>Choose another file</button>
              <button className="btn btn-primary" disabled={busy || !total} onClick={run}>
                {busy ? 'Redacting…' : 'Redact PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
