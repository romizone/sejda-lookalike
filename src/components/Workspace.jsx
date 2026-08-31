import React, { useRef } from 'react'
import PageView from './PageView'
import Thumbs from './Thumbs'
import BottomBar from './BottomBar'
import FindPanel from './FindPanel'
import { ACT } from '../store'

export default function Workspace({ state, dispatch, docRef, pageOps }) {
  const scrollRef = useRef(null)
  const holdersRef = useRef({})

  const goTo = i => {
    const n = Math.max(0, Math.min(state.pageOrder.length - 1, i))
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
    for (let i = 0; i < state.pageOrder.length; i++) {
      const el = holdersRef.current[i]
      if (el && el.offsetTop <= mid) best = i
    }
    if (best + 1 !== state.currentPage) dispatch({ type: ACT.PAGE, page: best + 1 })
  }

  return (
    <>
      {state.panel === 'find' && <FindPanel state={state} dispatch={dispatch} onGoTo={goTo} />}
      <div className="workspace">
      <Thumbs
        open={state.thumbsOpen}
        order={state.pageOrder}
        current={state.currentPage - 1}
        docRef={docRef}
        onGoTo={goTo}
        onRotate={(pos, deg) => pageOps.rotate(pos, deg)}
        onDelete={pos => pageOps.remove(pos)}
        onReorder={(from, to) => pageOps.move(from, to)}
        revision={Object.values(state.pages).filter(p => p.lines.length > 0).length + Object.keys(docRef.pagesMap || {}).length}
      />
      <div className="scroll-area" ref={scrollRef} onScroll={onScroll}>
        <div className="pages-inner">
          {state.pageOrder.map((entry, i) => (
            <div key={entry.key} ref={el => { holdersRef.current[i] = el }}>
              <PageView
                idx={entry.key}
                src={entry.src}
                size={entry.size}
                pos={i}
                rotate={entry.rotate || 0}
                pdfPage={entry.src == null ? null : docRef.pagesMap?.[entry.src]}
                zoom={state.zoom}
                pageState={state.pages[entry.key]}
                tool={state.tool}
                activeText={state.activeText}
                selection={state.selection}
                pendingImage={state.pendingImage}
                formValues={state.formValues}
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
    </>
  )
}
