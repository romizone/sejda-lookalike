import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

const MenuBarCtx = createContext(null)

export function MenuBar({ children }) {
  const [openId, setOpenId] = useState(null)
  const value = {
    openId,
    armed: openId != null,
    open: id => setOpenId(id),
    close: () => setOpenId(null),
    toggle: id => setOpenId(cur => (cur === id ? null : id))
  }
  return (
    <MenuBarCtx.Provider value={value}>
      {children}
    </MenuBarCtx.Provider>
  )
}

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
)

export default function Menu({ label, glyph, icon, active, items }) {
  const id = useId()
  const bar = useContext(MenuBarCtx)
  const [solo, setSolo] = useState(false)
  const open = bar ? bar.openId === id : solo
  const setOpen = next => {
    if (bar) {
      if (next) bar.open(id)
      else if (bar.openId === id) bar.close()
    } else {
      setSolo(!!next)
    }
  }

  const [at, setAt] = useState(null)
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [flip, setFlip] = useState(false)
  const [hi, setHi] = useState(-1)
  const [kbd, setKbd] = useState(false)

  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const liveItems = items.filter(it => !it.sep)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    const pop = popRef.current
    if (!r) return
    const pw = pop?.offsetWidth || 210
    const ph = pop?.offsetHeight || 8 + liveItems.length * 32
    const gap = 6
    const pad = 8
    let left = Math.min(r.left, window.innerWidth - pw - pad)
    left = Math.max(pad, left)
    let top = r.bottom + gap
    let up = false
    if (top + ph > window.innerHeight - pad && r.top - gap - ph > pad) {
      top = r.top - ph - gap
      up = true
    }
    setFlip(up)
    setAt({ left, top })
  }

  useLayoutEffect(() => {
    if (open) {
      setShown(true)
      setLeaving(false)
      const onIdx = liveItems.findIndex(it => it.on)
      setHi(onIdx >= 0 ? onIdx : 0)
      setKbd(false)
      place()
    }
  }, [open])

  useLayoutEffect(() => {
    if (shown && !leaving) place()
  }, [shown, leaving, open])

  useEffect(() => {
    if (open) return
    if (bar?.armed) {
      setShown(false)
      setLeaving(false)
      return
    }
    if (!shown) return
    setLeaving(true)
    const t = setTimeout(() => {
      setShown(false)
      setLeaving(false)
    }, 110)
    return () => clearTimeout(t)
  }, [open, bar?.armed])

  useEffect(() => {
    if (!shown || leaving) return
    place()
    const onAway = e => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      if (e.target?.closest?.('.tb-menu, [role="menu"]')) return
      setOpen(false)
    }
    const onKey = e => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        btnRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setKbd(true)
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setHi(i => {
          const n = liveItems.length
          if (!n) return -1
          return ((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + n) % n
        })
        return
      }
      if (e.key === 'Home') { e.preventDefault(); setKbd(true); setHi(0) }
      if (e.key === 'End') { e.preventDefault(); setKbd(true); setHi(liveItems.length - 1) }
      if ((e.key === 'Enter' || e.key === ' ') && !popRef.current?.contains(e.target)) {
        const it = liveItems[hi]
        if (it) {
          e.preventDefault()
          setOpen(false)
          it.run()
        }
      }
    }
    window.addEventListener('pointerdown', onAway)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('pointerdown', onAway)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [shown, leaving, hi, items])

  const onBtnEnter = () => {
    if (bar?.armed) bar.open(id)
  }

  const run = it => {
    setOpen(false)
    it.run()
  }

  let live = -1
  const pop = shown && at && createPortal(
    <div
      ref={popRef}
      className={`tb-pop${leaving ? ' out' : ''}${flip ? ' up' : ''}`}
      style={{ left: at.left, top: at.top }}
      role="menu"
      tabIndex={-1}
      aria-label={label}
    >
      {items.map(it => {
        if (it.sep) return <div className="pop-sep" key={it.key} role="separator" />
        live += 1
        const idx = live
        return (
          <button
            key={it.key}
            role="menuitem"
            className={`pop-item${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}${kbd && idx === hi ? ' hi' : ''}`}
            onMouseEnter={() => { setKbd(false); setHi(idx) }}
            onClick={() => run(it)}
          >
            <span className="pop-check">{it.on ? CHECK : null}</span>
            {it.swatch && <span className="pop-swatch" style={{ background: it.swatch }} />}
            {it.icon && !it.swatch && <span className="pop-ic">{it.icon}</span>}
            <span className="pop-label">{it.label}</span>
            {it.hint && <em>{it.hint}</em>}
          </button>
        )
      })}
    </div>,
    document.body
  )

  return (
    <div
      className={`tb-menu${open ? ' is-open' : ''}`}
      ref={wrapRef}
      onPointerEnter={onBtnEnter}
    >
      <button
        ref={btnRef}
        type="button"
        className={`tool${active || open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (bar ? bar.toggle(id) : setSolo(o => !o))}
        title={label}
      >
        {glyph ? <span style={{ fontSize: 16, fontWeight: 800, lineHeight: '20px' }}>{glyph}</span> : icon}
        {label}
        <svg className="caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 9 7 7 7-7" /></svg>
      </button>
      {pop}
    </div>
  )
}
