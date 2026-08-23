import React from 'react'

const svg = (path, extra) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {path}
    {extra}
  </svg>
)

export const TOOLS = [
  {
    id: 'editor',
    name: 'PDF Editor',
    blurb: 'Edit PDF files for free. Fill & sign PDF. Add text, links, images and shapes. Edit existing PDF text. Annotate PDF',
    tint: '#e4edff',
    ink: '#3b6fd4',
    icon: svg(<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" />)
  },
  {
    id: 'compress',
    name: 'Compress',
    blurb: 'Reduce the size of your PDF',
    tint: '#e4edff',
    ink: '#3b6fd4',
    icon: svg(<><path d="M9 4v5H4" /><path d="M15 20v-5h5" /><path d="M4 9 9.5 3.5" /><path d="M20 15l-5.5 5.5" /></>)
  },
  {
    id: 'delete',
    name: 'Delete Pages',
    blurb: 'Remove pages from a PDF document',
    tint: '#e4edff',
    ink: '#3b6fd4',
    icon: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m6 6 1 15h10l1-15" /></>)
  },
  {
    id: 'merge',
    name: 'Merge',
    blurb: 'Combine multiple PDFs and images into one',
    tint: '#e3f5e6',
    ink: '#3d9a4c',
    icon: svg(<><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><path d="M6.5 10v3.5h11V10" /><path d="M12 13.5V21" /></>)
  },
  {
    id: 'split',
    name: 'Split',
    blurb: 'Split specific page ranges or extract every page into a separate document',
    tint: '#e3f5e6',
    ink: '#3d9a4c',
    icon: svg(<><rect x="3" y="7" width="11" height="14" rx="1.6" /><path d="M8 3.5h10.5A1.5 1.5 0 0 1 20 5v11.5" /></>)
  },
  {
    id: 'crop',
    name: 'Crop',
    blurb: 'Trim PDF margins, change PDF page size',
    tint: '#fbe4f3',
    ink: '#b8479a',
    icon: svg(<><path d="M6 2v16h16" /><path d="M2 6h16v16" /></>)
  },
  {
    id: 'sign',
    name: 'Fill & Sign',
    blurb: 'Add signature to PDF. Fill out PDF forms',
    tint: '#e4edff',
    ink: '#3b6fd4',
    icon: svg(<><path d="M3 18c3.5 0 4-11 7-11s2 8 4.5 8S18 9 21 9" /><path d="M4 21h16" /></>)
  },
  {
    id: 'word',
    name: 'PDF To Word',
    blurb: 'Convert from PDF to DOC online',
    tint: '#ffeadb',
    ink: '#d2743a',
    icon: svg(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="m9 12 1.2 5L12 13l1.8 4L15 12" /></>)
  },
  {
    id: 'extract',
    name: 'Extract Pages',
    blurb: 'Get a new document containing only the desired pages',
    tint: '#e3f5e6',
    ink: '#3d9a4c',
    icon: svg(<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>)
  }
]

export const toolById = id => TOOLS.find(t => t.id === id)
