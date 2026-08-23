// pdf-lib proper can neither encrypt nor decrypt, so the two password tools
// reach for a maintained fork that can. It is imported only here, and only when
// one of those tools runs, so the rest of the app never pays for it.
const lib = () => import('@cantoo/pdf-lib')

const asBlob = async doc =>
  new Blob([await doc.save({ useObjectStreams: false })], { type: 'application/pdf' })

export async function protectPdf(bytes, { userPassword, ownerPassword, permissions }) {
  const { PDFDocument } = await lib()
  let doc
  try {
    doc = await PDFDocument.load(bytes)
  } catch (e) {
    if (/encrypt/i.test(e?.message || '')) {
      throw new Error('This PDF already has a password. Unlock it first, then protect it again.')
    }
    throw e
  }
  doc.encrypt({
    userPassword,
    ownerPassword: ownerPassword || undefined,
    permissions
  })
  return asBlob(doc)
}

export async function unlockPdf(bytes, password) {
  const { PDFDocument } = await lib()
  let doc
  try {
    doc = await PDFDocument.load(bytes, { password })
  } catch (e) {
    const msg = e?.message || ''
    if (/password/i.test(msg)) throw new Error('That password does not open this document.')
    if (/encrypt/i.test(msg)) throw new Error('This document is protected. Enter its password to open it.')
    throw e
  }
  return asBlob(doc)
}

// A lenient reload and rewrite: pdf-lib rebuilds the cross-reference table and
// drops whatever it could not make sense of, which is what fixes most files
// that a reader refuses to open.
export async function repairPdf(bytes) {
  const { PDFDocument } = await lib()
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false
  })
  const pages = doc.getPageCount()
  if (!pages) throw new Error('Nothing readable was found in this file.')
  return { blob: await asBlob(doc), pages }
}
