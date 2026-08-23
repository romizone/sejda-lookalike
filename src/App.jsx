import React, { useEffect, useReducer, useRef } from 'react'
import { reducer, initialState, ACT } from './store'
import { BASE_SCALE, baseName, uid } from './utils/misc'
import pdfjs from './lib/pdfjs'
import { extractLines } from './lib/extract'
import { exportEditedPdf } from './lib/exporter'
import { makeSamplePdf } from './lib/sample'
import Landing from './components/Landing'
import Header from './components/Header'
import Toolbar from './components/Toolbar'
import FormatBar from './components/FormatBar'
import Workspace from './components/Workspace'
import SignModal from './components/SignModal'
import OcrModal from './components/OcrModal'
import { ocrPage } from './lib/ocr'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const docRef = useRef({ canvases: {}, pagesMap: {}, pageDims: {}, widgets: {}, linkPages: {}, dpr: 1 })

  const loadBytes = async (bytes, fileName) => {
    dispatch({ type: ACT.OPEN_START })
    try {
      const myDoc = { canvases: {}, pagesMap: {}, pageDims: {}, widgets: {}, linkPages: {}, dpr: 1, gen: (docRef.current?.gen || 0) + 1 }
      docRef.current = myDoc
      const clone = new Uint8Array(bytes.byteLength)
      clone.set(new Uint8Array(bytes))
      const doc = await pdfjs.getDocument({ data: clone }).promise
      if (docRef.current !== myDoc) return
      docRef.current.bytes = bytes
      docRef.current.pdf = doc
      dispatch({ type: ACT.OPEN_DONE, fileName, numPages: doc.numPages })
      const rotations = {}
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        if (docRef.current !== myDoc) return
        docRef.current.pagesMap[i - 1] = page
        const vp = page.getViewport({ scale: BASE_SCALE, rotation: 0 })
        docRef.current.pageDims[i - 1] = { w: vp.width, h: vp.height }
        rotations[i - 1] = (((page.rotate || 0) % 360) + 360) % 360
        const lines = await extractLines(page, BASE_SCALE, i - 1)
        if (docRef.current !== myDoc) return
        dispatch({ type: ACT.SET_LINES, page: i - 1, lines })
        await importAnnotations(page, vp, i - 1, myDoc)
      }
      if (Object.keys(rotations).length) {
        const order = stateRef.current.pageOrder.map(e =>
          e.src != null && !e.rotate && rotations[e.src] ? { ...e, rotate: rotations[e.src] } : e)
        dispatch({ type: ACT.PAGES_SET, order, seed: true })
      }
    } catch (err) {
      console.error(err)
      dispatch({ type: ACT.OPEN_FAIL, error: 'Could not open this PDF. ' + (err?.message || '') })
    }
  }

  // Existing widgets stay live so forms can be filled in, and existing links
  // become ordinary objects so they can be edited or removed like new ones.
  const importAnnotations = async (page, vp, pi, myDoc) => {
    let annots = []
    try { annots = await page.getAnnotations({ intent: 'display' }) } catch { return }
    if (docRef.current !== myDoc) return

    const toBox = rect => {
      const r = vp.convertToViewportRectangle(rect)
      return {
        x: Math.min(r[0], r[2]),
        y: Math.min(r[1], r[3]),
        w: Math.abs(r[2] - r[0]),
        h: Math.abs(r[3] - r[1])
      }
    }

    const TYPE = { Tx: 'text', Btn: 'check', Ch: 'dropdown' }
    const widgets = []
    const values = {}
    const links = []

    annots.forEach((a, ai) => {
      if (a.subtype === 'Widget' && a.fieldType) {
        const box = toBox(a.rect)
        if (box.w < 2 || box.h < 2) return
        let type = TYPE[a.fieldType] || 'text'
        if (a.fieldType === 'Btn') type = a.radioButton ? 'radio' : a.checkBox ? 'check' : null
        if (!type) return
        const key = `${a.fieldName || 'f' + ai}`
        widgets.push({
          id: `W${pi}_${ai}`,
          key,
          name: a.fieldName || key,
          type,
          multiline: !!a.multiLine,
          readOnly: !!a.readOnly,
          options: (a.options || []).map(o => (typeof o === 'string' ? o : o.displayValue || o.exportValue)),
          exportValue: a.exportValue || a.buttonValue || 'Yes',
          ...box
        })
        if (values[key] === undefined) {
          if (type === 'check') values[key] = a.fieldValue && a.fieldValue !== 'Off'
          else if (type === 'radio') values[key] = a.fieldValue && a.fieldValue !== 'Off' ? a.fieldValue : ''
          else values[key] = a.fieldValue ?? ''
        }
      } else if (a.subtype === 'Link' && a.url) {
        links.push({ id: `K${pi}_${ai}`, kind: 'link', url: a.url, imported: true, ...toBox(a.rect) })
      }
    })

    myDoc.widgets[pi] = widgets
    myDoc.linkPages[pi] = true
    if (Object.keys(values).length) dispatch({ type: ACT.FORM_SEED, values })
    if (links.length) dispatch({ type: ACT.OBJ_SEED, page: pi, objects: links })
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

  const pageOps = {
    rotate(pos, deg) {
      const s = stateRef.current
      const order = s.pageOrder.map((e, i) =>
        i === pos ? { ...e, rotate: ((((e.rotate || 0) + deg) % 360) + 360) % 360 } : e)
      dispatch({ type: ACT.PUSH })
      dispatch({ type: ACT.PAGES_SET, order })
    },
    remove(pos) {
      const s = stateRef.current
      if (s.pageOrder.length <= 1) return
      const order = s.pageOrder.filter((_, i) => i !== pos)
      dispatch({ type: ACT.PUSH })
      dispatch({ type: ACT.PAGES_SET, order, current: Math.min(pos + 1, order.length) })
    },
    move(from, to) {
      const s = stateRef.current
      if (from === to || from < 0 || to < 0 || from >= s.pageOrder.length || to >= s.pageOrder.length) return
      const order = s.pageOrder.slice()
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      dispatch({ type: ACT.PUSH })
      dispatch({ type: ACT.PAGES_SET, order, current: to + 1 })
    },
    insertBlank(pos) {
      const s = stateRef.current
      const ref = s.pageOrder[pos]
      const dims = ref && ref.src != null ? docRef.current.pageDims?.[ref.src] : null
      const size = dims ? [dims.w / BASE_SCALE, dims.h / BASE_SCALE] : [595, 842]
      const key = `b${uid()}`
      const order = [
        ...s.pageOrder.slice(0, pos + 1),
        { key, src: null, rotate: 0, size },
        ...s.pageOrder.slice(pos + 1)
      ]
      dispatch({ type: ACT.PUSH })
      dispatch({ type: ACT.PAGES_SET, order, addKey: key, current: pos + 2 })
    }
  }

  const emptyPages = () => {
    const s = stateRef.current
    return s.pageOrder.filter(e => e.src != null && !(s.pages[e.key]?.lines?.length))
  }

  const runOcr = async ({ scope, langs, onProgress }) => {
    const s = stateRef.current
    const targets = s.pageOrder
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => {
        if (e.src == null) return false
        if (scope === 'current') return i === s.currentPage - 1
        if (scope === 'empty') return !(s.pages[e.key]?.lines?.length)
        return true
      })
    if (!targets.length) throw new Error('Nothing to recognise on the selected pages.')

    dispatch({ type: ACT.PUSH })
    let done = 0
    let recognised = 0
    for (const { e } of targets) {
      const pdfPage = docRef.current.pagesMap?.[e.src]
      if (!pdfPage) { done++; continue }
      const lines = await ocrPage(pdfPage, e.key, langs, m => {
        const inner = typeof m.progress === 'number' ? m.progress : 0
        onProgress({
          label: `${m.status || 'recognising'} — page ${done + 1} of ${targets.length}`,
          pct: (done + inner) / targets.length
        })
      })
      // A page that reads as blank keeps whatever it already had, so a failed
      // pass over one page cannot wipe text found on another.
      if (lines.length) {
        dispatch({ type: ACT.SET_LINES, page: e.key, lines })
        recognised++
      }
      done++
    }

    if (!recognised) {
      throw new Error(
        'No readable text was found. This usually means the page is a picture whose ' +
        'writing is too small or too soft to make out — a sharper scan, or one page ' +
        'per sheet rather than a whole web page squeezed onto one, gives it something to read.'
      )
    }
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
        dpr: docRef.current.dpr || 1,
        formValues: s.formValues,
        linkPages: docRef.current.linkPages || {},
        pageOrder: s.pageOrder
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
          <Toolbar state={state} dispatch={dispatch} pageOps={pageOps} />
          <FormatBar state={state} dispatch={dispatch} />
          <Workspace state={state} dispatch={dispatch} docRef={docRef.current} pageOps={pageOps} />
        </>
      )}

      {state.phase === 'landing' && (
        <Landing onFile={openFile} onSample={openSample} error={state.error} busy={state.busy} />
      )}

      {state.panel === 'ocr' && (
        <OcrModal
          pageCount={state.pageOrder.length}
          emptyPages={emptyPages()}
          currentPage={state.currentPage}
          onClose={() => dispatch({ type: ACT.PANEL, panel: null })}
          onRun={runOcr}
        />
      )}

      {state.panel === 'sign' && (
        <SignModal
          onClose={() => dispatch({ type: ACT.PANEL, panel: null })}
          onPlace={img => {
            dispatch({ type: ACT.PANEL, panel: null })
            dispatch({ type: ACT.PENDING_IMG, img })
          }}
        />
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
