import React from 'react'

const svg = children => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const BLUE = { tint: '#e4edff', ink: '#3b6fd4' }
const GREEN = { tint: '#e3f5e6', ink: '#3d9a4c' }
const PINK = { tint: '#fbe4f3', ink: '#b8479a' }
const ORANGE = { tint: '#ffeadb', ink: '#d2743a' }
const VIOLET = { tint: '#ece6fd', ink: '#7250c8' }

export const GROUPS = [
  'Most popular',
  'Split & mix',
  'Organise pages',
  'Edit & sign',
  'Compress & scans',
  'Convert from PDF',
  'Convert to PDF',
  'Security',
  'Document'
]

export const TOOLS = [
  {
    id: 'editor', group: 'Most popular', ...BLUE,
    name: 'PDF Editor',
    blurb: 'Edit PDF files for free. Fill & sign PDF. Add text, links, images and shapes. Edit existing PDF text. Annotate PDF',
    icon: svg(<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" />)
  },
  {
    id: 'compress', group: 'Most popular', ...BLUE,
    name: 'Compress', blurb: 'Reduce the size of your PDF',
    icon: svg(<><path d="M9 4v5H4" /><path d="M15 20v-5h5" /><path d="M4 9 9.5 3.5" /><path d="M20 15l-5.5 5.5" /></>)
  },
  {
    id: 'delete', group: 'Most popular', ...BLUE,
    name: 'Delete Pages', blurb: 'Remove pages from a PDF document',
    icon: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m6 6 1 15h10l1-15" /></>)
  },
  {
    id: 'merge', group: 'Most popular', ...GREEN,
    name: 'Merge', blurb: 'Combine multiple PDFs and images into one',
    icon: svg(<><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><path d="M6.5 10v3.5h11V10" /><path d="M12 13.5V21" /></>)
  },
  {
    id: 'split', group: 'Most popular', ...GREEN,
    name: 'Split', blurb: 'Split specific page ranges or extract every page into a separate document',
    icon: svg(<><rect x="3" y="7" width="11" height="14" rx="1.6" /><path d="M8 3.5h10.5A1.5 1.5 0 0 1 20 5v11.5" /></>)
  },
  {
    id: 'crop', group: 'Most popular', ...PINK,
    name: 'Crop', blurb: 'Trim PDF margins, change PDF page size',
    icon: svg(<><path d="M6 2v16h16" /><path d="M2 6h16v16" /></>)
  },
  {
    id: 'sign', group: 'Most popular', ...BLUE,
    name: 'Fill & Sign', blurb: 'Add signature to PDF. Fill out PDF forms',
    icon: svg(<><path d="M3 18c3.5 0 4-11 7-11s2 8 4.5 8S18 9 21 9" /><path d="M4 21h16" /></>)
  },
  {
    id: 'word', group: 'Most popular', ...ORANGE,
    name: 'PDF To Word', blurb: 'Convert from PDF to DOC online',
    icon: svg(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="m9 12 1.2 5L12 13l1.8 4L15 12" /></>)
  },
  {
    id: 'extract', group: 'Most popular', ...GREEN,
    name: 'Extract Pages', blurb: 'Get a new document containing only the desired pages',
    icon: svg(<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>)
  },

  {
    id: 'mix', group: 'Split & mix', ...GREEN,
    name: 'Alternate & Mix', blurb: 'Mixes pages from 2 or more documents, alternating between them',
    icon: svg(<><rect x="3" y="4" width="7" height="16" rx="1.3" /><rect x="14" y="4" width="7" height="16" rx="1.3" /><path d="M10 9h4M10 15h4" /></>)
  },
  {
    id: 'splithalf', group: 'Split & mix', ...GREEN,
    name: 'Split In Half', blurb: 'Split two page layout scans, A3 to double A4 or A4 to double A5',
    icon: svg(<><rect x="3" y="4" width="18" height="16" rx="1.6" /><path d="M12 4v16" strokeDasharray="3 3" /></>)
  },
  {
    id: 'splitsize', group: 'Split & mix', ...GREEN,
    name: 'Split By Size', blurb: 'Get multiple smaller documents with specific file sizes',
    icon: svg(<><rect x="3" y="7" width="10" height="13" rx="1.4" /><path d="M8 3.5h9A1.5 1.5 0 0 1 18.5 5v9" /><path d="M17 17h4M19 15v4" /></>)
  },
  {
    id: 'splittext', group: 'Split & mix', ...GREEN,
    name: 'Split By Text', blurb: 'Extract separate documents when specific text changes from page to page',
    icon: svg(<><rect x="3" y="4" width="18" height="16" rx="1.6" /><path d="M7 9h6M7 13h10M7 17h4" /></>)
  },
  {
    id: 'splitbookmarks', group: 'Split & mix', ...GREEN,
    name: 'Split By Bookmarks', blurb: 'Extract chapters to separate documents based on the bookmarks in the table of contents',
    icon: svg(<><path d="M6 3h12v18l-6-4-6 4z" /></>)
  },
  {
    id: 'organise', group: 'Organise pages', ...GREEN,
    name: 'Organize', blurb: 'Reorder, rotate and drop pages, all on one board',
    icon: svg(<><rect x="3" y="4" width="7" height="9" rx="1.3" /><rect x="14" y="4" width="7" height="9" rx="1.3" /><path d="M3 17h18" /><path d="M3 21h11" /></>)
  },
  {
    id: 'rotate', group: 'Organise pages', ...GREEN,
    name: 'Rotate', blurb: 'Turn pages a quarter at a time and save them that way',
    icon: svg(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>)
  },
  {
    id: 'nup', group: 'Organise pages', ...GREEN,
    name: 'N-up', blurb: 'Place several pages side by side on one sheet',
    icon: svg(<><rect x="3" y="3" width="8" height="8" rx="1.2" /><rect x="13" y="3" width="8" height="8" rx="1.2" /><rect x="3" y="13" width="8" height="8" rx="1.2" /><rect x="13" y="13" width="8" height="8" rx="1.2" /></>)
  },

  {
    id: 'flip', group: 'Organise pages', ...GREEN,
    name: 'Flip', blurb: 'Mirror pages horizontally or vertically',
    icon: svg(<><path d="M12 3v18" strokeDasharray="3 3" /><path d="M9 7 4 12l5 5z" /><path d="m15 7 5 5-5 5z" /></>)
  },
  {
    id: 'resize', group: 'Organise pages', ...PINK,
    name: 'Resize', blurb: 'Change PDF page size, contents scaled to fit',
    icon: svg(<><rect x="3" y="6" width="12" height="12" rx="1.4" /><path d="M17 4h4v4M21 4l-6 6" /></>)
  },
  {
    id: 'watermark', group: 'Edit & sign', ...VIOLET,
    name: 'Watermark', blurb: 'Stamp a word across every page, at the angle and weight you choose',
    icon: svg(<><path d="M12 3s6 6.4 6 10.2A6 6 0 0 1 6 13.2C6 9.4 12 3 12 3z" /></>)
  },
  {
    id: 'numbers', group: 'Edit & sign', ...VIOLET,
    name: 'Page Numbers', blurb: 'Number the pages, anywhere on the sheet, starting where you like',
    icon: svg(<><rect x="4" y="3" width="16" height="18" rx="1.6" /><path d="M9 17h6" /><path d="M11 13v4" /></>)
  },
  {
    id: 'headerFooter', group: 'Edit & sign', ...VIOLET,
    name: 'Header & Footer', blurb: 'Put a line of text along the top or bottom of every page',
    icon: svg(<><rect x="3" y="3" width="18" height="18" rx="1.6" /><path d="M3 8h18" /><path d="M3 16h18" /></>)
  },
  {
    id: 'flatten', group: 'Edit & sign', ...VIOLET,
    name: 'Flatten', blurb: 'Paint filled-in form fields into the page so they cannot be changed',
    icon: svg(<><path d="M4 8h16" /><path d="M4 12h16" /><path d="M4 16h16" /><path d="m12 2 3 4H9z" /></>)
  },

  {
    id: 'ocr', group: 'Compress & scans', ...PINK,
    name: 'OCR',
    blurb: 'Convert PDF scans to searchable text and PDFs. Extract text from scans',
    icon: svg(<><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M8 15V9h1.6a2 2 0 0 1 0 4H8m8-4h-2.2a1.4 1.4 0 0 0 0 2.8h.9a1.4 1.4 0 0 1 0 2.8H12" /></>)
  },
  {
    id: 'bates', group: 'Edit & sign', ...VIOLET,
    name: 'Bates Numbering', blurb: 'Bates stamp multiple files at once, numbering running across them',
    icon: svg(<><rect x="3" y="4" width="14" height="16" rx="1.4" /><path d="M21 8v10a2 2 0 0 1-2 2H8" /><path d="M7 16h6" /></>)
  },
  {
    id: 'annotations', group: 'Edit & sign', ...VIOLET,
    name: 'Remove Annotations', blurb: 'Batch remove highlights, strikeouts or any other annotations',
    icon: svg(<><path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" /><path d="m14 6 4 4" /><path d="M17 17l4 4M21 17l-4 4" /></>)
  },
  {
    id: 'forms', group: 'Edit & sign', ...BLUE,
    name: 'Create Forms', blurb: 'Free PDF forms creator. Make existing PDF documents fillable',
    icon: svg(<><rect x="3" y="4" width="18" height="16" rx="1.6" /><rect x="6" y="8" width="12" height="3" rx="1" /><rect x="6" y="14" width="7" height="3" rx="1" /></>)
  },
  {
    id: 'toimages', group: 'Convert from PDF', ...ORANGE,
    name: 'PDF To JPG', blurb: 'Turn each page into a JPG or PNG picture',
    icon: svg(<><rect x="3" y="5" width="18" height="14" rx="1.8" /><circle cx="8.5" cy="10" r="1.5" /><path d="m4 17 5-5 3 3 3.5-3.5L20 16" /></>)
  },
  {
    id: 'totext', group: 'Convert from PDF', ...ORANGE,
    name: 'PDF To Text', blurb: 'Read the text back out as a plain .txt file',
    icon: svg(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>)
  },
  {
    id: 'getimages', group: 'Convert from PDF', ...ORANGE,
    name: 'Extract Images', blurb: 'Pull every picture out of the document as its own file',
    icon: svg(<><rect x="3" y="3" width="13" height="13" rx="1.6" /><path d="M8 21h11a2 2 0 0 0 2-2V8" /><path d="m4 13 3.5-3.5L11 13" /></>)
  },

  {
    id: 'toppt', group: 'Convert from PDF', ...ORANGE,
    name: 'PDF To PPT', blurb: 'Convert PDF to PowerPoint online',
    icon: svg(<><rect x="3" y="4" width="18" height="13" rx="1.6" /><path d="M12 17v3M9 20h6" /><path d="M9 8h3.2a1.9 1.9 0 0 1 0 3.8H9V8z" /></>)
  },
  {
    id: 'topdf', group: 'Convert to PDF', ...ORANGE,
    name: 'JPG To PDF', blurb: 'Put your pictures into a PDF, one page each',
    icon: svg(<><rect x="3" y="3" width="13" height="13" rx="1.6" /><circle cx="8" cy="8" r="1.4" /><path d="M8 21h11a2 2 0 0 0 2-2V8" /></>)
  },

  {
    id: 'excel', group: 'Convert from PDF', ...GREEN,
    name: 'PDF To Excel', blurb: 'Lift tables out of a PDF into a spreadsheet',
    icon: svg(<><rect x="3" y="3" width="18" height="18" rx="1.6" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>)
  },
  {
    id: 'protect', group: 'Security', ...VIOLET,
    name: 'Protect', blurb: 'Lock a PDF with a password and decide what readers may do',
    icon: svg(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>)
  },
  {
    id: 'unlock', group: 'Security', ...VIOLET,
    name: 'Unlock', blurb: 'Remove the password from a PDF you can already open',
    icon: svg(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-1.9" /></>)
  },
  {
    id: 'redact', group: 'Security', ...VIOLET,
    name: 'Redact', blurb: 'Black out anything private, and take the words away with it',
    icon: svg(<><rect x="3" y="4" width="18" height="16" rx="1.6" /><path d="M6 9h8M6 13h12M6 17h5" strokeWidth="2.6" /></>)
  },
  {
    id: 'grayscale', group: 'Compress & scans', ...PINK,
    name: 'Grayscale', blurb: 'Make the pictures in a PDF grey',
    icon: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" /></>)
  },
  {
    id: 'bookmarks', group: 'Document', ...BLUE,
    name: 'Create Bookmarks', blurb: 'Build a table of contents from the headings, or one entry per page',
    icon: svg(<><path d="M6 3h12v18l-6-4-6 4z" /><path d="M9 8h6" /></>)
  },
  {
    id: 'rename', group: 'Document', ...BLUE,
    name: 'Rename', blurb: 'Change the document filename based on text from its pages',
    icon: svg(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="M9 15h6" /></>)
  },
  {
    id: 'repair', group: 'Document', ...BLUE,
    name: 'Repair', blurb: 'Rebuild a PDF that a reader refuses to open',
    icon: svg(<><path d="M14.7 6.3a4 4 0 0 0 5 5l-8.3 8.3a2.8 2.8 0 0 1-4-4z" /><path d="m5 19 2-2" /></>)
  },
  {
    id: 'metadata', group: 'Document', ...BLUE,
    name: 'Edit Properties', blurb: 'Change the title, author and the rest of the document details',
    icon: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1" /></>)
  }
]

export const toolById = id => TOOLS.find(t => t.id === id)
