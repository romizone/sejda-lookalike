import { describe, expect, it } from 'vitest'
import { makePdf, textOf, textPositions } from './helpers'

describe('test fixtures', () => {
  it('builds a PDF and reads its text back', async () => {
    const pdf = await makePdf((p, f) => p.drawText('HELLO', { x: 100, y: 700, size: 12, font: f }))
    expect(await textOf(pdf)).toContain('HELLO')
    const { pages } = await textPositions(pdf)
    expect(Math.round(pages[0][0].x)).toBe(100)
    expect(Math.round(pages[0][0].y)).toBe(700)
  })
})
