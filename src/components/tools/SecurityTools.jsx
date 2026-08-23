import React, { useState } from 'react'
import { protectPdf, repairPdf, unlockPdf } from '../../lib/security'
import { DropArea, PageThumb, Result, ToolShell, baseOf, download, prettySize, usePdf } from './shell'

const PERMISSIONS = [
  ['printing', 'Printing'],
  ['copying', 'Copying text'],
  ['modifying', 'Changing the document'],
  ['annotating', 'Adding comments'],
  ['fillingForms', 'Filling in forms'],
  ['documentAssembly', 'Rearranging pages']
]

export function ProtectTool({ tool, onBack }) {
  const [pdf, open, clear] = usePdf()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [owner, setOwner] = useState('')
  const [allowed, setAllowed] = useState({
    printing: true, copying: true, modifying: false,
    annotating: true, fillingForms: true, documentAssembly: false
  })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { clear(); setPassword(''); setConfirm(''); setOwner(''); setDone(null); setError(null) }

  const mismatch = confirm.length > 0 && password !== confirm

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await protectPdf(pdf.bytes, {
        userPassword: password,
        ownerPassword: owner,
        permissions: { ...allowed, printing: allowed.printing ? 'highResolution' : false }
      })
      const name = `${baseOf(pdf.name)}-protected.pdf`
      download(blob, name)
      setDone(`${name} downloaded — it now asks for a password before it opens.`)
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
              <span>{pdf.count} page{pdf.count === 1 ? '' : 's'} · {prettySize(pdf.size ?? pdf.bytes.byteLength)}</span>
            </div>
          </div>

          <div className="field-row">
            <label className="tool-field">
              <span>Password to open</span>
              <input className="tool-input wide" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label className="tool-field">
              <span>Repeat it</span>
              <input className="tool-input wide" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
          </div>
          {mismatch && <p className="ocr-error">The two passwords are not the same.</p>}

          <label className="tool-field">
            <span>Owner password — optional, lifts the limits below</span>
            <input className="tool-input wide" type="password" autoComplete="new-password" value={owner} onChange={e => setOwner(e.target.value)} />
          </label>

          <div className="perm-grid">
            {PERMISSIONS.map(([id, label]) => (
              <label key={id} className={`perm ${allowed[id] ? 'on' : ''}`}>
                <input type="checkbox" checked={allowed[id]} onChange={e => setAllowed(a => ({ ...a, [id]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>

          <p className="tool-fine">
            Encrypted with AES-256. The password is used here in your browser and is not sent
            anywhere — which also means nobody can recover it for you if it is lost.
          </p>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !password || mismatch} onClick={run}>
              {busy ? 'Locking…' : 'Protect PDF'}
            </button>
          </div>
        </>
      )}
      {(error || pdf.error) && <div className="error-box">{error || pdf.error}</div>}
    </ToolShell>
  )
}

export function UnlockTool({ tool, onBack }) {
  // A locked PDF cannot be previewed, so this one holds the bytes itself.
  const [file, setFile] = useState(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { setFile(null); setPassword(''); setDone(null); setError(null) }

  const take = async f => {
    setError(null)
    setFile({ name: f.name, size: f.size, bytes: await f.arrayBuffer() })
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await unlockPdf(file.bytes, password)
      const name = `${baseOf(file.name)}-unlocked.pdf`
      download(blob, name)
      setDone(`${name} downloaded — it opens without a password now.`)
    } catch (e) {
      setError(e?.message || String(e))
    }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!file ? (
        <DropArea label="Drop your protected PDF here" hint="or click to browse your computer" onFiles={f => take(f[0])} />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <>
          <div className="tool-file">
            <div className="tool-lock">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            </div>
            <div>
              <strong>{file.name}</strong>
              <span>{prettySize(file.size)}</span>
            </div>
          </div>

          <label className="tool-field">
            <span>Password</span>
            <input
              className="tool-input wide"
              type="password"
              autoComplete="off"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && password) run() }}
              autoFocus
            />
          </label>

          <p className="tool-note">
            You need the password that opens the document. This removes it from a copy — it is
            not a way past a password you do not have.
          </p>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || !password} onClick={run}>
              {busy ? 'Opening…' : 'Remove password'}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}

export function RepairTool({ tool, onBack }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => { setFile(null); setDone(null); setError(null) }

  const take = async f => {
    setError(null)
    setFile({ name: f.name, size: f.size, bytes: await f.arrayBuffer() })
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const { blob, pages } = await repairPdf(file.bytes)
      const name = `${baseOf(file.name)}-repaired.pdf`
      download(blob, name)
      setDone(`${name} downloaded — ${pages} page${pages === 1 ? '' : 's'} came through.`)
    } catch (e) {
      setError(`This file could not be rescued. ${e?.message || ''}`)
    }
    setBusy(false)
  }

  return (
    <ToolShell tool={tool} onBack={onBack}>
      {!file ? (
        <DropArea label="Drop the PDF that will not open" hint="or click to browse your computer" onFiles={f => take(f[0])} />
      ) : done ? (
        <Result text={done} onReset={reset} />
      ) : (
        <>
          <div className="tool-file">
            <div className="tool-lock">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-8.3 8.3a2.8 2.8 0 0 1-4-4z" /><path d="m5 19 2-2" /></svg>
            </div>
            <div>
              <strong>{file.name}</strong>
              <span>{prettySize(file.size)}</span>
            </div>
          </div>

          <p className="tool-note">
            The file is read as leniently as possible and written out again from scratch, with a
            fresh index of its objects. That is what fixes most documents a reader refuses to
            open. Anything too broken to make sense of is dropped rather than carried over.
          </p>

          <div className="tool-actions">
            <button className="btn btn-white" onClick={reset}>Choose another file</button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Repairing…' : 'Repair PDF'}</button>
          </div>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </ToolShell>
  )
}
