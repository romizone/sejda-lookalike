import React, { useState } from 'react'

const LANGS = [
  { id: 'eng', label: 'English' },
  { id: 'ind', label: 'Indonesian' },
  { id: 'msa', label: 'Malay' },
  { id: 'deu', label: 'German' },
  { id: 'fra', label: 'French' },
  { id: 'spa', label: 'Spanish' },
  { id: 'nld', label: 'Dutch' },
  { id: 'por', label: 'Portuguese' }
]

export default function OcrModal({ pageCount, emptyPages, currentPage, onClose, onRun }) {
  const [langs, setLangs] = useState(['eng', 'ind'])
  const [scope, setScope] = useState(emptyPages.length ? 'empty' : 'current')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const toggle = id =>
    setLangs(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))

  const run = async () => {
    if (!langs.length) return
    setError(null)
    setBusy({ label: 'Loading the recognition model…', pct: 0 })
    try {
      await onRun({
        scope,
        langs: langs.join('+'),
        onProgress: p => setBusy(p)
      })
      onClose()
    } catch (e) {
      setBusy(null)
      setError(e?.message || String(e))
    }
  }

  return (
    <div className="modal-wrap" onPointerDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal ocr-modal">
        <div className="sign-head">
          <strong>Recognise text (OCR)</strong>
          {!busy && (
            <button className="icon-btn" onClick={onClose} title="Close">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>

        {busy ? (
          <div className="ocr-progress">
            <div className="ocr-bar"><span style={{ width: `${Math.round((busy.pct || 0) * 100)}%` }} /></div>
            <div className="ocr-status">{busy.label}</div>
          </div>
        ) : (
          <>
            <p className="ocr-note">
              Scanned pages hold pictures of words, not text, so there is nothing to click on
              and edit. Recognition turns those pictures into editable text blocks.
              {emptyPages.length > 0 && (
                <> <b>{emptyPages.length} of {pageCount} page{pageCount === 1 ? '' : 's'}</b> in this document have no text layer.</>
              )}
            </p>

            <div className="ocr-row">
              <span className="ocr-label">Pages</span>
              <div className="ocr-choices">
                {emptyPages.length > 0 && (
                  <button className={`ocr-choice ${scope === 'empty' ? 'on' : ''}`} onClick={() => setScope('empty')}>
                    Pages without text ({emptyPages.length})
                  </button>
                )}
                <button className={`ocr-choice ${scope === 'current' ? 'on' : ''}`} onClick={() => setScope('current')}>
                  This page ({currentPage})
                </button>
                <button className={`ocr-choice ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>
                  All pages ({pageCount})
                </button>
              </div>
            </div>

            <div className="ocr-row">
              <span className="ocr-label">Languages</span>
              <div className="ocr-choices">
                {LANGS.map(l => (
                  <button
                    key={l.id}
                    className={`ocr-choice ${langs.includes(l.id) ? 'on' : ''}`}
                    onClick={() => toggle(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="ocr-fine">
              Recognition runs in your browser. The language model is downloaded once from the
              tesseract.js CDN — your document is not uploaded anywhere.
            </p>

            {error && <p className="ocr-error">{error}</p>}

            <div className="sign-actions">
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={!langs.length} onClick={run}>Run OCR</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
