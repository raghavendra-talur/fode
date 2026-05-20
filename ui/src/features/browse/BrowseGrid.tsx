import { useMemo, useState } from 'react'
import type { Entity, ReviewStatus } from '../../types'
import KindBadge from '../../components/KindBadge'
import PackageFilter from '../../components/PackageFilter'

interface Props {
  entities: Entity[]
  reviewMap: Map<string, ReviewStatus>
  onSelect: (id: string) => void
}

const KIND_ORDER = ['function', 'method', 'struct', 'interface', 'type', 'const', 'var']
const REVIEW_STATES: (ReviewStatus | 'unreviewed')[] = [
  'unreviewed',
  'todo',
  'reviewed',
  'flagged',
]

export default function BrowseGrid({ entities, reviewMap, onSelect }: Props) {
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set())
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set())
  const [activePkgs, setActivePkgs] = useState<Set<string>>(new Set())

  const kinds = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1
    return KIND_ORDER.filter((k) => counts[k]).map((k) => ({ kind: k, count: counts[k] }))
  }, [entities])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { unreviewed: 0, todo: 0, reviewed: 0, flagged: 0 }
    for (const e of entities) {
      const s = reviewMap.get(e.id) ?? 'unreviewed'
      counts[s] = (counts[s] ?? 0) + 1
    }
    return counts
  }, [entities, reviewMap])

  const packages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entities) counts.set(e.package_dir, (counts.get(e.package_dir) ?? 0) + 1)
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, count]) => ({ dir, count }))
  }, [entities])

  const filtered = useMemo(() => {
    return entities.filter((e) => {
      if (activeKinds.size > 0 && !activeKinds.has(e.kind)) return false
      if (activePkgs.size > 0 && !activePkgs.has(e.package_dir)) return false
      if (activeStatuses.size > 0) {
        const s = reviewMap.get(e.id) ?? 'unreviewed'
        if (!activeStatuses.has(s)) return false
      }
      return true
    })
  }, [entities, activeKinds, activeStatuses, activePkgs, reviewMap])

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, k: string) => {
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setSet(next)
  }

  return (
    <div className="browse">
      <div className="browse-filters">
        <div className="filter-row">
          <span className="filter-label muted">kind</span>
          <div className="filter-chips">
            {kinds.map((k) => (
              <button
                key={k.kind}
                className={`chip ${activeKinds.has(k.kind) ? 'chip-active' : ''}`}
                onClick={() => toggle(activeKinds, setActiveKinds, k.kind)}
              >
                {k.kind} <span className="muted">{k.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label muted">review</span>
          <div className="filter-chips">
            {REVIEW_STATES.map((s) => (
              <button
                key={s}
                className={`chip review-chip review-${s} ${
                  activeStatuses.has(s) ? 'chip-active' : ''
                }`}
                onClick={() => toggle(activeStatuses, setActiveStatuses, s)}
              >
                <span className={`status-dot status-${s}`} /> {s}{' '}
                <span className="muted">{statusCounts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label muted">package</span>
          <PackageFilter
            items={packages}
            active={activePkgs}
            onToggle={(d) => toggle(activePkgs, setActivePkgs, d)}
            onClear={() => setActivePkgs(new Set())}
          />
        </div>

        <div className="browse-count muted">
          {filtered.length} / {entities.length}
        </div>
      </div>

      <ul className="entity-grid">
        {filtered.map((e) => {
          const status = reviewMap.get(e.id)
          return (
            <li key={e.id} className="entity-card" onClick={() => onSelect(e.id)}>
              <div className="entity-card-head">
                <KindBadge kind={e.kind} />
                <span className="entity-name">{e.name}</span>
                {status ? (
                  <span
                    className={`status-dot status-${status}`}
                    title={`review: ${status}`}
                  />
                ) : null}
              </div>
              <code className="entity-signature">{e.signature}</code>
              <div className="entity-footer">
                <code className="muted">{e.package_dir}</code>
                <span className="muted">
                  {e.file.split('/').pop()}:{e.line}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
