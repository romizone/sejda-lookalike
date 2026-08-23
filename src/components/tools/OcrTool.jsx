import React, { useState } from 'react'
import { ocrToSearchablePdf } from '../../lib/ocrpdf'
import { pdfToText } from '../../lib/pdfraster'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

const LANGS = [
  ['eng', 'English'], ['ind', 'Indonesian'], ['msa', 'Malay'],
  ['deu', 'German'], ['fra', 'French'], ['spa', 'Spanish'],
  ['nld', 'Dutch'], ['por', 'Portuguese'], ['ita', 'Italian'],
  ['ara', 'Arabic'], ['chi_sim', 'Chinese'], ['jpn', 'Japanese']
]

export default function OcrTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [langs, setLangs] = useState(['eng', 'ind'])
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const [output, setOutput] = useState('pdf')
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setBusy(null) }

  const toggle = id => setLangs(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))

  const run = async () => {
    setError(null)
    setBusy({ label: 'Loading the recognition model…', pct: 0 })
    try {
      const base = baseOf(pdf.name)
      const { blob, pages, words } = await ocrToSearchablePdf(
        pdf.bytes,
        { langs: langs.join('+'), onlyEmpty },
        p => setBusy(p)
      )

      if (output === 'text') {
        const text = await pdfToText(await blob.arrayBuffer())
        download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`)
        setDone(`${base}.txt downloaded — ${words} words read from ${pages} page${pages === 1 ? '' : 's'}.`)
      } else {
        const name = `${base}-searchable.pdf`
        download(blob, name)
        setDone(`${name} downloaded — ${words} words laid over ${pages} page${pages === 1 ? '' : 's'}. It looks the same and can now be searched.`)
      }
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(null)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea label="Drop your scanned PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
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
            <label className={`tool-option ${output === 'pdf' ? 'on' : ''}`}>
              <input type="radio" checked={output === 'pdf'} onChange={() => setOutput('pdf')} />
              <div>
                <strong>A searchable PDF</strong>
                <span>The page keeps its look; the words are laid over it invisibly so they can be selected, searched and copied</span>
              </div>
            </label>
            <label className={`tool-option ${output === 'text' ? 'on' : ''}`}>
              <input type="radio" checked={output === 'text'} onChange={() => setOutput('text')} />
              <div>
                <strong>Just the text</strong>
                <span>A plain .txt file of everything that was read</span>
              </div>
            </label>
          </div>

          <label className={`perm block ${onlyEmpty ? 'on' : ''}`}>
            <input type="checkbox" checked={onlyEmpty} onChange={e => setOnlyEmpty(e.target.checked)} />
            Skip pages that already carry text — only the scanned ones are read
          </label>

          <div className="ocr-row">
            <span className="ocr-label">Languages</span>
            <div className="ocr-choices">
              {LANGS.map(([id, label]) => (
                <button key={id} className={`ocr-choice ${langs.includes(id) ? 'on' : ''}`} onClick={() => toggle(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="tool-fine">
            Recognition runs in your browser. The language model is downloaded once from the
            tesseract.js CDN — your document is not uploaded anywhere.
          </p>

          {busy && (
            <>
              <div className="ocr-bar"><span style={{ width: `${Math.round((busy.pct || 0) * 100)}%` }} /></div>
              <div className="ocr-status">{busy.label}</div>
            </>
          )}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={!!busy || !langs.length} onClick={run}>
              {busy ? 'Recognising…' : 'Run OCR'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
