import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { buildSegments } from './segments'

interface Props {
  entityID: string
  source: string
  onSelect: (id: string) => void
}

export default function SourceView({ entityID, source, onSelect }: Props) {
  const refs = useQuery({
    queryKey: ['refs', entityID],
    queryFn: () => api.entityRefs(entityID),
  })

  const segments = useMemo(
    () => buildSegments(source, refs.data ?? []),
    [source, refs.data],
  )

  return (
    <pre className="source">
      {segments.map((seg, i) =>
        seg.toID ? (
          <button
            key={i}
            type="button"
            className="src-ref"
            title="Go to definition"
            onClick={() => onSelect(seg.toID as string)}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </pre>
  )
}
