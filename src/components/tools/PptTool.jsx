import React, { useState } from 'react'
import { pagesToImages } from '../../lib/pdfraster'
import { buildPptx } from '../../lib/pptx'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function PptTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [dpi, setDpi] = useState(150)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPct(0) }

  const run = async () => {
    setBusy(true); setError(null); setPct(0)
    try {
      const base = baseOf(pdf.name)
      const slides = await pagesToImages(pdf.bytes, { format: 'jpeg', dpi, quality: 0.88, baseName: base }, setPct)
      // Slide size follows the first page, so the deck keeps the document's shape.
      const first = await pdf.doc.getPage(1)
      const vp = first.getViewport({ scale: 1 })
      const blob = buildPptx(slides, { widthInches: vp.width / 72, heightInches: vp.height / 72 })
      const name = `${base}.pptx`
      download(blob, name)
      setDone(`${name} downloaded — ${slides.length} slide${slides.length === 1 ? '' : 's'}.`)
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
          <div className="tool-file">
            <PageThumb doc={pdf.doc} index={0} width={84} />
            <div>
              <strong>{pdf.name}</strong>
              <span>{pdf.count} page{pdf.count === 1 ? '' : 's'}</span>
            </div>
          </div>

          <div className="ocr-row">
            <span className="ocr-label">Quality</span>
            <div className="ocr-choices">
              {[[110, 'Draft'], [150, 'Good'], [220, 'Sharp'], [300, 'Print']].map(([v, l]) => (
                <button key={v} className={`ocr-choice ${dpi === v ? 'on' : ''}`} onClick={() => setDpi(v)}>{l} — {v} dpi</button>
              ))}
            </div>
          </div>

          <p className="tool-note">
            One slide per page, each showing the page exactly as it looks, and the slide takes the
            document's own shape. It is a deck you can present and annotate over — not a rebuild of
            every box and bullet as an editable shape.
          </p>

          {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Building…' : 'Convert to PowerPoint'}</button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
