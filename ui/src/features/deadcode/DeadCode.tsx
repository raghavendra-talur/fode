import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import KindBadge from '../../components/KindBadge'
import type { Entity } from '../../types'

interface Props {
  repoID: number
  onSelect: (id: string) => void
}

export default function DeadCode({ repoID, onSelect }: Props) {
  const report = useQuery({
    queryKey: ['deadcode', repoID],
    queryFn: () => api.deadCode(repoID),
  })

  if (report.isLoading) return <p className="muted">Scanning for dead code…</p>
  if (report.error || !report.data)
    return <p className="error">{(report.error as Error)?.message ?? 'Failed'}</p>

  const { dead, exported_unused } = report.data

  const list = (entities: Entity[]) => (
    <ul className="deadcode-list">
      {entities.map((e) => (
        <li key={e.id}>
          <button className="entity-link" onClick={() => onSelect(e.id)}>
            <KindBadge kind={e.kind} />
            <span className="entity-name">{e.name}</span>
            <span className="muted">
              {e.file}:{e.line}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="deadcode">
      <section>
        <h3>
          Dead code <span className="muted">unexported, no references ({dead.length})</span>
        </h3>
        {dead.length === 0 ? (
          <p className="muted">None found.</p>
        ) : (
          list(dead)
        )}
      </section>

      <section>
        <h3>
          Exported &amp; unused{' '}
          <span className="muted">possible public API ({exported_unused.length})</span>
        </h3>
        {exported_unused.length === 0 ? (
          <p className="muted">None found.</p>
        ) : (
          list(exported_unused)
        )}
      </section>
    </div>
  )
}
