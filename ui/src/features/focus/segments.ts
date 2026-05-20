import type { Ref } from '../../types'

export interface Segment {
  text: string
  toID: string | null
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// buildSegments splits the source into plain and clickable runs. Ref offsets
// are byte offsets relative to the entity source, so we work on the encoded
// byte array and decode each slice — this stays correct for multibyte source.
export function buildSegments(source: string, refs: Ref[]): Segment[] {
  if (refs.length === 0) return [{ text: source, toID: null }]

  const bytes = encoder.encode(source)
  const sorted = [...refs].sort((a, b) => a.start - b.start)
  const segments: Segment[] = []
  let cursor = 0

  for (const ref of sorted) {
    // Skip malformed or overlapping refs.
    if (ref.start < cursor || ref.end > bytes.length || ref.start >= ref.end) {
      continue
    }
    if (ref.start > cursor) {
      segments.push({ text: decoder.decode(bytes.slice(cursor, ref.start)), toID: null })
    }
    segments.push({
      text: decoder.decode(bytes.slice(ref.start, ref.end)),
      toID: ref.to_id,
    })
    cursor = ref.end
  }
  if (cursor < bytes.length) {
    segments.push({ text: decoder.decode(bytes.slice(cursor)), toID: null })
  }
  return segments
}
