import React from 'react'
import { TOOLS } from '../tools'

export default function Home({ onOpen }) {
  return (
    <div className="home">
      <div className="brand">
        <div className="brand-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fff" />
            <path d="M14 3l4 4h-4z" fill="#c9e8ce" />
            <path d="M8.6 15.2l5-5 1.7 1.7-5 5-2 .3z" fill="#3fa54a" />
          </svg>
        </div>
        <div className="brand-name">Edit<span>PDF</span></div>
      </div>

      <h1>All your PDF tools, in the browser</h1>
      <p className="sub">
        Edit, sign, merge, split, crop, compress and convert — every one of them runs on your
        own machine. Your file never leaves your device.
      </p>

      <div className="home-grid">
        {TOOLS.map(t => (
          <button key={t.id} className="home-card" onClick={() => onOpen(t.id)}>
            <span className="home-ic" style={{ background: t.tint, color: t.ink }}>{t.icon}</span>
            <span className="home-name">{t.name}</span>
            <span className="home-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>

      <div className="privacy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        100% private — files are processed in your browser and never uploaded
      </div>
    </div>
  )
}
