import React, { useEffect, useState } from 'react'
import { organisePages } from '../../lib/pdfops'
import { DropArea, PageBoard, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function OrganiseTool({ tool, mode = 'organise', onBack }) {
  const [pdf, open, clear] = usePdf()
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf.doc) return
    setEntries(Array.from({ length: pdf.count }, (_, i) => ({ key: `p${i}`, src: i, rotate: 0 })))
  }, [pdf.doc, pdf.count])

  const reset = () => { clear(); setEntries([]); setDone(null); setError(null) }

  const spinAll = deg =>
    setEntries(list => list.map(e => ({ ...e, rotate: ((((e.rotate || 0) + deg) % 360) + 360) % 360 })))

  const touched =
    entries.length !== pdf.count ||
    entries.some((e, i) => e.src !== i || e.rotate)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await organisePages(pdf.bytes, entries)
      const name = `${baseOf(pdf.name)}-${mode === 'rotate' ? 'rotated' : 'organised'}.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${entries.length} page${entries.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <>
          <div className="tool-bar">
            <span>{entries.length} page{entries.length === 1 ? '' : 's'}</span>
            <button className="btn btn-white sm" onClick={() => spinAll(-90)}>Rotate all left</button>
            <button className="btn btn-white sm" onClick={() => spinAll(90)}>Rotate all right</button>
            <em className="tool-hint">
              {mode === 'rotate' ? 'Spin a page with the buttons under it' : 'Drag a page to move it, or use the buttons under it'}
            </em>
          </div>

          <PageBoard
            doc={pdf.doc}
            entries={entries}
            onChange={setEntries}
            allowReorder={mode !== 'rotate'}
            allowRemove={mode !== 'rotate'}
          />

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !touched} onClick={run}>
              {busy ? 'Working…' : 'Save PDF'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
