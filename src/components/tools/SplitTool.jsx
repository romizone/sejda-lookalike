import React, { useState } from 'react'
import { splitPdf, zipFiles } from '../../lib/pdfops'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function SplitTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [mode, setMode] = useState('every')
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setSpec('') }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const base = baseOf(pdf.name)
      const files = await splitPdf(pdf.bytes, { mode, spec, baseName: base })
      if (files.length === 1) {
        download(new Blob([files[0].data], { type: 'application/pdf' }), files[0].name)
        setDone(`${files[0].name} downloaded.`)
      } else {
        download(zipFiles(files), `${base}-split.zip`)
        setDone(`${base}-split.zip downloaded — ${files.length} documents inside.`)
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

          <div className="tool-options">
            <label className={`tool-option ${mode === 'every' ? 'on' : ''}`}>
              <input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} />
              <div>
                <strong>Every page separately</strong>
                <span>{pdf.count} document{pdf.count === 1 ? '' : 's'}, one per page, delivered as a zip</span>
              </div>
            </label>

            <label className={`tool-option ${mode === 'ranges' ? 'on' : ''}`}>
              <input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} />
              <div>
                <strong>By page ranges</strong>
                <span>One document per range</span>
                <input
                  className="tool-input"
                  placeholder="e.g. 1-3, 4, 7-"
                  value={spec}
                  onFocus={() => setMode('ranges')}
                  onChange={e => setSpec(e.target.value)}
                />
              </div>
            </label>
          </div>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || (mode === 'ranges' && !spec.trim())} onClick={run}>
              {busy ? 'Splitting…' : 'Split PDF'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
