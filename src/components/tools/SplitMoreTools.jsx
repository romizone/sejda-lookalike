import React, { useEffect, useState } from 'react'
import { splitAt, splitBySize, splitInHalf, zipFiles } from '../../lib/pdfops'
import { boundariesOf, pageKeys, readOutline } from '../../lib/outline'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, prettySize, usePdf } from './shell'

function FileCard({ pdf }) {
  return (
    <div className="tool-file">
      <PageThumb doc={pdf.doc} index={0} width={84} />
      <div>
        <strong>{pdf.name}</strong>
        <span>{pdf.count} page{pdf.count === 1 ? '' : 's'}{pdf.size ? ` · ${prettySize(pdf.size)}` : ''}</span>
      </div>
    </div>
  )
}

export function SplitHalfTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [direction, setDirection] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const blob = await splitInHalf(pdf.bytes, { direction })
      const name = `${baseOf(pdf.name)}-halves.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${pdf.count * 2} pages out of ${pdf.count}.`)
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
        : done ? <Result text={done} onReset={reset} />
          : (
            <>
              <FileCard pdf={pdf} />
              <div className="tool-options">
                {[['auto', 'Work it out', 'Landscape pages are cut down the middle, portrait ones across'],
                  ['vertical', 'Down the middle', 'Left half, then right half'],
                  ['horizontal', 'Across the middle', 'Top half, then bottom half']].map(([id, title, sub]) => (
                    <label key={id} className={`tool-option ${direction === id ? 'on' : ''}`}>
                      <input type="radio" checked={direction === id} onChange={() => setDirection(id)} />
                      <div><strong>{title}</strong><span>{sub}</span></div>
                    </label>
                  ))}
              </div>
              <p className="tool-note">For scans of an open book or a spread printed two pages to a sheet.</p>
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Split in half'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

export function SplitSizeTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [limit, setLimit] = useState(2)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPct(0) }

  const run = async () => {
    setBusy(true); setError(null); setPct(0)
    try {
      const base = baseOf(pdf.name)
      const files = await splitBySize(pdf.bytes, { limitBytes: limit * 1024 * 1024, baseName: base }, setPct)
      if (files.length === 1) {
        download(new Blob([files[0].data], { type: 'application/pdf' }), files[0].name)
        setDone(`${files[0].name} downloaded — it already fits under ${limit} MB.`)
      } else {
        download(zipFiles(files), `${base}-parts.zip`)
        setDone(`${base}-parts.zip downloaded — ${files.length} documents, each under ${limit} MB.`)
      }
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
        : done ? <Result text={done} onReset={reset} />
          : (
            <>
              <FileCard pdf={pdf} />
              <label className="tool-field">
                <span>Each part stays under</span>
                <div className="ocr-choices">
                  {[1, 2, 5, 10, 20].map(mb => (
                    <button key={mb} className={`ocr-choice ${limit === mb ? 'on' : ''}`} onClick={() => setLimit(mb)}>{mb} MB</button>
                  ))}
                </div>
              </label>
              <p className="tool-note">
                Pages are gathered until the next one would push the part over the limit, so a
                single page larger than the limit still comes out on its own.
              </p>
              {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Splitting…' : 'Split by size'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

export function SplitTextTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [pattern, setPattern] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPreview(null) }

  const look = async () => {
    setError(null)
    try {
      const keys = await pageKeys(pdf.doc, pattern.trim() || null)
      setPreview({ keys, cuts: boundariesOf(keys) })
    } catch (e) { setError(e?.message || String(e)) }
  }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const keys = await pageKeys(pdf.doc, pattern.trim() || null)
      const cuts = boundariesOf(keys)
      const base = baseOf(pdf.name)
      const files = await splitAt(pdf.bytes, cuts, base)
      download(zipFiles(files), `${base}-split.zip`)
      setDone(`${base}-split.zip downloaded — ${files.length} documents.`)
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
        : done ? <Result text={done} onReset={reset} />
          : (
            <>
              <FileCard pdf={pdf} />
              <label className="tool-field">
                <span>Watch this pattern — leave it empty to follow the first line of each page</span>
                <input className="tool-input wide" placeholder="e.g. Invoice\\s+(\\d+)" value={pattern} onChange={e => setPattern(e.target.value)} />
              </label>
              <p className="tool-note">
                A new document starts wherever the watched value changes from one page to the next.
                With a bracketed group, the part inside the brackets is what gets compared.
              </p>
              {preview && (
                <div className="xl-preview">
                  <table><tbody>
                    {preview.keys.slice(0, 40).map((k, i) => (
                      <tr key={i}>
                        <td style={{ width: 60 }}>Page {i + 1}</td>
                        <td>{k || <em style={{ color: '#9aa0a5' }}>nothing found</em>}</td>
                        <td style={{ width: 90 }}>{preview.cuts.includes(i) ? 'new document' : ''}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <button className="btn btn-white" onClick={look}>Preview the split</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Splitting…' : 'Split by text'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

export function SplitBookmarksTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [outline, setOutline] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf.doc) { setOutline(null); return }
    readOutline(pdf.doc).then(setOutline).catch(() => setOutline([]))
  }, [pdf.doc])

  const reset = () => { clear(); setDone(null); setError(null); setOutline(null) }
  const top = (outline || []).filter(o => o.depth === 0)
  // Several bookmarks can point at the same page; each distinct cut adds a part.
  const cuts = [...new Set(top.map(o => o.page).filter(p => p > 0))]
  const parts = cuts.length + 1

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const base = baseOf(pdf.name)
      const files = await splitAt(pdf.bytes, cuts, base)
      download(zipFiles(files), `${base}-chapters.zip`)
      setDone(`${base}-chapters.zip downloaded — ${files.length} documents.`)
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
        : done ? <Result text={done} onReset={reset} />
          : (
            <>
              <FileCard pdf={pdf} />
              {outline === null ? <p className="tool-note">Reading the table of contents…</p>
                : !top.length ? (
                  <div className="redact-warning">
                    <strong>This document has no table of contents.</strong>
                    There are no bookmarks to split on. The Create Bookmarks tool can build one
                    from the headings first, or Split can cut it by page range instead.
                  </div>
                ) : (
                  <>
                    <p className="tool-note">
                      A document starts at each top-level bookmark. Bookmarks that land on the same
                      page as the one before it do not start a new document.
                    </p>
                    <div className="xl-preview">
                      <table><tbody>
                        {top.map((o, i) => (
                          <tr key={i}><td style={{ width: 70 }}>Page {o.page + 1}</td><td>{o.title}</td></tr>
                        ))}
                      </tbody></table>
                    </div>
                  </>
                )}
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy || parts < 2} onClick={run}>
                  {busy ? 'Splitting…' : `Split into ${parts} document${parts === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
