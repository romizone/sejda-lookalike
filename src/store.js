export const EMPTY_PAGE = { lines: [], objects: [] }

export const initialState = {
  phase: 'landing',
  fileName: '',
  numPages: 0,
  pages: {},
  tool: 'select',
  activeText: null,
  selection: null,
  zoom: 1,
  currentPage: 1,
  thumbsOpen: true,
  pendingImage: null,
  hint: null,
  busy: null,
  error: null,
  dirty: false,
  past: [],
  future: []
}

export const ACT = {
  OPEN_START: 'OPEN_START',
  OPEN_DONE: 'OPEN_DONE',
  OPEN_FAIL: 'OPEN_FAIL',
  SET_LINES: 'SET_LINES',
  SET_TOOL: 'SET_TOOL',
  PUSH: 'PUSH',
  UNDO: 'UNDO',
  REDO: 'REDO',
  UNDO_REVERT: 'UNDO_REVERT',
  TEXT_ACTIVATE: 'TEXT_ACTIVATE',
  TEXT_DEACTIVATE: 'TEXT_DEACTIVATE',
  TEXT_PATCH: 'TEXT_PATCH',
  TEXT_META: 'TEXT_META',
  TEXT_MERGE: 'TEXT_MERGE',
  OBJ_ADD: 'OBJ_ADD',
  OBJ_PATCH: 'OBJ_PATCH',
  OBJ_REMOVE: 'OBJ_REMOVE',
  SELECT: 'SELECT',
  ZOOM: 'ZOOM',
  PAGE: 'PAGE',
  THUMBS: 'THUMBS',
  PENDING_IMG: 'PENDING_IMG',
  HINT: 'HINT',
  BUSY: 'BUSY',
  RESET: 'RESET'
}

const withPage = (s, i, fn) => {
  const pages = { ...s.pages }
  const p = pages[i] || { lines: [], objects: [] }
  pages[i] = { ...p, ...fn(p) }
  return { ...s, pages }
}

export function reducer(s, a) {
  switch (a.type) {
    case ACT.OPEN_START:
      return { ...initialState, phase: 'landing', busy: 'Opening document…' }
    case ACT.OPEN_DONE:
      return {
        ...initialState,
        phase: 'editor',
        fileName: a.fileName,
        numPages: a.numPages,
        pages: Object.fromEntries(Array.from({ length: a.numPages }, (_, i) => [i, { lines: [], objects: [] }]))
      }
    case ACT.OPEN_FAIL:
      return { ...initialState, phase: 'landing', error: a.error }
    case ACT.RESET:
      return { ...initialState }
    case ACT.SET_LINES:
      return withPage(s, a.page, p => ({ lines: a.lines }))
    case ACT.SET_TOOL:
      return { ...s, tool: a.tool, selection: null }
    case ACT.PUSH:
      if (s.past[s.past.length - 1] === s.pages) return s
      return { ...s, past: [...s.past.slice(-59), s.pages], future: [] }
    case ACT.UNDO: {
      if (!s.past.length) return s
      return { ...s, pages: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.pages, ...s.future].slice(0, 60), activeText: null, selection: null }
    }
    case ACT.REDO: {
      if (!s.future.length) return s
      return { ...s, pages: s.future[0], future: s.future.slice(1), past: [...s.past, s.pages].slice(-60), activeText: null, selection: null }
    }
    case ACT.UNDO_REVERT: {
      if (!s.past.length) return s
      return { ...s, past: s.past.slice(0, -1) }
    }
    case ACT.TEXT_ACTIVATE:
      return { ...s, activeText: a.target, selection: null }
    case ACT.TEXT_DEACTIVATE:
      return { ...s, activeText: null }
    case ACT.TEXT_PATCH:
      return {
        ...withPage(s, a.page, p => ({
          lines: p.lines.map(ln => (a.kind === 'line' && ln.id === a.id ? { ...ln, ...a.patch, dirty: true } : ln)),
          objects: p.objects.map(o => (a.kind === 'obj' && o.id === a.id ? { ...o, ...a.patch, dirty: true } : o))
        })),
        dirty: true
      }
    case ACT.TEXT_META:
      return withPage(s, a.page, p => ({
        lines: p.lines.map(ln => (a.kind === 'line' && ln.id === a.id ? { ...ln, ...a.patch } : ln)),
        objects: p.objects.map(o => (a.kind === 'obj' && o.id === a.id ? { ...o, ...a.patch } : o))
      }))
    case ACT.TEXT_MERGE: {
      const st = withPage(s, a.page, p => ({
        lines: p.lines.map(ln => {
          if (ln.id === a.dstId) return { ...ln, text: a.text, dirty: true }
          if (ln.id === a.srcId) return { ...ln, deleted: true, dirty: true }
          return ln
        })
      }))
      return { ...st, dirty: true, activeText: { kind: 'line', page: a.page, id: a.dstId } }
    }
    case ACT.OBJ_ADD:
      return {
        ...withPage(s, a.page, p => ({ objects: [...p.objects, a.obj] })),
        dirty: true
      }
    case ACT.OBJ_PATCH:
      return {
        ...withPage(s, a.page, p => ({
          objects: p.objects.map(o => (o.id === a.id ? { ...o, ...a.patch } : o))
        })),
        dirty: true
      }
    case ACT.OBJ_REMOVE:
      return {
        ...withPage(s, a.page, p => ({
          objects: p.objects.filter(o => o.id !== a.id),
          lines: a.lineId ? p.lines.map(ln => (ln.id === a.lineId ? { ...ln, deleted: true, dirty: true } : ln)) : p.lines
        })),
        selection: null,
        dirty: true
      }
    case ACT.SELECT:
      return { ...s, selection: a.sel, activeText: null }
    case ACT.ZOOM:
      return { ...s, zoom: Math.min(3, Math.max(0.4, Math.round(a.zoom * 100) / 100)) }
    case ACT.PAGE:
      return { ...s, currentPage: a.page }
    case ACT.THUMBS:
      return { ...s, thumbsOpen: !s.thumbsOpen }
    case ACT.PENDING_IMG:
      return { ...s, pendingImage: a.img, hint: a.img ? 'Click anywhere on the page to place the image' : null, tool: a.img ? 'image' : 'select' }
    case ACT.HINT:
      return { ...s, hint: a.hint }
    case ACT.BUSY:
      return { ...s, busy: a.msg }
    default:
      return s
  }
}
