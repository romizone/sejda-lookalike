import React, { useState } from 'react'
import { compressPdf } from '../../lib/pdfops'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, prettySize, usePdf } from './shell'

const LEVELS = {
  light: { label: 'Light', blurb: 'Barely visible change', quality: 0.82, maxSide: 2400 },
  balanced: { label: 'Balanced', blurb: 'Good for sharing and email', quality: 0.62, maxSide: 1800 },
  strong: { label: 'Strong', blurb: 'Smallest file, softer pictures', quality: 0.42, maxSide: 1300 }
}

export default function CompressTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [level, setLevel] = useState('balanced')
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPct(0) }

  const run = async () => {
    setBusy(true)
    setError(null)
    setPct(0)
    try {
      const { quality, maxSide } = LEVELS[level]
      const { blob, images } = await compressPdf(pdf.bytes, { quality, maxSide }, p => setPct(p))
      const before = pdf.size ?? pdf.bytes.byteLength
      const saved = before - blob.size
      const name = `${baseOf(pdf.name)}-compressed.pdf`
      download(blob, name)
      setDone(
        saved > 0
          ? `${name} downloaded — ${prettySize(before)} became ${prettySize(blob.size)}, ${Math.round((saved / before) * 100)}% smaller.`
          : `${name} downloaded — this file was already about as small as it gets${images ? '' : ' (it holds no JPEG pictures to re-encode)'}.`
      )
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
              <span>{pdf.count} page{pdf.count === 1 ? '' : 's'} · {prettySize(pdf.size ?? pdf.bytes.byteLength)}</span>
            </div>
          </div>

          <div className="tool-options">
            {Object.entries(LEVELS).map(([id, l]) => (
              <label key={id} className={`tool-option ${level === id ? 'on' : ''}`}>
                <input type="radio" checked={level === id} onChange={() => setLevel(id)} />
                <div>
                  <strong>{l.label}</strong>
                  <span>{l.blurb}</span>
                </div>
              </label>
            ))}
          </div>

          <p className="tool-note">
            Photographs inside the file are re-encoded and the document structure is packed more
            tightly. Text and vector drawings are left exactly as they are, so a PDF made only of
            text has little to give up.
          </p>

          {busy && (
            <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          )}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Compressing…' : 'Compress PDF'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
