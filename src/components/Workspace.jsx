import React, { useRef } from 'react'
import PageView from './PageView'
import Thumbs from './Thumbs'
import BottomBar from './BottomBar'
import { ACT } from '../store'

export default function Workspace({ state, dispatch, docRef }) {
  const scrollRef = useRef(null)
  const holdersRef = useRef({})

  const goTo = i => {
    const n = Math.max(0, Math.min(state.numPages - 1, i))
    const el = holdersRef.current[n]
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' })
      dispatch({ type: ACT.PAGE, page: n + 1 })
    }
  }

  const onScroll = () => {
    const sc = scrollRef.current
    if (!sc) return
    const mid = sc.scrollTop + sc.clientHeight / 2
    let best = 0
    for (let i = 0; i < state.numPages; i++) {
      const el = holdersRef.current[i]
      if (el && el.offsetTop <= mid) best = i
    }
    if (best + 1 !== state.currentPage) dispatch({ type: ACT.PAGE, page: best + 1 })
  }

  return (
    <div className="workspace">
      <Thumbs
        open={state.thumbsOpen}
        count={state.numPages}
        current={state.currentPage - 1}
        docRef={docRef}
        onGoTo={goTo}
        revision={Object.values(state.pages).filter(p => p.lines.length > 0).length + Object.keys(docRef.pagesMap || {}).length}
      />
      <div className="scroll-area" ref={scrollRef} onScroll={onScroll}>
        <div className="pages-inner">
          {Array.from({ length: state.numPages }, (_, i) => (
            <div key={i} ref={el => { holdersRef.current[i] = el }}>
              <PageView
                idx={i}
                pdfPage={docRef.pagesMap?.[i]}
                zoom={state.zoom}
                pageState={state.pages[i]}
                tool={state.tool}
                activeText={state.activeText}
                selection={state.selection}
                pendingImage={state.pendingImage}
                dispatch={dispatch}
                ACT={ACT}
                docRef={docRef}
              />
            </div>
          ))}
        </div>
        <BottomBar state={state} dispatch={dispatch} onGoTo={goTo} />
      </div>
    </div>
  )
}
