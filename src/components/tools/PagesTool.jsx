import React, { useState } from 'react'
import { deletePages, extractPages } from '../../lib/pdfops'
import { DropArea, PageGrid, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function PagesTool({ tool, mode, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setSelected(new Set()); setDone(null); setError(null) }

  const toggle = i => setSelected(s => {
    const next = new Set(s)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  const selectAll = on =>
    setSelected(on ? new Set(Array.from({ length: pdf.count }, (_, i) => i)) : new Set())

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const pages = [...selected]
      const blob = mode === 'delete'
        ? await deletePages(pdf.bytes, pages)
        : await extractPages(pdf.bytes, pages)
      const name = `${baseOf(pdf.name)}-${mode === 'delete' ? 'pages-removed' : 'extracted'}.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${mode === 'delete' ? pdf.count - pages.length : pages.length} page${pages.length === 1 ? '' : 's'} in it.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea
          label="Drop your PDF here"
          hint="or click to browse your computer"
          onFiles={files => open(files[0])}
        />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <>
          <PageGrid
            doc={pdf.doc}
            count={pdf.count}
            selected={selected}
            onToggle={toggle}
            onSelectAll={selectAll}
            hint={mode === 'delete' ? 'Selected pages are removed' : 'Selected pages are kept'}
          />
          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !selected.size} onClick={run}>
              {busy ? 'Working…' : mode === 'delete' ? `Delete ${selected.size} page${selected.size === 1 ? '' : 's'}` : `Extract ${selected.size} page${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
