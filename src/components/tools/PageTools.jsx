import React, { useEffect, useState } from 'react'
import {
  PAGE_SIZES, addBookmarks, batesNumber, compressPdf, cropPdf,
  flipPdf, mixDocuments, removeAnnotations, zipFiles
} from '../../lib/pdfops'
import { detectHeadings, firstLines } from '../../lib/outline'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, prettySize, usePdf } from './shell'

const FileCard = ({ pdf }) => (
  <div className="tool-file">
    <PageThumb doc={pdf.doc} index={0} width={84} />
    <div>
      <strong>{pdf.name}</strong>
      <span>{pdf.count} page{pdf.count === 1 ? '' : 's'}{pdf.size ? ` · ${prettySize(pdf.size)}` : ''}</span>
    </div>
  </div>
)

/* ---------- mirror ---------- */

export function FlipTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [axis, setAxis] = useState('horizontal')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const blob = await flipPdf(pdf.bytes, { axis })
      const name = `${baseOf(pdf.name)}-flipped.pdf`
      download(blob, name)
      setDone(`${name} downloaded.`)
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
                <label className={`tool-option ${axis === 'horizontal' ? 'on' : ''}`}>
                  <input type="radio" checked={axis === 'horizontal'} onChange={() => setAxis('horizontal')} />
                  <div><strong>Left to right</strong><span>As if held up to a mirror</span></div>
                </label>
                <label className={`tool-option ${axis === 'vertical' ? 'on' : ''}`}>
                  <input type="radio" checked={axis === 'vertical'} onChange={() => setAxis('vertical')} />
                  <div><strong>Top to bottom</strong><span>Turned upside down about the middle</span></div>
                </label>
              </div>
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Flip pages'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- remove annotations ---------- */

export function AnnotationsTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [keepLinks, setKeepLinks] = useState(true)
  const [keepFields, setKeepFields] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const { blob, removed } = await removeAnnotations(pdf.bytes, { keepLinks, keepFields })
      const name = `${baseOf(pdf.name)}-clean.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${removed} annotation${removed === 1 ? '' : 's'} removed.`)
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
              <p className="tool-note">
                Highlights, strikeouts, sticky notes, stamps and the rest are taken out. Choose what
                stays behind.
              </p>
              <label className={`perm block ${keepLinks ? 'on' : ''}`}>
                <input type="checkbox" checked={keepLinks} onChange={e => setKeepLinks(e.target.checked)} />
                Keep hyperlinks
              </label>
              <label className={`perm block ${keepFields ? 'on' : ''}`}>
                <input type="checkbox" checked={keepFields} onChange={e => setKeepFields(e.target.checked)} />
                Keep form fields
              </label>
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Remove annotations'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- resize ---------- */

const SIZES = [['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5']]

export function ResizeTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [size, setSize] = useState('a4')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const blob = await cropPdf(pdf.bytes, { box: null, size, pages: null })
      const name = `${baseOf(pdf.name)}-${size}.pdf`
      download(blob, name)
      setDone(`${name} downloaded — every page is now ${SIZES.find(s => s[0] === size)?.[1]}.`)
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
              <div className="ocr-row">
                <span className="ocr-label">New size</span>
                <div className="ocr-choices">
                  {SIZES.map(([id, label]) => (
                    <button key={id} className={`ocr-choice ${size === id ? 'on' : ''}`} onClick={() => setSize(id)}>{label}</button>
                  ))}
                </div>
              </div>
              <p className="tool-note">
                Each page keeps its orientation and its contents are scaled to fit the new sheet,
                so nothing is cut off. {PAGE_SIZES[size] && `${PAGE_SIZES[size][0].toFixed(0)} × ${PAGE_SIZES[size][1].toFixed(0)} pt.`}
              </p>
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Resize pages'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- grayscale ---------- */

export function GrayscaleTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const reset = () => { clear(); setDone(null); setError(null); setPct(0) }

  const run = async () => {
    setBusy(true); setError(null); setPct(0)
    try {
      // Quality stays high: this is about colour, not about saving bytes.
      const { blob, images } = await compressPdf(pdf.bytes, { quality: 0.88, maxSide: 3000, grey: true }, setPct)
      const name = `${baseOf(pdf.name)}-grey.pdf`
      download(blob, name)
      setDone(images
        ? `${name} downloaded — ${images} picture${images === 1 ? '' : 's'} turned grey.`
        : `${name} downloaded — this document holds no pictures to convert.`)
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
              <p className="tool-note">
                The pictures in the document are converted to grey. Coloured text and vector
                drawings keep their own colour — changing those would mean rewriting the page's
                drawing instructions.
              </p>
              {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Make it grey'}</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- rename from the page ---------- */

export function RenameTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [lines, setLines] = useState([])
  const [chosen, setChosen] = useState('')
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf.doc) { setLines([]); setChosen(''); return }
    firstLines(pdf.doc, 0, 25).then(l => { setLines(l); setChosen(l[0] || '') }).catch(() => setLines([]))
  }, [pdf.doc])

  const reset = () => { clear(); setDone(null); setError(null); setLines([]) }

  const safe = chosen.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)

  const run = () => {
    if (!safe) { setError('Pick a line to name the file after.'); return }
    download(new Blob([pdf.bytes], { type: 'application/pdf' }), `${safe}.pdf`)
    setDone(`${safe}.pdf downloaded.`)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => open(f[0])} />
        : done ? <Result text={done} onReset={reset} />
          : (
            <>
              <FileCard pdf={pdf} />
              <p className="tool-note">Pick the line from the first page that should name the file.</p>
              <div className="xl-preview">
                <table><tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className={chosen === l ? 'picked' : ''} onClick={() => setChosen(l)} style={{ cursor: 'pointer' }}>
                      <td>{l}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              <label className="tool-field">
                <span>File name</span>
                <input className="tool-input wide" value={chosen} onChange={e => setChosen(e.target.value)} />
              </label>
              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={!safe} onClick={run}>Download as {safe || '…'}.pdf</button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- bookmarks ---------- */

export function BookmarksTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [mode, setMode] = useState('headings')
  const [entries, setEntries] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf.doc) { setEntries(null); return }
    setEntries(null)
    if (mode === 'pages') {
      setEntries(Array.from({ length: pdf.count }, (_, i) => ({ title: `Page ${i + 1}`, page: i })))
    } else {
      detectHeadings(pdf.doc).then(setEntries).catch(() => setEntries([]))
    }
  }, [pdf.doc, pdf.count, mode])

  const reset = () => { clear(); setDone(null); setError(null); setEntries(null) }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const blob = await addBookmarks(pdf.bytes, entries)
      const name = `${baseOf(pdf.name)}-bookmarked.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${entries.length} bookmark${entries.length === 1 ? '' : 's'}.`)
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
                <label className={`tool-option ${mode === 'headings' ? 'on' : ''}`}>
                  <input type="radio" checked={mode === 'headings'} onChange={() => setMode('headings')} />
                  <div><strong>From the headings</strong><span>Lines set noticeably larger than the body text</span></div>
                </label>
                <label className={`tool-option ${mode === 'pages' ? 'on' : ''}`}>
                  <input type="radio" checked={mode === 'pages'} onChange={() => setMode('pages')} />
                  <div><strong>One per page</strong><span>{pdf.count} bookmarks, numbered</span></div>
                </label>
              </div>

              {entries === null ? <p className="tool-note">Looking for headings…</p>
                : entries.length ? (
                  <div className="xl-preview">
                    <table><tbody>
                      {entries.slice(0, 60).map((e, i) => (
                        <tr key={i}><td style={{ width: 70 }}>Page {e.page + 1}</td><td>{e.title}</td></tr>
                      ))}
                    </tbody></table>
                  </div>
                ) : <p className="tool-note">No headings stood out here — try one bookmark per page instead.</p>}

              <div className="tool-actions">
                <button className="btn btn-white" onClick={reset}>Choose another file</button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={busy || !entries?.length} onClick={run}>
                  {busy ? 'Working…' : `Add ${entries?.length || 0} bookmark${entries?.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- alternate & mix ---------- */

export function MixTool({ tool, onBack }) {
  const [items, setItems] = useState([])
  const [reverseOthers, setReverseOthers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { setItems([]); setDone(null); setError(null) }

  const add = async files => {
    const next = []
    for (const f of files) {
      next.push({ id: `${f.name}-${f.size}-${next.length}-${items.length}`, name: f.name, size: f.size, bytes: await f.arrayBuffer() })
    }
    setItems(l => [...l, ...next])
  }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const blob = await mixDocuments(items, { reverseOthers })
      download(blob, 'mixed.pdf')
      setDone(`mixed.pdf downloaded — ${items.length} documents interleaved.`)
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  if (done) return <ToolShell tool={tool} onBack={onBack}><Result text={done} onReset={reset} /></ToolShell>

  return (
    <ToolShell tool={tool} onBack={onBack}>
      <DropArea multiple label={items.length ? 'Add another document' : 'Drop two or more PDFs here'}
        hint="Their pages are taken in turn: first of each, then second of each, and so on" onFiles={add} />

      {items.length > 0 && (
        <>
          <ol className="merge-list">
            {items.map((it, i) => (
              <li key={it.id} className="merge-item">
                <span className="merge-kind">PDF</span>
                <span className="merge-name">{it.name}</span>
                <span className="merge-size">{prettySize(it.size)}</span>
                <button className="merge-x" onClick={() => setItems(l => l.filter((_, j) => j !== i))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>

          <label className={`perm block ${reverseOthers ? 'on' : ''}`} style={{ marginTop: 14 }}>
            <input type="checkbox" checked={reverseOthers} onChange={e => setReverseOthers(e.target.checked)} />
            The later documents run backwards — for a stack scanned front-to-back, then back-to-front
          </label>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Clear list</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || items.length < 2} onClick={run}>
              {busy ? 'Mixing…' : `Mix ${items.length} documents`}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}

/* ---------- bates numbering ---------- */

const POSITIONS = [
  ['bottom-right', 'Bottom right'], ['bottom-center', 'Bottom centre'], ['bottom-left', 'Bottom left'],
  ['top-right', 'Top right'], ['top-center', 'Top centre'], ['top-left', 'Top left']
]

export function BatesTool({ tool, onBack }) {
  const [items, setItems] = useState([])
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [startAt, setStartAt] = useState(1)
  const [digits, setDigits] = useState(6)
  const [position, setPosition] = useState('bottom-right')
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { setItems([]); setDone(null); setError(null); setPct(0) }

  const add = async files => {
    const next = []
    for (const f of files) next.push({ name: f.name, size: f.size, bytes: await f.arrayBuffer() })
    setItems(l => [...l, ...next])
  }

  const sample = `${prefix}${String(startAt).padStart(digits, '0')}${suffix}`

  const run = async () => {
    setBusy(true); setError(null); setPct(0)
    try {
      const { files, last } = await batesNumber(items, { prefix, suffix, startAt, digits, position }, setPct)
      if (files.length === 1) {
        download(new Blob([files[0].data], { type: 'application/pdf' }), `stamped-${files[0].name}`)
      } else {
        download(zipFiles(files.map(f => ({ ...f, name: `stamped-${f.name}` }))), 'bates-stamped.zip')
      }
      setDone(`Stamped ${prefix}${String(startAt).padStart(digits, '0')}${suffix} through ${prefix}${String(last).padStart(digits, '0')}${suffix}.`)
    } catch (e) { setError(e?.message || String(e)) }
    setBusy(false)
  }

  if (done) return <ToolShell tool={tool} onBack={onBack}><Result text={done} onReset={reset} /></ToolShell>

  return (
    <ToolShell tool={tool} onBack={onBack}>
      <DropArea multiple label={items.length ? 'Add another document' : 'Drop your PDFs here'}
        hint="The numbering runs on across every file, in this order" onFiles={add} />

      {items.length > 0 && (
        <>
          <ol className="merge-list">
            {items.map((it, i) => (
              <li key={i} className="merge-item">
                <span className="merge-kind">PDF</span>
                <span className="merge-name">{it.name}</span>
                <span className="merge-size">{prettySize(it.size)}</span>
              </li>
            ))}
          </ol>

          <div className="field-row" style={{ marginTop: 16 }}>
            <label className="tool-field"><span>Prefix</span>
              <input className="tool-input" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="ABC-" /></label>
            <label className="tool-field"><span>Start at</span>
              <input className="tool-input" type="number" min="0" value={startAt} onChange={e => setStartAt(Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="tool-field"><span>Digits</span>
              <input className="tool-input" type="number" min="1" max="12" value={digits} onChange={e => setDigits(Math.max(1, Math.min(12, Number(e.target.value) || 6)))} /></label>
            <label className="tool-field"><span>Suffix</span>
              <input className="tool-input" value={suffix} onChange={e => setSuffix(e.target.value)} /></label>
            <label className="tool-field"><span>Position</span>
              <select className="tool-select" value={position} onChange={e => setPosition(e.target.value)}>
                {POSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
          </div>

          <p className="tool-fine">The first page will read <strong>{sample}</strong>.</p>
          {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Clear list</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Stamping…' : 'Stamp documents'}</button>
          </div>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}
