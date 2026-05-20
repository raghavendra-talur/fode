import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export default function Landing() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['repos'], queryFn: api.listRepos })
  const [path, setPath] = useState('')

  const analyze = useMutation({
    mutationFn: (p: string) => api.createRepo(p),
    onSuccess: (repo) => {
      qc.invalidateQueries({ queryKey: ['repos'] })
      nav(`/repos/${repo.id}`)
    },
  })

  return (
    <main className="landing">
      <header className="landing-hero">
        <h1>fode</h1>
        <p className="tagline">entity-level code editor &amp; reviewer for Go</p>
      </header>

      <section className="card">
        <h2>Analyze a repository</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = path.trim()
            if (trimmed) analyze.mutate(trimmed)
          }}
        >
          <input
            type="text"
            placeholder="/absolute/path/to/your/go/module"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <button type="submit" disabled={analyze.isPending || !path.trim()}>
            {analyze.isPending ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>
        {analyze.error ? (
          <p className="error">{(analyze.error as Error).message}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Recent</h2>
        {repos.isLoading ? <p className="muted">Loading…</p> : null}
        {repos.data && repos.data.length === 0 ? (
          <p className="muted">No repositories analyzed yet.</p>
        ) : null}
        <ul className="repo-list">
          {repos.data?.map((r) => (
            <li key={r.id}>
              <Link to={`/repos/${r.id}`} className="repo-row">
                <span className="repo-name">{r.name}</span>
                <code className="repo-path">{r.path}</code>
                <span className="muted">
                  {r.entity_count} entities · {r.relation_count} relations
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
