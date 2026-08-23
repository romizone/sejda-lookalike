import React, { useState } from 'react'
import { zipFiles } from '../../lib/pdfops'
import { extractImages, pagesToImages, pdfToText } from '../../lib/pdfraster'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

const DPI = [
  [96, 'Screen — 96 dpi'],
  [150, 'Good — 150 dpi'],
  [200, 'Sharp — 200 dpi'],
  [300, 'Print — 300 dpi']
]

export default function ExportTool({ tool, kind, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [format, setFormat] = useState('jpeg')
  const [dpi, setDpi] = useState(150)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPct(0) }

  const run = async () => {
    setBusy(true)
    setError(null)
    setPct(0)
    const base = baseOf(pdf.name)
    try {
      if (kind === 'text') {
        const text = await pdfToText(pdf.bytes, setPct)
        download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`)
        setDone(`${base}.txt downloaded — ${text.split(/\s+/).filter(Boolean).length} words.`)
      } else {
        const files = kind === 'images'
          ? await extractImages(pdf.bytes, { baseName: base }, setPct)
          : await pagesToImages(pdf.bytes, { format, dpi, baseName: base }, setPct)

        if (files.length === 1) {
          download(new Blob([files[0].data], { type: files[0].mime }), files[0].name)
          setDone(`${files[0].name} downloaded.`)
        } else {
          download(zipFiles(files), `${base}-${kind === 'images' ? 'images' : format}.zip`)
          setDone(`${base}-${kind === 'images' ? 'images' : format}.zip downloaded — ${files.length} files inside.`)
        }
      }
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

          {kind === 'pages' && (
            <div className="field-row">
              <label className="tool-field">
                <span>Format</span>
                <select className="tool-select" value={format} onChange={e => setFormat(e.target.value)}>
                  <option value="jpeg">JPG — smaller files</option>
                  <option value="png">PNG — sharp edges, larger files</option>
                </select>
              </label>
              <label className="tool-field">
                <span>Resolution</span>
                <select className="tool-select" value={dpi} onChange={e => setDpi(Number(e.target.value))}>
                  {DPI.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </label>
            </div>
          )}

          <p className="tool-note">
            {kind === 'pages' && 'Each page is rendered as a picture. More than one page arrives as a zip.'}
            {kind === 'images' && 'Pulls out the pictures placed inside the document, at the size they are stored, rather than a snapshot of the page.'}
            {kind === 'text' && 'Reads the text layer back as plain text, one page after another. A scanned document has no text layer — run OCR on it in the PDF Editor first.'}
          </p>

          {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Working…' : kind === 'text' ? 'Convert to text' : kind === 'images' ? 'Extract images' : 'Convert pages'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
