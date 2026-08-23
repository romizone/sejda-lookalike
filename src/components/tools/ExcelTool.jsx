import React, { useState } from 'react'
import { BASE_SCALE } from '../../utils/misc'
import { readTable } from '../../lib/tables'
import { buildXlsx } from '../../lib/xlsx'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function ExcelTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [oneSheet, setOneSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  const reset = () => { clear(); setDone(null); setError(null); setPct(0); setPreview(null) }

  const load = async file => {
    await open(file)
    setPreview(null)
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    setPct(0)
    try {
      const sheets = []
      const combined = []
      let cells = 0
      for (let i = 1; i <= pdf.count; i++) {
        const page = await pdf.doc.getPage(i)
        const { rows } = await readTable(page, BASE_SCALE)
        cells += rows.reduce((n, r) => n + r.filter(c => c.trim()).length, 0)
        if (oneSheet) {
          if (combined.length && rows.length) combined.push([])
          combined.push(...rows)
        } else {
          sheets.push({ name: `Page ${i}`, rows })
        }
        setPct(i / pdf.count)
      }
      if (!cells) {
        throw new Error('No text was found to put in a sheet — this looks like a scan. Run OCR on it in the PDF Editor first.')
      }
      const name = `${baseOf(pdf.name)}.xlsx`
      download(buildXlsx(oneSheet ? [{ name: 'Sheet1', rows: combined }] : sheets), name)
      setDone(`${name} downloaded — ${cells} cells across ${oneSheet ? '1 sheet' : `${sheets.length} sheets`}.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  const showPreview = async () => {
    setError(null)
    try {
      const page = await pdf.doc.getPage(1)
      const { rows } = await readTable(page, BASE_SCALE)
      setPreview(rows.slice(0, 12))
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!pdf.doc ? (
        <DropArea label="Drop your PDF here" hint="or click to browse your computer" onFiles={f => load(f[0])} />
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
            <label className={`tool-option ${!oneSheet ? 'on' : ''}`}>
              <input type="radio" checked={!oneSheet} onChange={() => setOneSheet(false)} />
              <div>
                <strong>One sheet per page</strong>
                <span>{pdf.count} sheet{pdf.count === 1 ? '' : 's'} in the workbook</span>
              </div>
            </label>
            <label className={`tool-option ${oneSheet ? 'on' : ''}`}>
              <input type="radio" checked={oneSheet} onChange={() => setOneSheet(true)} />
              <div>
                <strong>Everything on one sheet</strong>
                <span>Pages follow each other with a blank row between</span>
              </div>
            </label>
          </div>

          <p className="tool-note">
            Columns are worked out from where the words sit: a gap much wider than a space starts
            a new cell, and cells that line up down the page become the same column. Ruled tables
            and columnar reports come out well; a free-form page will not.
          </p>

          {preview && (
            <div className="xl-preview">
              <table>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <button className="btn btn-white" onClick={showPreview}>Preview page 1</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Converting…' : 'Convert to Excel'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
