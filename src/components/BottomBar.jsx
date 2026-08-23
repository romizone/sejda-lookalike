import React from 'react'
import { ACT } from '../store'

const Ic = {
  thumbs: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>,
  minus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  left: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>,
  right: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m10 6 6 6-6 6" /></svg>
}

export default function BottomBar({ state, dispatch, onGoTo }) {
  const z = Math.round(state.zoom * 100)
  return (
    <div className="bottombar">
      <button className={`bb-btn ${state.thumbsOpen ? 'on' : ''}`} title="Toggle page thumbnails" onClick={() => dispatch({ type: ACT.THUMBS })}>{Ic.thumbs}</button>
      <div className="bb-sep" />
      <button className="bb-btn" title="Zoom out" onClick={() => dispatch({ type: ACT.ZOOM, zoom: state.zoom / 1.2 })}>{Ic.minus}</button>
      <span className="bb-zoom">{z}%</span>
      <button className="bb-btn" title="Zoom in" onClick={() => dispatch({ type: ACT.ZOOM, zoom: state.zoom * 1.2 })}>{Ic.plus}</button>
      <div className="bb-sep" />
      <button className="bb-btn" title="Previous page" onClick={() => onGoTo(state.currentPage - 2)}>{Ic.left}</button>
      <span className="bb-page">{state.currentPage} / {state.numPages}</span>
      <button className="bb-btn" title="Next page" onClick={() => onGoTo(state.currentPage)}>{Ic.right}</button>
    </div>
  )
}
