import React, { useEffect, useState } from 'react'
import { flattenPdf, imagesToPdf, nUpPdf, readMetadata, writeMetadata } from '../../lib/pdfops'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, prettySize, usePdf } from './shell'

/* ---------- several pages on one sheet ---------- */

export function NUpTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [perSheet, setPerSheet] = useState(2)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await nUpPdf(pdf.bytes, { perSheet })
      const name = `${baseOf(pdf.name)}-${perSheet}-up.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${Math.ceil(pdf.count / perSheet)} sheet${Math.ceil(pdf.count / perSheet) === 1 ? '' : 's'}.`)
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

          <div className="tool-options nup">
            {[2, 4, 6, 8, 9, 16].map(n => (
              <label key={n} className={`tool-option ${perSheet === n ? 'on' : ''}`}>
                <input type="radio" checked={perSheet === n} onChange={() => setPerSheet(n)} />
                <div>
                  <strong>{n} per sheet</strong>
                  <span>{Math.ceil(pdf.count / n)} sheet{Math.ceil(pdf.count / n) === 1 ? '' : 's'}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Build sheets'}</button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- flatten form fields ---------- */

export function FlattenTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const { blob, fields } = await flattenPdf(pdf.bytes)
      const name = `${baseOf(pdf.name)}-flattened.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${fields} field${fields === 1 ? '' : 's'} painted into the page.`)
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
          <p className="tool-note">
            Filled-in form fields become part of the page itself, so nobody can change the answers
            and every reader shows them the same way.
          </p>
          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Flatten form'}</button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

/* ---------- pictures into a document ---------- */

export function ImagesToPdfTool({ tool, onBack }) {
  const [items, setItems] = useState([])
  const [fit, setFit] = useState('image')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [dragFrom, setDragFrom] = useState(null)

  const reset = () => { setItems([]); setDone(null); setError(null) }

  const add = async files => {
    const next = []
    for (const f of files) {
      if (!/^image\/(png|jpeg)$/.test(f.type) && !/\.(png|jpe?g)$/i.test(f.name)) continue
      next.push({ id: `${f.name}-${f.size}-${next.length}-${items.length}`, name: f.name, size: f.size, bytes: await f.arrayBuffer() })
    }
    if (!next.length) setError('Only PNG and JPEG pictures can be placed in a PDF.')
    setItems(list => [...list, ...next])
  }

  const move = (from, to) => {
    if (from === to || from == null) return
    setItems(list => { const c = list.slice(); const [m] = c.splice(from, 1); c.splice(to, 0, m); return c })
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await imagesToPdf(items, { fit })
      download(blob, 'images.pdf')
      setDone(`images.pdf downloaded — ${items.length} picture${items.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  if (done) return <ToolShell tool={tool} onBack={onBack}><Result text={done} onReset={reset} /></ToolShell>

  return (
    <ToolShell tool={tool} onBack={onBack}>
      <DropArea
        accept="image/png,image/jpeg"
        multiple
        label={items.length ? 'Add more pictures' : 'Drop your pictures here'}
        hint="PNG and JPEG — one page each, in the order below"
        onFiles={add}
      />

      {items.length > 0 && (
        <>
          <div className="field-row" style={{ marginTop: 16 }}>
            <label className="tool-field">
              <span>Page size</span>
              <select className="tool-select" value={fit} onChange={e => setFit(e.target.value)}>
                <option value="image">Match each picture</option>
                <option value="a4">A4, picture centred</option>
              </select>
            </label>
          </div>

          <ol className="merge-list">
            {items.map((it, i) => (
              <li
                key={it.id}
                className={`merge-item ${dragFrom === i ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); move(dragFrom, i); setDragFrom(null) }}
                onDragEnd={() => setDragFrom(null)}
              >
                <span className="merge-kind image">IMG</span>
                <span className="merge-name">{it.name}</span>
                <span className="merge-size">{prettySize(it.size)}</span>
                <button className="merge-x" onClick={() => setItems(l => l.filter((_, j) => j !== i))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Clear list</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Building…' : `Build PDF from ${items.length} picture${items.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}

/* ---------- document properties ---------- */

const META_FIELDS = [
  ['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'],
  ['keywords', 'Keywords'], ['creator', 'Creator'], ['producer', 'Producer']
]

export function MetadataTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [meta, setMeta] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!pdf.bytes) { setMeta(null); return }
    readMetadata(pdf.bytes).then(setMeta).catch(() => setMeta({}))
  }, [pdf.bytes])

  const reset = () => { clear(); setMeta(null); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await writeMetadata(pdf.bytes, meta || {})
      const name = `${baseOf(pdf.name)}-updated.pdf`
      download(blob, name)
      setDone(`${name} downloaded.`)
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

          <div className="hf-grid">
            {META_FIELDS.map(([id, label]) => (
              <label key={id} className="tool-field">
                <span>{label}</span>
                <input
                  className="tool-input"
                  value={meta?.[id] ?? ''}
                  onChange={e => setMeta(m => ({ ...(m || {}), [id]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !meta} onClick={run}>{busy ? 'Saving…' : 'Save properties'}</button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
