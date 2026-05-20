import { describe, expect, it } from 'vitest'
import { buildSegments } from './segments'

describe('buildSegments', () => {
  it('returns a single plain segment when there are no refs', () => {
    expect(buildSegments('func foo() {}', [])).toEqual([
      { text: 'func foo() {}', toID: null },
    ])
  })

  it('splits a referenced identifier into a clickable segment', () => {
    const src = 'return helper()'
    const segs = buildSegments(src, [{ start: 7, end: 13, to_id: 'pkg::fn::helper' }])
    expect(segs).toEqual([
      { text: 'return ', toID: null },
      { text: 'helper', toID: 'pkg::fn::helper' },
      { text: '()', toID: null },
    ])
  })

  it('keeps byte offsets correct across multibyte characters', () => {
    // "δ" is two UTF-8 bytes; "x" begins at byte offset 7 (not char index 6).
    const src = 'a δ b x'
    const xByte = new TextEncoder().encode('a δ b ').length
    const segs = buildSegments(src, [
      { start: xByte, end: xByte + 1, to_id: 'pkg::var::x' },
    ])
    const clickable = segs.find((s) => s.toID)
    expect(clickable?.text).toBe('x')
  })

  it('handles unsorted and skips overlapping refs', () => {
    const src = 'ab cd ef'
    const segs = buildSegments(src, [
      { start: 6, end: 8, to_id: 'B' },
      { start: 0, end: 2, to_id: 'A' },
      { start: 1, end: 4, to_id: 'overlap' }, // overlaps A, dropped
    ])
    expect(segs.filter((s) => s.toID).map((s) => s.toID)).toEqual(['A', 'B'])
  })
})
