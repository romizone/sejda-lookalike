// Minimal store-only ZIP writer. PDFs and the XML inside a .docx are either
// already compressed or small enough that deflating them would cost more code
// than it saves, and every reader accepts stored entries.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = s => new TextEncoder().encode(s)

export function zipSync(entries) {
  const parts = []
  const central = []
  let offset = 0

  const push = bytes => { parts.push(bytes); offset += bytes.length }

  for (const { name, data } of entries) {
    const nameBytes = utf8(name)
    const body = typeof data === 'string' ? utf8(data) : data
    const crc = crc32(body)
    const localOffset = offset

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)      // version needed
    local.setUint16(6, 0x0800, true)  // UTF-8 names
    local.setUint16(8, 0, true)       // stored
    local.setUint16(10, 0, true)      // time
    local.setUint16(12, 0, true)      // date
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true)
    local.setUint32(22, body.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    push(new Uint8Array(local.buffer))
    push(nameBytes)
    push(body)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, 0, true)
    dir.setUint16(12, 0, true)
    dir.setUint16(14, 0, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, body.length, true)
    dir.setUint32(24, body.length, true)
    dir.setUint16(28, nameBytes.length, true)
    dir.setUint16(30, 0, true)
    dir.setUint16(32, 0, true)
    dir.setUint16(34, 0, true)
    dir.setUint16(36, 0, true)
    dir.setUint32(38, 0, true)
    dir.setUint32(42, localOffset, true)
    central.push(new Uint8Array(dir.buffer), nameBytes)
  }

  const centralOffset = offset
  let centralSize = 0
  for (const c of central) { parts.push(c); centralSize += c.length; offset += c.length }

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, centralOffset, true)
  parts.push(new Uint8Array(end.buffer))

  return new Blob(parts, { type: 'application/zip' })
}
