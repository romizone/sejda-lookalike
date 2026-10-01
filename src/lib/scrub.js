// Taking text out of a page for good.
//
// A white rectangle hides a word from the eye and from nothing else: the string
// is still in the content stream and comes straight back with select-all and
// copy. This module removes the glyphs themselves.
//
// Neither library can do that alone. pdf.js knows where every glyph lands - it
// is what the editor draws the page with - but it only hands out an operator
// list, with no idea which bytes each operator came from. pdf-lib owns the
// bytes and has no idea what they draw. So the page is read twice: once
// through pdf.js for the geometry, once through a small content-stream reader
// of our own for the byte ranges, and the two readings have to agree operator
// for operator before a single byte is changed. Wherever they do not, the page
// is left alone and the caller is told; a wrong guess here would either leave
// the secret in the file or delete somebody else's words.
//
// Call it once per page, with every rectangle for that page, and before or
// after drawing on the page with pdf-lib - what pdf-lib added in this session
// is recognised and left out of the comparison.
//
// What it reaches is the page's content: its streams, the Form XObjects they
// draw, and replacement text attached to marked content. It does not look at
// annotations and form fields, the structure tree, bookmarks, metadata, or the
// pixels of an image that happens to show the same words.

const IDENTITY = [1, 0, 0, 1, 0, 0]
const FONT_UNIT = [0.001, 0, 0, 0.001, 0, 0]
// Stands in for a font that pdf.js reported as an error instead of an object.
const UNLOADED = {}

// m then n, the way canvas.transform() composes them.
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
]
const through = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

const cornersOf = rects => (rects || [])
  .map(r => [Math.min(r.x, r.x + r.w), Math.min(r.y, r.y + r.h), Math.max(r.x, r.x + r.w), Math.max(r.y, r.y + r.h)])
  .filter(r => r.every(Number.isFinite))

const within = (rects, x, y) => rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3])

/* ---------- what pdf.js draws ---------- */

// The operator list resolves before the fonts it names are necessarily ready;
// the renderer waits for each one as it gets to it, and so do we.
async function operatorList(pdfPage, pdfjsLib) {
  const { OPS } = pdfjsLib
  const list = await pdfPage.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE })
  const objs = pdfPage.commonObjs
  const fonts = new Set()
  list.fnArray.forEach((fn, i) => {
    const a = list.argsArray[i]
    if (fn === OPS.setFont) fonts.add(a[0])
    if (fn === OPS.setGState) for (const [key, value] of a[0] || []) if (key === 'Font') fonts.add(value[0])
  })
  const waits = [...fonts]
    .filter(id => typeof id === 'string' && !objs.has(id))
    .map(id => new Promise(resolve => objs.get(id, resolve)))
  if (!waits.length) return list
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the fonts did not load')), 20000) })
  try { await Promise.race([Promise.all(waits), late]) } finally { clearTimeout(timer) }
  return list
}

const freshState = () => ({
  ctm: IDENTITY, tm: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0,
  charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, mode: 0,
  font: null, size: 0, dir: 1, fontMatrix: FONT_UNIT
})

// One showText, with CanvasGraphics.showText / showType3Text's arithmetic: where
// each glyph lands, and how far the pen has moved afterwards. Returns one entry
// per item - null for a number, { hit, n } for a glyph, where `n` is the TJ
// number that moves the pen exactly as far as the glyph did (null when no
// such number exists).
function place(st, items, rects) {
  const { font, size, dir, fontMatrix: fm } = st
  if (!font) throw new Error('text is shown before any font is set')
  // pdf.js draws nothing at all for a font it could not load, so there is no
  // telling where that text is - or whether it is under a rectangle.
  if (font === UNLOADED) throw new Error('a font on the page could not be loaded')
  if (font.isInvalidPDFjsFont) throw new Error('the page uses a font that cannot be measured')
  const type3 = !!font.isType3Font
  const vertical = !!font.vertical && !type3
  const hScale = st.hScale * dir
  // What Tf actually said; pdf.js keeps the sign apart as `fontDirection`.
  const tfs = size * dir
  const rise = type3 ? 0 : st.rise
  // pdf.js draws nothing and leaves the pen where it was in these two cases.
  const inert = size === 0 || (type3 && st.mode === 3)
  const marks = []
  let x = 0

  for (const g of items) {
    if (typeof g === 'number') {
      x += (vertical ? 1 : -1) * g * size / 1000
      marks.push(null)
      continue
    }
    const spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing
    let w, advance
    if (type3) {
      w = (g.width * fm[0] + fm[4]) * size
      advance = font.charProcOperatorList?.[g.operatorListId] ? w + spacing : 0
    } else if (vertical) {
      const vm = g.vmetric || font.defaultVMetrics
      w = (vm ? -vm[0] : g.width) * size * fm[0]
      advance = w - spacing * dir
    } else {
      w = g.width * size * fm[0]
      advance = w + spacing * dir
    }

    // The middle of the glyph's own width, about a third of an em above the
    // baseline: inside the ink for nearly every letter, and well clear of the
    // line above and the line below.
    const [tx, ty] = vertical
      ? [st.x, st.y + rise - (x + advance / 2)]
      : [st.x + (x + w / 2) * hScale, st.y + rise + 0.3 * tfs]
    const [ux, uy] = through(st.ctm, ...through(st.tm, tx, ty))
    if (!Number.isFinite(ux + uy)) throw new Error('a glyph has no position that can be worked out')

    // PDF 32000 9.4.4: tx = ((w0 - Tj / 1000) * Tfs + Tc + Tw) * Th. A glyph
    // and a number move the pen equally when Tj = -(w0 * Tfs + Tc + Tw) * 1000
    // / Tfs. pdf.js agrees with that for ordinary fonts; where its own
    // arithmetic says otherwise (a Type3 font with a shifted matrix, a missing
    // glyph procedure, a negative size with spacing) the glyph is not ours to
    // replace.
    let n = null
    if (!vertical && tfs !== 0) {
      const v = -(g.width * fm[0] * tfs + spacing) * 1000 / tfs
      const same = inert || Math.abs(-v * size / 1000 - advance) <= 1e-6 * (1 + Math.abs(advance))
      if (Number.isFinite(v) && Math.abs(v) < 1e9 && same) n = v
    }
    marks.push({ hit: within(rects, ux, uy), n })
    x += advance
  }

  if (inert) return marks
  if (vertical) st.y -= x
  else st.x += x * hScale
  return marks
}

// Walks the operator list as CanvasGraphics would, keeping only what decides
// where text goes. The result is the page as a sequence of events: T for a
// text-showing operator, ( and ) around a Form XObject.
function drawn(list, pdfPage, pdfjsLib, rects, limit = Infinity) {
  const { OPS } = pdfjsLib
  const events = []
  const stack = []
  let st = freshState()
  let shown = 0
  let hits = 0

  const save = () => stack.push({ ...st })
  const restore = () => { if (stack.length) st = stack.pop() }
  const moveText = (x, y) => {
    st.x = st.lineX += x
    st.y = st.lineY += y
  }
  const setFont = (name, size) => {
    const font = pdfPage.commonObjs.get(name)
    st.font = font && typeof font === 'object' ? font : UNLOADED
    st.fontMatrix = st.font.fontMatrix || FONT_UNIT
    st.dir = size < 0 ? -1 : 1
    st.size = Math.abs(size)
  }

  for (let i = 0; i < list.fnArray.length && shown < limit; i++) {
    const a = list.argsArray[i]
    switch (list.fnArray[i]) {
      case OPS.save: save(); break
      case OPS.restore: restore(); break
      case OPS.transform: st.ctm = mul(st.ctm, a); break
      case OPS.paintFormXObjectBegin:
        events.push({ t: '(' })
        save()
        if (a[0]) st.ctm = mul(st.ctm, a[0])
        break
      case OPS.paintFormXObjectEnd:
        restore()
        events.push({ t: ')' })
        break
      // A transparency group saves and restores; its matrix is applied by the
      // paintFormXObjectBegin that always follows.
      case OPS.beginGroup: save(); break
      case OPS.endGroup: restore(); break
      case OPS.setGState:
        for (const [key, value] of a[0] || []) if (key === 'Font') setFont(value[0], value[1])
        break
      case OPS.beginText:
        st.tm = IDENTITY
        st.x = st.lineX = 0
        st.y = st.lineY = 0
        break
      case OPS.setCharSpacing: st.charSpacing = a[0]; break
      case OPS.setWordSpacing: st.wordSpacing = a[0]; break
      case OPS.setHScale: st.hScale = a[0] / 100; break
      case OPS.setLeading: st.leading = -a[0]; break
      case OPS.setFont: setFont(a[0], a[1]); break
      case OPS.setTextRenderingMode: st.mode = a[0]; break
      case OPS.setTextRise: st.rise = a[0]; break
      case OPS.moveText: moveText(a[0], a[1]); break
      case OPS.setLeadingMoveText:
        st.leading = a[1]
        moveText(a[0], a[1])
        break
      case OPS.setTextMatrix:
        st.tm = [a[0], a[1], a[2], a[3], a[4], a[5]]
        st.x = st.lineX = 0
        st.y = st.lineY = 0
        break
      case OPS.nextLine: moveText(0, st.leading); break
      case OPS.showText: {
        const marks = place(st, a[0], rects)
        hits += marks.filter(m => m && m.hit).length
        events.push({ t: 'T', items: a[0], marks })
        shown++
        break
      }
    }
  }

  const textOps = list.fnArray.filter(fn => fn === OPS.showText).length
  return { events, hits, textOps }
}

const look = async (pdfPage, pdfjsLib, rects, limit) =>
  drawn(await operatorList(pdfPage, pdfjsLib), pdfPage, pdfjsLib, cornersOf(rects), limit)

/* ---------- reading the bytes the way pdf.js reads them ---------- */

// 1 is white space, 2 a delimiter.
const KIND = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) KIND[c] = 1
for (const c of '()<>[]{}/%') KIND[c.charCodeAt(0)] = 2

// Every content-stream operator with the number of operands pdf.js expects
// (a trailing + means "up to"). The table matters three times over: pdf.js
// splits run-together keywords such as `QBT` along it, uses it to decide where
// an inline image ends, and skips an operator that arrives short of operands.
const OPERATORS = new Map()
for (const entry of ('w:1 J:1 j:1 M:1 d:2 ri:1 i:1 gs:1 q:0 Q:0 cm:6 m:2 l:2 c:6 v:4 y:4 h:0 re:4 S:0 s:0 f:0 F:0 ' +
  'f*:0 B:0 B*:0 b:0 b*:0 n:0 W:0 W*:0 BT:0 ET:0 Tc:1 Tw:1 Tz:1 TL:1 Tf:2 Tr:1 Ts:1 Td:2 TD:2 Tm:6 T*:0 Tj:1 TJ:1 ' +
  '\':1 ":3 d0:2 d1:6 CS:1 cs:1 SC:4+ SCN:33+ sc:4+ scn:33+ G:1 g:1 RG:3 rg:3 K:4 k:4 sh:1 BI:0 ID:0 EI:1 Do:1 MP:1 ' +
  'DP:2 BMC:1 BDC:2 EMC:0 BX:0 EX:0').split(' ')) {
  const [name, count] = entry.split(':')
  OPERATORS.set(name, { n: parseInt(count, 10), open: count.endsWith('+') })
}
const PREFIXES = new Set([...OPERATORS.keys(), 'BM', 'BD', 'true', 'fa', 'fal', 'fals', 'false', 'nu', 'nul', 'null'])
const PATH_OPS = new Set('m l c v y h re S s f F f* B B* b b* n'.split(' '))
const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"'])

// Where pdf.js would stop reading. A lexical stop also loses the two tokens
// before it, because its parser always reads two tokens ahead.
const stop = lexical => Object.assign(new Error('unparseable content'), { stop: true, lexical })

const isBlank = c => c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a
const hexDigit = c => {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if ((c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)) return (c & 0x0f) + 9
  return -1
}

// A port of pdf.js's Lexer, quirks included, that also remembers where each
// token starts and ends. Tokens are { t, v, s, e }: num, str (an array of
// character codes), name, lit (true / false / null) and kw for everything else.
function lexer(b, start = 0, end = b.length) {
  let pos = start
  const at = i => (i < end ? b[i] : -1)

  const number = () => {
    let c = at(pos)
    let sign = 1
    let divideBy = 0
    let exponent = false
    if (c === 0x2d) {
      sign = -1
      c = at(++pos)
      if (c === 0x2d) c = at(++pos)
    } else if (c === 0x2b) {
      c = at(++pos)
    }
    while (c === 0x0a || c === 0x0d) c = at(++pos)
    if (c === 0x2e) {
      divideBy = 10
      c = at(++pos)
    }
    if (c < 0x30 || c > 0x39) {
      if (isBlank(c) || c === -1) return 0
      throw stop(true)
    }
    let base = c - 0x30
    let power = 0
    let powerSign = 1
    while ((c = at(++pos)) >= 0) {
      if (c >= 0x30 && c <= 0x39) {
        if (exponent) {
          power = power * 10 + (c - 0x30)
        } else {
          if (divideBy !== 0) divideBy *= 10
          base = base * 10 + (c - 0x30)
        }
      } else if (c === 0x2e) {
        if (divideBy !== 0) break
        divideBy = 1
      } else if (c === 0x2d) {
        // a minus sign in the middle of a number is skipped
      } else if (c === 0x45 || c === 0x65) {
        const next = at(pos + 1)
        if (next === 0x2b || next === 0x2d) {
          powerSign = next === 0x2d ? -1 : 1
          pos++
        } else if (next < 0x30 || next > 0x39) {
          break
        }
        exponent = true
      } else {
        break
      }
    }
    if (divideBy !== 0) base /= divideBy
    if (exponent) base *= 10 ** (powerSign * power)
    return sign * base
  }

  const string = () => {
    const out = []
    let depth = 1
    let c = at(++pos)
    for (;;) {
      let held = false
      if (c === -1) break
      if (c === 0x28) {
        depth++
        out.push(c)
      } else if (c === 0x29) {
        if (--depth === 0) { pos++; break }
        out.push(c)
      } else if (c === 0x5c) {
        c = at(++pos)
        if (c === -1) break
        if (c === 0x6e) out.push(10)
        else if (c === 0x72) out.push(13)
        else if (c === 0x74) out.push(9)
        else if (c === 0x62) out.push(8)
        else if (c === 0x66) out.push(12)
        else if (c >= 0x30 && c <= 0x37) {
          let v = c & 0x0f
          c = at(++pos)
          held = true
          if (c >= 0x30 && c <= 0x37) {
            v = (v << 3) + (c & 0x0f)
            c = at(++pos)
            if (c >= 0x30 && c <= 0x37) {
              held = false
              v = (v << 3) + (c & 0x0f)
            }
          }
          out.push(v)
        } else if (c === 0x0d) {
          if (at(pos + 1) === 0x0a) pos++
        } else if (c !== 0x0a) {
          out.push(c)
        }
      } else {
        out.push(c)
      }
      if (!held) c = at(++pos)
    }
    return out
  }

  const hexString = () => {
    const out = []
    let first = -1
    let c = at(++pos)
    for (;;) {
      if (c < 0) break
      if (c === 0x3e) { pos++; break }
      if (KIND[c] !== 1) {
        const d = hexDigit(c)
        if (d !== -1) {
          if (first === -1) first = d
          else { out.push(first << 4 | d); first = -1 }
        }
      }
      c = at(++pos)
    }
    if (first !== -1) out.push(first << 4)
    return out
  }

  const name = () => {
    let out = ''
    let c
    while ((c = at(++pos)) >= 0 && !KIND[c]) {
      if (c !== 0x23) { out += String.fromCharCode(c); continue }
      c = at(++pos)
      if (c < 0 || KIND[c]) { out += '#'; break }
      const hi = hexDigit(c)
      if (hi === -1) { out += '#' + String.fromCharCode(c); continue }
      const before = c
      c = at(++pos)
      const lo = hexDigit(c)
      if (lo !== -1) { out += String.fromCharCode(hi << 4 | lo); continue }
      out += '#' + String.fromCharCode(before)
      if (c < 0 || KIND[c]) break
      out += String.fromCharCode(c)
    }
    return out
  }

  const keyword = c => {
    let word = String.fromCharCode(c)
    if (c < 0x20 || c > 0x7f) {
      const next = at(pos + 1)
      if (next >= 0x20 && next <= 0x7f) { pos++; return word }
    }
    let known = PREFIXES.has(word)
    for (;;) {
      const next = at(++pos)
      if (next < 0 || KIND[next]) break
      const longer = word + String.fromCharCode(next)
      if (known && !PREFIXES.has(longer)) break
      if (word.length === 128) throw stop(true)
      word = longer
      known = PREFIXES.has(word)
    }
    return word
  }

  const next = () => {
    let comment = false
    for (; ; pos++) {
      if (pos >= end) return null
      const c = b[pos]
      if (comment) {
        if (c === 0x0a || c === 0x0d) comment = false
      } else if (c === 0x25) {
        comment = true
      } else if (KIND[c] !== 1) {
        break
      }
    }
    const s = pos
    const c = b[pos]
    const token = (t, v) => ({ t, v, s, e: pos })
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) return token('num', number())
    if (c === 0x28) return token('str', string())
    if (c === 0x2f) return token('name', name())
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { pos++; return token('kw', String.fromCharCode(c)) }
    if (c === 0x3c) {
      if (at(pos + 1) !== 0x3c) return token('str', hexString())
      pos += 2
      return token('kw', '<<')
    }
    if (c === 0x3e) {
      pos += at(pos + 1) === 0x3e ? 2 : 1
      return token('kw', pos - s === 2 ? '>>' : '>')
    }
    if (c === 0x29) throw stop(true)
    const word = keyword(c)
    if (word === 'true') return token('lit', true)
    if (word === 'false') return token('lit', false)
    if (word === 'null') return token('lit', null)
    return token('kw', word)
  }

  return { next, tell: () => pos, seek: p => { pos = Math.min(end, p) } }
}

/* inline images: BI <entries> ID <data> EI, with nothing saying how long the data is */

// Past the E and the I, and the one byte after them.
function skipEI(b, p) {
  let state = 0
  while (p < b.length) {
    const c = b[p++]
    if (state === 0) state = c === 0x45 ? 1 : 0
    else if (state === 1) state = c === 0x49 ? 2 : 0
    else break
  }
  return p
}

function afterJpeg(b, p) {
  while (p < b.length) {
    if (b[p++] !== 0xff) continue
    const marker = p < b.length ? b[p++] : -1
    if (marker === 0xd9) return p
    if (marker === 0xff) { p--; continue }
    const sized = (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) ||
      (marker >= 0xda && marker <= 0xef) || marker === 0xfe
    if (!sized) continue
    const length = p + 1 < b.length ? b[p] << 8 | b[p + 1] : 0
    p += length > 2 ? length : 0
  }
  return -1
}

function afterAscii85(b, p) {
  while (p < b.length) {
    if (b[p++] !== 0x7e) continue
    const tilde = p
    while (isBlank(b[p])) p++
    if (b[p] === 0x3e) return p + 1
    if (p > tilde && b[p] === 0x45 && b[p + 1] === 0x49) return p
  }
  return -1
}

function afterAsciiHex(b, p) {
  const gt = b.indexOf(0x3e, p)
  return gt < 0 ? -1 : gt + 1
}

// pdf.js's guess for everything else: an "EI" followed by white space, as long
// as the next few bytes look like the start of ordinary content - printable,
// and beginning with an operator that has the right number of operands. Binary
// data that happens to contain "EI " fails that test and is read through.
function afterPlainImage(b, from) {
  let state = 0
  let maybe = -1
  let p = from
  while (p < b.length) {
    let c = b[p++]
    if (state === 0) { state = c === 0x45 ? 1 : 0; continue }
    if (state === 1) { state = c === 0x49 ? 2 : 0; continue }
    if (c !== 0x20 && c !== 0x0a && c !== 0x0d) { state = 0; continue }
    maybe = p
    const ahead = b.subarray(p, p + 15)
    if (!ahead.length) return p
    for (let i = 0; i < ahead.length; i++) {
      c = ahead[i]
      if (c === 0 && ahead[i + 1] !== 0) continue
      if (c !== 0x0a && c !== 0x0d && (c < 0x20 || c > 0x7f)) { state = 0; break }
    }
    if (state !== 2) continue
    const lx = lexer(ahead)
    let operands = 0
    for (;;) {
      const t = lx.next()
      if (!t) { state = 0; break }
      if (t.t !== 'kw') { operands++; continue }
      const spec = OPERATORS.get(t.v)
      if (!spec) { state = 0; break }
      if (spec.open ? operands <= spec.n : operands === spec.n) break
      operands = 0
    }
    if (state === 2) return p
  }
  return maybe > 0 ? maybe : b.length
}

function afterImage(b, from, entries) {
  const f = entries.get('F') || entries.get('Filter')
  const first = f && f.t === 'arr' ? f.v[0] : f
  const filter = first && first.t === 'name' ? first.v : ''
  let p = -1
  if (filter === 'DCT' || filter === 'DCTDecode') p = afterJpeg(b, from)
  else if (filter === 'A85' || filter === 'ASCII85Decode') p = afterAscii85(b, from)
  else if (filter === 'AHx' || filter === 'ASCIIHexDecode') p = afterAsciiHex(b, from)
  return p < 0 ? afterPlainImage(b, from) : skipEI(b, p)
}

// The stream as a list of operators, each with its operands and its byte range:
// { op, s, e, args, n }. Follows pdf.js's Parser and EvaluatorPreprocessor,
// so that an operator pdf.js would skip is skipped here too.
function operationsOf(b) {
  const lx = lexer(b)
  const ops = []
  const queued = []
  let count = 0
  let order = 0

  const raw = () => {
    if (queued.length) return queued.shift()
    const t = lx.next()
    if (t) t.i = count++
    return t
  }

  const inlineImage = bi => {
    const entries = new Map()
    let t
    for (;;) {
      t = raw()
      if (!t || (t.t === 'kw' && t.v === 'ID')) break
      if (t.t !== 'name') throw stop(false)
      const value = raw()
      if (!value) { t = null; break }
      entries.set(t.v, object(value))
    }
    // One byte, whatever it is, separates ID from the data.
    lx.seek(afterImage(b, Math.min(b.length, lx.tell() + (t ? 1 : 0)), entries))
    queued.push({ t: 'kw', v: 'EI', s: lx.tell(), e: lx.tell(), i: count - 1 })
    return { t: 'img', s: bi.s, e: lx.tell() }
  }

  const object = t => {
    if (t.t !== 'kw') return t
    if (t.v === '[') {
      const v = []
      for (;;) {
        const item = raw()
        if (!item) throw stop(false)
        if (item.t === 'kw' && item.v === ']') return { t: 'arr', v, s: t.s, e: item.e }
        v.push(object(item))
      }
    }
    if (t.v === '<<') {
      const v = []
      for (;;) {
        const key = raw()
        if (!key) throw stop(false)
        if (key.t === 'kw' && key.v === '>>') return { t: 'dict', v, s: t.s, e: key.e }
        if (key.t !== 'name') continue
        const value = raw()
        if (!value) throw stop(false)
        v.push([key, object(value)])
      }
    }
    return t.v === 'BI' ? inlineImage(t) : t
  }

  let args = []
  // Operands an operator had too many of; pdf.js hands them to a later
  // operator that turns up short.
  const spare = []
  let wasPath = false
  let badPaths = 0
  try {
    for (;;) {
      const t = raw()
      if (!t) break
      const o = object(t)
      o.n = order++
      if (o.t !== 'kw') {
        if (o.t === 'lit' && o.v === null) continue
        args.push(o)
        if (args.length > 33) throw stop(false)
        continue
      }
      const spec = OPERATORS.get(o.v)
      if (!spec) continue
      if (!wasPath) badPaths = 0
      wasPath = PATH_OPS.has(o.v)
      if (!spec.open) {
        while (args.length > spec.n) spare.push(args.shift())
        while (args.length < spec.n && spare.length) args.unshift(spare.pop())
        if (args.length < spec.n) {
          if (wasPath && ++badPaths > 10) throw stop(false)
          args = []
          continue
        }
      }
      ops.push({ op: o.v, s: o.s, e: o.e, n: o.n, i: o.i, args })
      args = []
    }
  } catch (err) {
    if (!err.stop) throw err
    if (err.lexical) while (ops.length && ops[ops.length - 1].i >= count - 2) ops.pop()
  }
  return ops
}

/* ---------- small helpers for the rewrite ---------- */

const toText = b => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192))
  return s
}
const toBytes = s => Uint8Array.from(s, ch => ch.charCodeAt(0))
const toHex = codes => codes.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()
const near = (a, b) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a))

// Five decimals of a thousandth of an em is far below anything a renderer can
// show, and keeps exponents out of the stream.
const fmt = v => {
  const s = v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// bytes[from, to) with the edits that fall inside it applied. Edits are sorted
// and do not overlap.
function splice(bytes, edits, from, to) {
  const parts = []
  let at = from
  for (const ed of edits) {
    if (ed.s < from || ed.e > to) continue
    parts.push(bytes.subarray(at, ed.s), toBytes(ed.text))
    at = ed.e
  }
  parts.push(bytes.subarray(at, to))
  return concat(parts)
}

// The operators that give a stream its structure. A rewrite may turn Tj into
// TJ and nothing else, so this has to read the same before and after.
const SKELETON = new Set(['q', 'Q', 'BT', 'ET', 'Tf', 'Do', 'gs', 'BMC', 'BDC', 'EMC', 'EI'])
const skeleton = ops => ops
  .map(o => (TEXT_OPS.has(o.op) ? 'T' : o.op))
  .filter(name => name === 'T' || SKELETON.has(name))
  .join(' ')

const signature = b => operationsOf(b)
  .map(o => o.op + ' ' + o.args.map(a => toText(b.subarray(a.s, a.e))).join(' '))
  .join('\n')

// The bytes each glyph of a text operator was written with, in pdf.js's order,
// or null when the operator's strings do not turn out to be exactly the glyphs
// pdf.js drew - same count, same character codes, numbers in the same places.
function glyphBytes(parts, items, perGlyph) {
  if (!perGlyph) return null
  const out = []
  let k = 0
  for (const p of parts) {
    if (p.t === 'num') {
      if (typeof items[k] !== 'number' || !near(items[k], p.v)) return null
      out.push(null)
      k++
      continue
    }
    if (p.t !== 'str' || p.v.length % perGlyph) return null
    for (let i = 0; i < p.v.length; i += perGlyph) {
      const g = items[k++]
      if (!g || typeof g !== 'object') return null
      const codes = p.v.slice(i, i + perGlyph)
      if (codes.some(c => c > 255)) return null
      if (g.originalCharCode !== codes.reduce((code, c) => code * 256 + c, 0)) return null
      out.push(codes)
    }
  }
  return k === items.length ? out : null
}

// A TJ array body: kept glyphs as hex strings, everything else as numbers,
// neighbours of the same kind merged.
function arrayBody(entries) {
  const out = []
  for (const e of entries) {
    const last = out.length - 1
    if (typeof e === 'number' && typeof out[last] === 'number') out[last] += e
    else if (typeof e === 'string' && typeof out[last] === 'string') out[last] += e
    else out.push(e)
  }
  return out.map(e => (typeof e === 'number' ? fmt(e) : `<${e}>`)).join(' ')
}

/* ---------- the rewrite ---------- */

const HIDDEN_TEXT = ['ActualText', 'Alt', 'E']
const STREAM_KEYS = ['Length', 'Filter', 'DecodeParms', 'DL']

function rewrite(lib, doc, page, seen) {
  const { PDFName, PDFRef, PDFDict, PDFArray, PDFNumber, PDFStream, PDFRawStream, PDFContentStream, decodePDFRawStream } = lib
  const ctx = doc.context
  const node = page.node
  const N = s => PDFName.of(s)
  // PDFName.of() decodes #xx itself, so a literal # has to be spelt out.
  const key = tok => PDFName.of(tok.v.replace(/#/g, '#23'))
  const resolve = o => (o instanceof PDFRef ? ctx.lookup(o) : o)
  const dictOf = o => {
    const v = resolve(o)
    return v instanceof PDFDict ? v : null
  }
  // The raw entry `tok` names in one of the resource categories.
  const resource = (res, kind, tok) => {
    if (!tok || tok.t !== 'name') return undefined
    const group = dictOf(res && res.get(N(kind)))
    return group ? group.get(key(tok)) : undefined
  }

  const decoded = new Map()
  const decode = stream => {
    if (!decoded.has(stream)) decoded.set(stream, decodePDFRawStream(stream).decode())
    return decoded.get(stream)
  }

  // How many bytes of a string make one glyph in this font: 1 for the simple
  // fonts, 2 for Identity-H, 0 for anything this module cannot split.
  const perGlyph = raw => {
    const font = dictOf(raw)
    if (!font) return 0
    const is = (v, ...names) => names.some(n => resolve(v) === N(n))
    const subtype = font.get(N('Subtype'))
    if (is(subtype, 'Type1', 'TrueType', 'MMType1', 'Type3')) return 1
    if (is(subtype, 'Type0') && is(font.get(N('Encoding')), 'Identity-H')) return 2
    return 0
  }

  /* the page's content: one buffer, with a note of which stream each part came from */

  const rawContents = node.get(N('Contents'))
  const top = resolve(rawContents)
  const refs = top instanceof PDFArray ? top.asArray() : top ? [rawContents] : []
  const segs = []
  for (const ref of refs) {
    const stream = resolve(ref)
    if (!stream) continue
    // A PDFContentStream only exists for content drawn in this session: the
    // file pdf.js was given cannot contain it, and pdf-lib may still be
    // appending to it, so it is kept by reference and never rewritten.
    if (stream instanceof PDFContentStream) segs.push({ ref, session: true, bytes: stream.getUnencodedContents() })
    else if (stream instanceof PDFRawStream) segs.push({ ref, session: false, bytes: decode(stream) })
    else throw new Error('the page content could not be read')
  }
  let size = 0
  for (const g of segs) {
    g.s = size
    g.e = size + g.bytes.length
    size = g.e + 1
  }
  const joined = new Uint8Array(Math.max(0, size - 1)).fill(0x0a)
  for (const g of segs) joined.set(g.bytes, g.s)

  // The specification lets a page's streams be cut only between tokens, which
  // is why they are joined with a line break here and in what gets written.
  // pdf.js joins them with nothing; when a cut has no white space on either
  // side the two readings can part company, and then nothing is safe to do.
  let edge
  let glued = false
  for (const g of segs) {
    if (!g.bytes.length) continue
    if (edge !== undefined && !KIND[edge] && !KIND[g.bytes[0]]) glued = true
    edge = g.bytes[g.bytes.length - 1]
  }
  if (glued && signature(concat(segs.map(g => g.bytes))) !== signature(joined)) {
    throw new Error('the page content is split in the middle of a token')
  }

  const originalEnd = Math.max(-1, ...segs.filter(g => !g.session).map(g => g.e))
  const inSession = p => segs.some(g => g.session && p >= g.s && p < g.e)

  /* the same sequence of events, from the bytes */

  const events = []
  const named = []
  // Every `Do`, with the resources its name was looked up in.
  const uses = []
  const root = {
    bytes: joined, ops: operationsOf(joined), children: [], edits: [], adds: [], drops: [],
    res: dictOf(node.getInheritableAttribute(N('Resources')))
  }
  root.owner = root

  const textEvent = (nd, op, unit, spans) => {
    const a = op.args
    const last = a[a.length - 1]
    const wellTyped = op.op === 'TJ'
      ? last.t === 'arr'
      : last.t === 'str' && (op.op !== '"' || (a[0].t === 'num' && a[1].t === 'num'))
    // pdf.js does something with a malformed operand, but nothing worth
    // imitating; an event that matches nothing makes the page fail cleanly.
    if (!wellTyped) return { t: 'X' }
    return {
      t: 'T', nd, op, perGlyph: unit, spans: spans.filter(Boolean), s: a[0].s, e: op.e,
      // operands and operator directly after one another, nothing in between
      tidy: a.every((tok, j) => tok.n === op.n - a.length + j)
    }
  }

  const enter = (nd, child, unit, spans, trail) => {
    if (trail.includes(child.stream) || trail.length > 24) throw new Error('form XObjects are nested too deeply')
    child.bytes = decode(child.stream)
    child.ops = operationsOf(child.bytes)
    // A form without resources of its own borrows those it is used with.
    const own = dictOf(child.stream.dict.get(N('Resources')))
    child.res = own || nd.res
    child.owner = own ? child : nd.owner
    child.children = []
    child.edits = []
    child.adds = []
    // Property lists to forget belong to whoever owns the resources.
    child.drops = own ? [] : nd.drops
    nd.children.push(child)
    events.push({ t: '(' })
    scan(child, unit, spans, [...trail, child.stream])
    events.push({ t: ')' })
  }

  // An ExtGState can set the font, and can carry a soft mask whose group pdf.js
  // interprets on the spot, in the order the dictionary lists them.
  const graphicsState = (nd, op, unit, spans, trail) => {
    const gs = dictOf(resource(nd.res, 'ExtGState', op.args[0]))
    if (!gs) return unit
    for (const [k, raw] of gs.entries()) {
      const v = resolve(raw)
      if (k === N('Font')) {
        unit = v instanceof PDFArray ? perGlyph(v.get(0)) : 0
      } else if (k === N('SMask') && v instanceof PDFDict) {
        const group = resolve(v.get(N('G')))
        if (!(resolve(v.get(N('S'))) instanceof PDFName) || !(group instanceof PDFRawStream)) break
        // Text in a mask is a shape, not words; it is counted and left alone.
        enter(nd, { stream: group, frozen: true }, unit, spans, trail)
      }
    }
    return unit
  }

  // `unit` is how many bytes make a glyph in the font currently set - the one
  // piece of graphics state the bytes have to be followed for. It is saved and
  // restored by q and Q and carried into a form from the point of its Do.
  // `spans` is the stack of open marked-content sequences.
  function scan(nd, unit, spans, trail) {
    const floor = spans.length
    const saved = []
    for (const op of nd.ops) {
      if (nd === root) {
        if (op.s >= originalEnd) break
        if (inSession(op.s)) {
          // pdf-lib brackets a page's content with q ... Q, which pdf.js never
          // saw and which changes nothing. Anything else put in front of the
          // original content could have moved it.
          if (op.op !== 'q' && op.op !== 'Q') throw new Error('the page was changed before its text could be removed')
          continue
        }
      }
      switch (op.op) {
        case 'q': saved.push(unit); break
        case 'Q': if (saved.length) unit = saved.pop(); break
        case 'Tf': unit = perGlyph(resource(nd.res, 'Font', op.args[0])); break
        case 'gs': unit = graphicsState(nd, op, unit, spans, trail); break
        case 'Do': {
          const tok = op.args[0]
          const ref = resource(nd.res, 'XObject', tok)
          const stream = resolve(ref)
          const isForm = ref instanceof PDFRef && stream instanceof PDFRawStream &&
            resolve(stream.dict.get(N('Subtype'))) === N('Form')
          const child = isForm ? { ref, stream, tok, frozen: nd.frozen } : null
          if (tok.t === 'name') uses.push({ res: nd.res, name: tok.v, child })
          if (child) enter(nd, child, unit, spans, trail)
          break
        }
        case 'BMC': spans.push(null); break
        case 'BDC':
          spans.push({ nd, tok: op.args[1] })
          if (op.args[1].t === 'name') named.push(spans[spans.length - 1])
          break
        case 'EMC': if (spans.length > floor) spans.pop(); break
        case 'Tj': case 'TJ': case "'": case '"': events.push(textEvent(nd, op, unit, spans)); break
      }
    }
    spans.length = floor
  }

  scan(root, 0, [], [])

  const theirs = seen.events
  if (events.length !== theirs.length || events.some((ev, i) => ev.t !== theirs[i].t)) {
    throw new Error('the page content does not match what is drawn')
  }

  /* what to change */

  let removed = 0
  let left = 0
  // Copies of removed text that had to stay because something else uses them.
  let lingering = 0
  const emptied = new Set()

  // ' and " move to the next line before they show anything, and " sets the
  // two spacings first.
  const lead = ev => {
    const a = ev.op.args
    const src = tok => toText(ev.nd.bytes.subarray(tok.s, tok.e))
    if (ev.op.op === "'") return 'T* '
    if (ev.op.op === '"') return `${src(a[0])} Tw ${src(a[1])} Tc T* `
    return ''
  }

  // Each removed glyph becomes the number that moves the pen as far as the
  // glyph did, so everything after it stays exactly where it was.
  const partly = (their, codes) => {
    const entries = []
    let gone = 0
    their.items.forEach((g, k) => {
      const m = their.marks[k]
      if (!m) entries.push(g)
      else if (m.hit && m.n !== null) { entries.push(m.n); gone++ } else entries.push(toHex(codes[k]))
    })
    return { gone, body: arrayBody(entries) }
  }

  // An operator whose strings cannot be split into glyphs can still go as a
  // whole, when every glyph it shows is to be removed.
  const wholly = (parts, their, hit) => {
    const none = { gone: 0 }
    if (!parts.every(p => p.t === 'str' || p.t === 'num')) return none
    const mine = parts.filter(p => p.t === 'num').map(p => p.v)
    const numbers = their.items.filter(g => typeof g === 'number')
    const glyphs = their.marks.filter(Boolean)
    const bytes = parts.reduce((n, p) => n + (p.t === 'str' ? p.v.length : 0), 0)
    if (hit !== glyphs.length || glyphs.some(m => m.n === null) || bytes < glyphs.length) return none
    if (mine.length !== numbers.length || mine.some((v, j) => !near(v, numbers[j]))) return none
    return { gone: hit, body: fmt(glyphs.reduce((n, m) => n + m.n, 0) + mine.reduce((n, v) => n + v, 0)) }
  }

  const plan = (ev, their) => {
    const hit = their.marks.filter(m => m && m.hit).length
    if (!hit) return
    const last = ev.op.args[ev.op.args.length - 1]
    const parts = last.t === 'arr' ? last.v : [last]
    const usable = !ev.nd.frozen && ev.tidy
    const codes = usable ? glyphBytes(parts, their.items, ev.perGlyph) : null
    let change = { gone: 0 }
    if (codes) change = partly(their, codes)
    else if (usable && !ev.perGlyph) change = wholly(parts, their, hit)
    left += hit - change.gone
    if (!change.gone) return
    removed += change.gone
    ev.nd.edits.push({ s: ev.s, e: ev.e, text: `${lead(ev)}[${change.body}] TJ`, words: true })
    for (const span of ev.spans) emptied.add(span)
  }

  events.forEach((ev, i) => { if (ev.t === 'T') plan(ev, theirs[i]) })

  const reason = left ? `${left} glyph${left === 1 ? '' : 's'} could not be taken out of the page content` : ''
  if (!removed) return { removed, left, reason, shared: 0, held: [] }

  // Marked content can carry the words a second time, as replacement text for
  // a screen reader or for copy-and-paste. Once any glyph inside has gone, that
  // text describes something that is no longer there - and still contains it.
  for (const { nd, tok } of emptied) {
    if (tok.t === 'dict') {
      const pairs = tok.v.filter(([k]) => HIDDEN_TEXT.includes(k.v))
      if (!pairs.length) continue
      if (tok.v.some(([, v]) => v.t === 'kw')) nd.edits.push({ s: tok.s, e: tok.e, text: '<<>>', words: true })
      else for (const [k, v] of pairs) nd.edits.push({ s: k.s, e: v.e, text: ' ', words: true })
    } else if (tok.t === 'name') {
      const props = dictOf(resource(nd.res, 'Properties', tok))
      if (!props || !HIDDEN_TEXT.some(h => props.has(N(h)))) continue
      const id = resolve(props.get(N('MCID')))
      nd.edits.push({ s: tok.s, e: tok.e, text: id instanceof PDFNumber ? `<</MCID ${id.asNumber()}>>` : '<<>>' })
      // The property list itself lives in the resources. It can go from this
      // page's copy of them once nothing here refers to it any more.
      const inUse = named.some(o => o.nd.res === nd.res && o.tok.v === tok.v && !emptied.has(o))
      if (inUse) lingering++
      else nd.drops.push(key(tok))
    }
  }

  /* writing it back */

  const made = []
  const register = o => {
    const ref = ctx.register(o)
    made.push(ref)
    return ref
  }
  // Objects this page stops using, and whether they hold any of the text.
  const retired = new Map()
  const retire = (o, holdsText) => { if (o instanceof PDFRef) retired.set(o, holdsText || !!retired.get(o)) }

  const settle = nd => {
    nd.edits.sort((a, b) => a.s - b.s)
    if (nd.edits.some((ed, i) => i && ed.s < nd.edits[i - 1].e)) throw new Error('overlapping changes')
    const bytes = splice(nd.bytes, nd.edits, 0, nd.bytes.length)
    if (skeleton(operationsOf(bytes)) !== skeleton(nd.ops)) throw new Error('the rewritten content does not read back')
    return bytes
  }

  const freshName = nd => {
    const have = dictOf(nd.res && nd.res.get(N('XObject')))
    for (let i = 1; ; i++) {
      const name = `Scrub${i}`
      if (!(have && have.has(N(name))) && !nd.adds.some(([n]) => n === name)) return name
    }
  }

  // Resources may be inherited from the page tree or shared between pages, so
  // the dictionary is never touched: the user gets a copy of it, and of its
  // XObject dictionary, with the new forms added under new names.
  const ownResources = nd => {
    const res = nd.res ? nd.res.clone(ctx) : ctx.obj({})
    if (nd.adds.length) {
      const old = res.get(N('XObject'))
      const xobjects = dictOf(old) ? dictOf(old).clone(ctx) : ctx.obj({})
      // A name that only rewritten drawings used must not stay behind in the
      // copy: it would keep the old form in the file, words and all.
      const mine = uses.filter(u => u.res === nd.res)
      for (const u of mine) {
        const live = mine.some(o => o.name === u.name && !(o.child && o.child.dirty)) ||
          (nd === root && sessionNames.has(u.name))
        if (!live) xobjects.delete(key(u.child.tok))
      }
      for (const [name, ref] of nd.adds) xobjects.set(N(name), ref)
      res.set(N('XObject'), xobjects)
      retire(old, false)
    }
    if (nd.drops.length && dictOf(res.get(N('Properties')))) {
      const old = res.get(N('Properties'))
      const props = dictOf(old).clone(ctx)
      for (const name of nd.drops) {
        retire(props.get(name), true)
        props.delete(name)
      }
      res.set(N('Properties'), props)
      retire(old, true)
    }
    return res
  }

  // Bottom up: a form that changed becomes a new object - the old one may be
  // drawn elsewhere, even elsewhere on this page - and whoever draws it is
  // pointed at the copy.
  const rebuild = nd => {
    for (const child of nd.children) {
      if (!rebuild(child)) continue
      const name = freshName(nd)
      nd.edits.push({ s: child.tok.s, e: child.tok.e, text: `/${name}` })
      nd.adds.push([name, child.made])
    }
    if (!nd.edits.length) return false
    if (nd === root) return true
    const stream = ctx.flateStream(settle(nd))
    for (const [k, v] of nd.stream.dict.entries()) {
      if (!STREAM_KEYS.some(name => k === N(name))) stream.dict.set(k, v)
    }
    if (nd.adds.length || (nd.owner === nd && nd.drops.length)) {
      retire(nd.stream.dict.get(N('Resources')), nd.drops.length > 0)
      stream.dict.set(N('Resources'), ownResources(nd))
    }
    nd.made = register(stream)
    retire(nd.ref, nd.edits.some(ed => ed.words))
    return true
  }

  // Everything the document can still reach from its trailer.
  const reachable = () => {
    const found = new Set()
    const todo = Object.values(ctx.trailerInfo).filter(Boolean)
    while (todo.length) {
      const o = todo.pop()
      if (o instanceof PDFRef) {
        if (found.has(o)) continue
        found.add(o)
        const target = ctx.lookup(o)
        if (target) todo.push(target)
      } else if (o instanceof PDFDict) {
        for (const v of o.values()) todo.push(v)
      } else if (o instanceof PDFArray) {
        for (const v of o.asArray()) todo.push(v)
      } else if (o instanceof PDFStream) {
        todo.push(o.dict)
      }
    }
    return found
  }

  const dirty = nd => {
    nd.dirty = nd.children.map(dirty).some(Boolean) || nd.edits.length > 0
    return nd.dirty
  }
  dirty(root)
  // What pdf-lib drew in this session looks its names up in the same resources.
  const sessionNames = new Set(root.ops
    .filter(o => o.op === 'Do' && o.args[0].t === 'name' && inSession(o.s))
    .map(o => o.args[0].v))

  const before = { Contents: rawContents, Resources: node.get(N('Resources')) }
  let alive
  try {
    rebuild(root)
    settle(root)

    // One new stream for each stretch of original content; with nothing drawn
    // in this session that is one stream for the page.
    const runs = []
    for (const g of segs) {
      const run = runs[runs.length - 1]
      if (g.session) runs.push(g)
      else if (run && !run.session) run.e = g.e
      else runs.push({ session: false, s: g.s, e: g.e })
      // Only a stream that had words taken out of it is worth reporting if it
      // turns out to be shared with another page.
      retire(g.session ? null : g.ref, root.edits.some(ed => ed.words && ed.s < g.e && ed.e > g.s))
    }
    if (!root.edits.every(ed => runs.some(r => !r.session && ed.s >= r.s && ed.e <= r.e))) {
      throw new Error('a change falls outside the original page content')
    }
    const contents = ctx.obj([])
    for (const r of runs) {
      contents.push(r.session ? r.ref : register(ctx.flateStream(splice(joined, root.edits, r.s, r.e))))
    }
    retire(rawContents, false)

    const resources = root.adds.length || root.drops.length ? ownResources(root) : null
    node.set(N('Contents'), contents)
    if (resources) {
      // Resources inherited from the page tree stay where they are, for the
      // other pages, and so does any replacement text they list.
      if (root.drops.length && before.Resources === undefined) lingering++
      retire(before.Resources, root.drops.length > 0)
      node.set(N('Resources'), resources)
    }
    alive = ctx.trailerInfo.Root ? reachable() : null
  } catch (err) {
    for (const name of ['Contents', 'Resources']) {
      if (before[name] === undefined) node.delete(N(name))
      else node.set(N(name), before[name])
    }
    made.forEach(ref => ctx.delete(ref))
    throw err
  }

  // pdf-lib writes every object it holds, referenced or not. The streams this
  // page has just stopped using still contain the removed words, so they are
  // deleted - unless something else in the document still draws them.
  // Whether something else still draws them is only true as of now: a caller
  // that goes on to scrub the other pages may find the last use gone by the
  // time it saves, so it is told which objects these were.
  let shared = lingering
  const held = []
  for (const [ref, holdsText] of retired) {
    if (alive && !alive.has(ref)) ctx.delete(ref)
    else if (holdsText) { shared++; held.push(ref) }
  }
  return { removed, left, reason, shared, held }
}

/* ---------- public ---------- */

/**
 * Take the glyphs whose centre lies inside any of `rects` out of the page's content, so the
 * words are gone from the file rather than merely painted over. Every glyph that stays keeps
 * its exact position.
 *
 * doc      pdf-lib PDFDocument (loaded from the same bytes pdf.js was given)
 * page     pdf-lib PDFPage to rewrite
 * pdfPage  pdf.js PDFPageProxy of that same page in the ORIGINAL, unmodified file
 * rects    [{ x, y, w, h }] in the page's default user space: PDF points, y grows upwards,
 *          (x, y) is the lower-left corner. NOT affected by /Rotate.
 * pdfjsLib the pdf.js module (for OPS and AnnotationMode)
 *
 * Resolves (never rejects) with
 *   { ok, removed, left, textOps, reason, shared, held }
 *   ok       false when the page could not be processed safely; the page is then left untouched
 *   removed  glyphs taken out
 *   left     glyphs whose centre is inside a rect but that could NOT be removed
 *   textOps  how many text-showing operators pdf.js sees in the page content (forms included)
 *   reason   short human-readable string when ok is false or left > 0
 *   shared   objects this page no longer uses that still hold the removed text because
 *            something else in the document refers to them (a form drawn on other pages)
 *   held     the references of those objects, for a caller that scrubs other pages too and
 *            wants to know at the end whether anything still refers to them. `shared` can be
 *            larger: replacement text listed in resources the page does not own has no
 *            object of its own to name.
 */
export async function scrubPageText({ doc, page, pdfPage, rects, pdfjsLib } = {}) {
  const result = { ok: false, removed: 0, left: 0, textOps: 0, reason: '', shared: 0, held: [] }
  try {
    const seen = await look(pdfPage, pdfjsLib, rects)
    result.textOps = seen.textOps
    if (!seen.hits) return { ...result, ok: true }
    const lib = await import('pdf-lib')
    return { ...result, ok: true, ...rewrite(lib, doc, page, seen) }
  } catch (err) {
    return { ...result, reason: String((err && err.message) || err || 'the page could not be read') }
  }
}

/**
 * How many glyphs have their centre inside `rects`, looking only at the first `limit`
 * text-showing operators of the page (all of them when limit is undefined). Used afterwards to
 * check that a scrub really worked. Resolves with a number; -1 if the page could not be walked.
 */
export async function glyphsInRects({ pdfPage, rects, pdfjsLib, limit } = {}) {
  try {
    return (await look(pdfPage, pdfjsLib, rects, limit == null ? Infinity : limit)).hits
  } catch {
    return -1
  }
}
