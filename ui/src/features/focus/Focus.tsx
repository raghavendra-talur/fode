import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import KindBadge from '../../components/KindBadge'
import ReviewPanel from '../review/ReviewPanel'
import Comments from '../review/Comments'
import EditPanel from '../editor/EditPanel'
import SourceView from './SourceView'
import type { Reference } from '../../types'

interface Props {
  entityID: string
  repoID: number
  onSelect: (id: string) => void
  onClose: () => void
}

export default function Focus({ entityID, repoID, onSelect, onClose }: Props) {
  const focus = useQuery({
    queryKey: ['focus', entityID],
    queryFn: () => api.entityFocus(entityID),
  })

  const [editing, setEditing] = useState(false)
  // If the focused entity changes, drop out of edit mode for safety.
  useEffect(() => {
    setEditing(false)
  }, [entityID])

  if (focus.isLoading) return <p className="muted">Loading entity…</p>
  if (focus.error || !focus.data)
    return <p className="error">{(focus.error as Error)?.message ?? 'Not found'}</p>

  const {
    center,
    callers,
    referenced_by,
    implementations,
    satisfies,
    same_pkg,
    same_module,
    external_deps,
  } = focus.data

  const refGroup = (refs: Reference[]) => (
    <ul>
      {refs.map((ref) => (
        <li key={ref.entity.id}>
          <button className="entity-link" onClick={() => onSelect(ref.entity.id)}>
            <KindBadge kind={ref.entity.kind} />
            <span className="entity-name">{ref.entity.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="focus">
      <button className="back-link" onClick={onClose}>
        ← back to browse
      </button>

      <div className="three-tier">
        <aside className="tier incoming">
          <h3>Callers</h3>
          {callers.length === 0 ? (
            <p className="muted">No callers.</p>
          ) : (
            refGroup(callers)
          )}

          <h3>Referenced by</h3>
          {referenced_by.length === 0 ? (
            <p className="muted">No references.</p>
          ) : (
            refGroup(referenced_by)
          )}

          {implementations.length > 0 ? (
            <>
              <h3>Implementations</h3>
              {refGroup(implementations)}
            </>
          ) : null}
        </aside>

        <section className="tier center">
          <header className="center-head">
            <KindBadge kind={center.kind} />
            <h2>{center.name}</h2>
            <div className="center-head-actions">
              {!editing ? (
                <button
                  className="btn-secondary"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </button>
              ) : null}
            </div>
          </header>
          <div className="center-meta">
            <code>{center.package_dir}</code>
            <span className="muted">
              {center.file}:{center.line}–{center.end_line}
            </span>
          </div>
          {center.doc_comment ? (
            <p className="doc-comment">{center.doc_comment}</p>
          ) : null}

          {editing ? (
            <EditPanel
              entityID={center.id}
              source={center.source}
              onApplied={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <SourceView
              entityID={center.id}
              source={center.source}
              onSelect={onSelect}
            />
          )}

          <ReviewPanel entityID={center.id} repoID={repoID} />
          <Comments entityID={center.id} />
        </section>

        <aside className="tier outgoing">
          {satisfies.length > 0 ? (
            <>
              <h3>Satisfies / implements</h3>
              {refGroup(satisfies)}
            </>
          ) : null}

          <h3>Same package</h3>
          {same_pkg.length === 0 ? (
            <p className="muted">No references in same package.</p>
          ) : (
            <ul>
              {same_pkg.map((e) => (
                <li key={e.id}>
                  <button className="entity-link" onClick={() => onSelect(e.id)}>
                    <KindBadge kind={e.kind} />
                    <code className="entity-signature">{e.signature}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>Other packages in module</h3>
          {same_module.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul>
              {same_module.map((g) => (
                <li key={g.pkg_dir} className="pkg-group">
                  <code>{g.pkg_name}</code>
                  <span className="muted">{g.pkg_dir}</span>
                  <span className="muted">
                    {g.fn_count} fns · {g.type_count} types
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>External</h3>
          {external_deps.length === 0 ? (
            <p className="muted">No external imports.</p>
          ) : (
            <ul>
              {external_deps.map((d) => (
                <li key={d}>
                  <code>{d}</code>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
