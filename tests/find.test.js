import { describe, expect, it } from 'vitest'
import { matchesIn, replaceLiteral } from '../src/components/FindPanel.jsx'

// String.replace treats "$" in a replacement string as the start of a pattern.
// Find & Replace takes what the user typed, so every one of these has to come
// out exactly as it went in.
describe('replaceLiteral', () => {
  it('keeps "$$" as two dollar signs', () => {
    expect(replaceLiteral('Total 5', '5', 'US$$5')).toBe('Total US$$5')
  })

  it('does not paste the match back in for "$&"', () => {
    expect(replaceLiteral('price 100', '100', 'Rp$&')).toBe('price Rp$&')
  })

  it('leaves the other replacement patterns alone', () => {
    expect(replaceLiteral('a-b-c', 'b', '$1')).toBe('a-$1-c')
    expect(replaceLiteral('a-b-c', 'b', '$`')).toBe('a-$`-c')
    expect(replaceLiteral('a-b-c', 'b', "$'")).toBe("a-$'-c")
    expect(replaceLiteral('a-b-c', 'b', '$<x>')).toBe('a-$<x>-c')
  })

  it('replaces every occurrence, ignoring case unless asked not to', () => {
    expect(replaceLiteral('Cat cat CAT', 'cat', 'dog')).toBe('dog dog dog')
    expect(replaceLiteral('Cat cat CAT', 'cat', 'dog', true)).toBe('Cat dog CAT')
  })

  it('reads the search text literally too', () => {
    expect(replaceLiteral('a.b axb', 'a.b', '-')).toBe('- axb')
    expect(replaceLiteral('cost: $5 (net)', '$5 (net)', '$6')).toBe('cost: $6')
  })

  it('can replace with nothing, and does nothing without a search text', () => {
    expect(replaceLiteral('one two', ' two', '')).toBe('one')
    expect(replaceLiteral('one two', '', 'x')).toBe('one two')
    expect(replaceLiteral(undefined, 'a', 'b')).toBe('')
  })
})

describe('matchesIn', () => {
  const pages = {
    0: {
      lines: [
        { id: 'a', text: 'Invoice total: $5' },
        { id: 'b', text: 'invoice gone', deleted: true }
      ],
      objects: [
        { id: 'o1', kind: 'text', text: 'INVOICE invoice' },
        { id: 'o2', kind: 'rect' }
      ]
    },
    bX: { lines: [{ id: 'c', text: 'second invoice' }], objects: [] }
  }
  // The blank page sits first, so its position and its key disagree.
  const order = [{ key: 'bX', src: null }, { key: 0, src: 0 }]

  it('walks the pages in display order and skips deleted lines', () => {
    const hits = matchesIn(pages, order, 'invoice', false)
    expect(hits.map(h => [h.pos, h.page, h.id, h.index])).toEqual([
      [0, 'bX', 'c', 7],
      [1, 0, 'a', 0],
      [1, 0, 'o1', 0],
      [1, 0, 'o1', 8]
    ])
    expect(hits.filter(h => h.kind === 'obj').map(h => h.id)).toEqual(['o1', 'o1'])
  })

  it('honours match case and literal punctuation', () => {
    expect(matchesIn(pages, order, 'invoice', true).map(h => h.id)).toEqual(['c', 'o1'])
    expect(matchesIn(pages, order, '$5', false).map(h => h.id)).toEqual(['a'])
    expect(matchesIn(pages, order, '', false)).toEqual([])
  })
})
