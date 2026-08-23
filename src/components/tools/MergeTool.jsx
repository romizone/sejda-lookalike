import React, { useState } from 'react'
import { mergeDocuments } from '../../lib/pdfops'
import { DropArea, Result, ToolShell, download, prettySize } from './shell'

const isImage = f => /^image\//.test(f.type) || /\.(png|jpe?g)$/i.test(f.name)

export default function MergeTool({ tool, onBack }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [dragFrom, setDragFrom] = useState(null)

  const reset = () => { setItems([]); setDone(null); setError(null) }

  const add = async files => {
    setError(null)
    const next = []
    for (const f of files) {
      try {
        next.push({
          id: `${f.name}-${f.size}-${next.length}-${items.length}`,
          name: f.name,
          size: f.size,
          kind: isImage(f) ? 'image' : 'pdf',
          bytes: await f.arrayBuffer()
        })
      } catch {
        setError(`Could not read ${f.name}.`)
      }
    }
    setItems(list => [...list, ...next])
  }

  const move = (from, to) => {
    if (from === to || from == null) return
    setItems(list => {
      const copy = list.slice()
      const [m] = copy.splice(from, 1)
      copy.splice(to, 0, m)
      return copy
    })
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await mergeDocuments(items)
      download(blob, 'merged.pdf')
      setDone(`merged.pdf downloaded — ${items.length} files combined.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  if (done) {
    return (
      <ToolShell tool={tool} onBack={onBack}>
        <Result text={done} onReset={reset} />
      </ToolShell>
    )
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      <DropArea
        accept="application/pdf,.pdf,image/png,image/jpeg"
        multiple
        label={items.length ? 'Add more files' : 'Drop PDFs and images here'}
        hint="PDF, PNG and JPEG — they are combined in the order below"
        onFiles={add}
      />

      {items.length > 0 && (
        <>
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
                <span className="merge-grip">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" /></svg>
                </span>
                <span className={`merge-kind ${it.kind}`}>{it.kind === 'image' ? 'IMG' : 'PDF'}</span>
                <span className="merge-name">{it.name}</span>
                <span className="merge-size">{prettySize(it.size)}</span>
                <button
                  className="merge-x"
                  title="Remove"
                  onClick={() => setItems(list => list.filter((_, j) => j !== i))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Clear list</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || items.length < 1} onClick={run}>
              {busy ? 'Merging…' : `Merge ${items.length} file${items.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}

      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}
