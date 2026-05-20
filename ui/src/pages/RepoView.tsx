import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReviewStatus } from '../types'
import Search from '../features/search/Search'
import BrowseGrid from '../features/browse/BrowseGrid'
import Focus from '../features/focus/Focus'
import Graph from '../features/graph/Graph'

type ViewMode = 'browse' | 'graph'

export default function RepoView() {
  const { id } = useParams<{ id: string }>()
  const repoID = Number(id)
  const [focusedID, setFocusedID] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('browse')

  const repo = useQuery({
    queryKey: ['repo', repoID],
    queryFn: () => api.getRepo(repoID),
    enabled: Number.isFinite(repoID),
  })
  const entities = useQuery({
    queryKey: ['entities', repoID],
    queryFn: () => api.listEntities(repoID),
    enabled: Number.isFinite(repoID),
  })
  const reviews = useQuery({
    queryKey: ['repo-reviews', repoID],
    queryFn: () => api.listRepoReviews(repoID),
    enabled: Number.isFinite(repoID),
  })

  const reviewMap = useMemo(() => {
    const m = new Map<string, ReviewStatus>()
    reviews.data?.forEach((r) => m.set(r.entity_id, r.status))
    return m
  }, [reviews.data])

  if (repo.isLoading || entities.isLoading) {
    return (
      <main>
        <p className="muted">Loading repository…</p>
      </main>
    )
  }
  if (repo.error || !repo.data) {
    return (
      <main>
        <p className="error">Failed to load repository.</p>
        <Link to="/">← back</Link>
      </main>
    )
  }

  return (
    <main className="repo-view">
      <header className="repo-header">
        <Link to="/" className="back-link">
          ← all repos
        </Link>
        <h1>{repo.data.name}</h1>
        <div className="repo-meta">
          <code>{repo.data.module_name}</code>
          <span className="muted">{repo.data.path}</span>
          <span className="muted">{entities.data?.length ?? 0} entities</span>
        </div>
      </header>

      <Search repoID={repoID} onSelect={setFocusedID} />

      {focusedID ? (
        <Focus
          entityID={focusedID}
          repoID={repoID}
          onSelect={setFocusedID}
          onClose={() => setFocusedID(null)}
        />
      ) : (
        <>
          <div className="view-toggle">
            <button
              className={`view-btn ${view === 'browse' ? 'view-btn-active' : ''}`}
              onClick={() => setView('browse')}
            >
              Browse
            </button>
            <button
              className={`view-btn ${view === 'graph' ? 'view-btn-active' : ''}`}
              onClick={() => setView('graph')}
            >
              Graph
            </button>
          </div>
          {view === 'browse' ? (
            <BrowseGrid
              entities={entities.data ?? []}
              reviewMap={reviewMap}
              onSelect={setFocusedID}
            />
          ) : (
            <Graph repoID={repoID} onSelect={setFocusedID} />
          )}
        </>
      )}
    </main>
  )
}
