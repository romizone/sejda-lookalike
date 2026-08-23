import React, { useState } from 'react'
import { stampPdf } from '../../lib/pdfops'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, usePdf } from './shell'

const POSITIONS = [
  ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']
]

const FORMATS = [
  ['{n}', '1'],
  ['Page {n}', 'Page 1'],
  ['Page {n} of {total}', 'Page 1 of 9'],
  ['- {n} -', '- 1 -']
]

export default function StampTool({ tool, kind, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const [text, setText] = useState('DRAFT')
  const [opacity, setOpacity] = useState(0.18)
  const [angle, setAngle] = useState(45)
  const [colour, setColour] = useState('#6b7280')
  const [size, setSize] = useState(kind === 'numbers' ? 10 : 9)
  const [position, setPosition] = useState('bottom-center')
  const [format, setFormat] = useState('{n}')
  const [startAt, setStartAt] = useState(1)
  const [hf, setHf] = useState({
    headerLeft: '', headerCenter: '', headerRight: '',
    footerLeft: '', footerCenter: '', footerRight: 'Page {n} of {total}'
  })

  const reset = () => { clear(); setDone(null); setError(null) }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const opts = kind === 'watermark'
        ? { kind, text, opacity, angle, color: colour, size: size > 20 ? size : undefined }
        : kind === 'numbers'
          ? { kind, format, position, size, startAt, color: colour }
          : { kind: 'headerFooter', ...hf, size, color: colour }
      const blob = await stampPdf(pdf.bytes, opts)
      const name = `${baseOf(pdf.name)}-${kind === 'watermark' ? 'watermarked' : kind === 'numbers' ? 'numbered' : 'header-footer'}.pdf`
      download(blob, name)
      setDone(`${name} downloaded — applied to all ${pdf.count} page${pdf.count === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  const canRun =
    kind === 'watermark' ? !!text.trim()
      : kind === 'numbers' ? !!format.trim()
        : Object.values(hf).some(v => v.trim())

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

          {kind === 'watermark' && (
            <>
              <label className="tool-field">
                <span>Watermark text</span>
                <input className="tool-input wide" value={text} onChange={e => setText(e.target.value)} />
              </label>
              <div className="field-row">
                <label className="tool-field">
                  <span>Opacity — {Math.round(opacity * 100)}%</span>
                  <input type="range" min="5" max="80" value={opacity * 100} onChange={e => setOpacity(Number(e.target.value) / 100)} />
                </label>
                <label className="tool-field">
                  <span>Angle — {angle}°</span>
                  <input type="range" min="-90" max="90" step="15" value={angle} onChange={e => setAngle(Number(e.target.value))} />
                </label>
                <label className="tool-field">
                  <span>Colour</span>
                  <input className="fb-color" type="color" value={colour} onChange={e => setColour(e.target.value)} />
                </label>
              </div>
            </>
          )}

          {kind === 'numbers' && (
            <>
              <div className="field-row">
                <label className="tool-field">
                  <span>Format</span>
                  <select className="tool-select" value={format} onChange={e => setFormat(e.target.value)}>
                    {FORMATS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </label>
                <label className="tool-field">
                  <span>Position</span>
                  <select className="tool-select" value={position} onChange={e => setPosition(e.target.value)}>
                    {POSITIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </label>
                <label className="tool-field">
                  <span>Start at</span>
                  <input className="tool-input" type="number" min="1" value={startAt} onChange={e => setStartAt(Math.max(1, Number(e.target.value) || 1))} />
                </label>
                <label className="tool-field">
                  <span>Size</span>
                  <input className="tool-input" type="number" min="6" max="48" value={size} onChange={e => setSize(Number(e.target.value) || 10)} />
                </label>
              </div>
              <p className="tool-fine">{'{n}'} is the page number, {'{total}'} the number of pages.</p>
            </>
          )}

          {kind === 'headerFooter' && (
            <>
              <div className="hf-grid">
                {[
                  ['headerLeft', 'Header left'], ['headerCenter', 'Header centre'], ['headerRight', 'Header right'],
                  ['footerLeft', 'Footer left'], ['footerCenter', 'Footer centre'], ['footerRight', 'Footer right']
                ].map(([id, label]) => (
                  <label key={id} className="tool-field">
                    <span>{label}</span>
                    <input className="tool-input" value={hf[id]} onChange={e => setHf(h => ({ ...h, [id]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <p className="tool-fine">{'{n}'} is the page number, {'{total}'} the number of pages.</p>
            </>
          )}

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !canRun} onClick={run}>
              {busy ? 'Working…' : 'Apply to PDF'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}
