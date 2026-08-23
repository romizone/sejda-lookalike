import React, { useEffect, useReducer, useRef } from 'react'
import { reducer, initialState, ACT } from './store'
import { BASE_SCALE, baseName } from './utils/misc'
import pdfjs from './lib/pdfjs'
import { extractLines } from './lib/extract'
import { exportEditedPdf } from './lib/exporter'
import { makeSamplePdf } from './lib/sample'
import Landing from './components/Landing'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import FormatBar from './components/FormatBar'
import Workspace from './components/Workspace'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const docRef = useRef({ canvases: {}, pagesMap: {}, pageDims: {}, dpr: 1 })

  const loadBytes = async (bytes, fileName) => {
    dispatch({ type: ACT.OPEN_START })
    try {
      const myDoc = { canvases: {}, pagesMap: {}, pageDims: {}, dpr: 1, gen: (docRef.current?.gen || 0) + 1 }
      docRef.current = myDoc
      const clone = new Uint8Array(bytes.byteLength)
      clone.set(new Uint8Array(bytes))
      const doc = await pdfjs.getDocument({ data: clone }).promise
      if (docRef.current !== myDoc) return
      docRef.current.bytes = bytes
      docRef.current.pdf = doc
      dispatch({ type: ACT.OPEN_DONE, fileName, numPages: doc.numPages })
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        if (docRef.current !== myDoc) return
        docRef.current.pagesMap[i - 1] = page
        const vp = page.getViewport({ scale: BASE_SCALE })
        docRef.current.pageDims[i - 1] = { w: vp.width, h: vp.height }
        const lines = await extractLines(page, BASE_SCALE, i - 1)
        if (docRef.current !== myDoc) return
        dispatch({ type: ACT.SET_LINES, page: i - 1, lines })
      }
    } catch (err) {
      console.error(err)
      dispatch({ type: ACT.OPEN_FAIL, error: 'Could not open this PDF. ' + (err?.message || '') })
    }
  }

  const openFile = async file => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      dispatch({ type: ACT.OPEN_FAIL, error: 'Please choose a PDF file.' })
      return
    }
    const buf = await file.arrayBuffer()
    loadBytes(buf, file.name)
  }

  const openSample = async () => {
    const bytes = await makeSamplePdf()
    loadBytes(bytes, 'sample-document.pdf')
  }

  const applyChanges = async () => {
    const s = stateRef.current
    dispatch({ type: ACT.BUSY, msg: 'Preparing your PDF…' })
    await new Promise(r => setTimeout(r, 30))
    try {
      const blob = await exportEditedPdf({
        bytes: docRef.current.bytes,
        pages: s.pages,
        baseScale: BASE_SCALE,
        canvases: docRef.current.canvases,
        dpr: docRef.current.dpr || 1
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName(s.fileName)}-edited.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      dispatch({ type: ACT.BUSY, msg: null })
    } catch (err) {
      console.error(err)
      dispatch({ type: ACT.BUSY, msg: null })
      alert('Export failed: ' + (err?.message || err))
    }
  }

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        dispatch({ type: ACT.TEXT_DEACTIVATE })
        dispatch({ type: ACT.SELECT, sel: null })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (stateRef.current.phase === 'editor') applyChanges()
        return
      }
      const editing = document.activeElement?.isContentEditable
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? ACT.REDO : ACT.UNDO })
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        const sel = stateRef.current.selection
        if (sel) {
          e.preventDefault()
          dispatch({ type: ACT.OBJ_REMOVE, page: sel.page, id: sel.id })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onBeforeUnload = e => {
      if (stateRef.current.dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const restart = () => dispatch({ type: ACT.RESET })

  return (
    <div className="app">
      {state.phase === 'editor' && (
        <>
          <Header
            fileName={state.fileName}
            dirty={state.dirty}
            busy={state.busy}
            onRestart={restart}
            onApply={applyChanges}
          />
          <Toolbar state={state} dispatch={dispatch} />
          <FormatBar state={state} dispatch={dispatch} />
          <Workspace state={state} dispatch={dispatch} docRef={docRef.current} />
        </>
      )}

      {state.phase === 'landing' && (
        <Landing onFile={openFile} onSample={openSample} error={state.error} busy={state.busy} />
      )}

      {state.hint && (
        <div className="hint">
          {state.hint}
          <button onClick={() => dispatch({ type: ACT.PENDING_IMG, img: null })}>Cancel</button>
        </div>
      )}

      {state.busy && (
        <div className="modal-wrap">
          <div className="modal">
            <div className="spinner" />
            <div className="msg">{state.busy}</div>
          </div>
        </div>
      )}
    </div>
  )
}
