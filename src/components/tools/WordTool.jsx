import React, { useState } from 'react'
import { BASE_SCALE } from '../../utils/misc'
import { extractLines } from '../../lib/extract'
import { buildDocx } from '../../lib/docx'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

export default function WordTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
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
      const pages = []
      let blocks = 0
      for (let i = 1; i <= pdf.count; i++) {
        const page = await pdf.doc.getPage(i)
        const vp = page.getViewport({ scale: 1, rotation: 0 })
        const lines = await extractLines(page, BASE_SCALE, i - 1)
        pages.push({
          widthPt: vp.width,
          heightPt: vp.height,
          blocks: lines
            .filter(l => l.text.trim())
            .map(l => {
              blocks++
              return {
                text: l.text,
                fontSizePt: l.fontSize / BASE_SCALE,
                xPt: l.x / BASE_SCALE,
                wPt: l.w / BASE_SCALE,
                family: l.family,
                bold: !!l.bold,
                italic: !!l.italic,
                color: null
              }
            })
        })
        setPct(i / pdf.count)
      }

      if (!blocks) {
        throw new Error(
          'This PDF holds no text to convert — it looks like a scan. Run OCR on it in the PDF Editor first, then come back.'
        )
      }

      const name = `${baseOf(pdf.name)}.docx`
      download(buildDocx(pages), name)
      setDone(`${name} downloaded — ${blocks} paragraph${blocks === 1 ? '' : 's'} across ${pdf.count} page${pdf.count === 1 ? '' : 's'}.`)
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
            The text is read back as flowing paragraphs with their font, size and indentation,
            so it can be rewritten in Word. It is a text conversion, not a copy of the artwork —
            images and vector drawings are not carried across, and a heavily designed layout will
            come out simpler than the original.
          </p>

          {busy && <div className="ocr-bar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>
              {busy ? 'Converting…' : 'Convert to Word'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
