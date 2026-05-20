import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import KindBadge from '../../components/KindBadge'

interface Props {
  repoID: number
  onSelect: (id: string) => void
}

export default function Search({ repoID, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const wrapper = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const results = useQuery({
    queryKey: ['search', repoID, debounced],
    queryFn: () => api.search(repoID, debounced),
    enabled: debounced.length > 0,
  })

  return (
    <div className="search" ref={wrapper}>
      <input
        type="text"
        placeholder="Search entities — functions, methods, types…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        spellCheck={false}
      />
      {open && debounced && results.data && results.data.length > 0 ? (
        <ul className="search-results">
          {results.data.map((r) => (
            <li
              key={r.entity.id}
              onClick={() => {
                onSelect(r.entity.id)
                setQ('')
                setOpen(false)
              }}
            >
              <KindBadge kind={r.entity.kind} />
              <span className="entity-name">{r.entity.name}</span>
              <code className="muted">{r.entity.package_dir}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
