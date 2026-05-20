import type {
  ApplyResult,
  Comment,
  DeadCodeReport,
  Edit,
  Entity,
  FocusView,
  GraphData,
  Ref,
  Repo,
  RepoSummary,
  Review,
  ReviewStatus,
  SearchResult,
} from './types'

async function req<T>(url: string, method: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const r = await fetch(url, init)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${url}: ${r.status} ${text}`)
  }
  if (r.status === 204) return undefined as T
  return r.json() as Promise<T>
}

const get = <T>(url: string) => req<T>(url, 'GET')
const post = <T>(url: string, body: unknown) => req<T>(url, 'POST', body)
const put = <T>(url: string, body: unknown) => req<T>(url, 'PUT', body)
const del = (url: string) => req<void>(url, 'DELETE')

const entityQS = (id: string) => `id=${encodeURIComponent(id)}`

export const api = {
  // repos & entities
  listRepos: () => get<RepoSummary[]>('/api/repos'),
  createRepo: (path: string) => post<Repo>('/api/repos', { path }),
  getRepo: (id: number) => get<Repo>(`/api/repos/${id}`),
  listEntities: (id: number) => get<Entity[]>(`/api/repos/${id}/entities`),
  search: (id: number, q: string) =>
    get<SearchResult[]>(`/api/repos/${id}/search?q=${encodeURIComponent(q)}`),
  repoGraph: (id: number) => get<GraphData>(`/api/repos/${id}/graph`),
  getEntity: (id: string) => get<Entity>(`/api/entities?${entityQS(id)}`),
  entityFocus: (id: string) => get<FocusView>(`/api/entities/focus?${entityQS(id)}`),
  entityRefs: (id: string) => get<Ref[]>(`/api/entities/refs?${entityQS(id)}`),
  deadCode: (id: number) => get<DeadCodeReport>(`/api/repos/${id}/deadcode`),

  // reviews
  getReview: (id: string) =>
    get<Review | null>(`/api/entities/review?${entityQS(id)}`),
  putReview: (id: string, body: { status: ReviewStatus; notes: string }) =>
    put<Review>(`/api/entities/review?${entityQS(id)}`, body),
  deleteReview: (id: string) =>
    del(`/api/entities/review?${entityQS(id)}`),
  listRepoReviews: (repoID: number) =>
    get<Review[]>(`/api/repos/${repoID}/reviews`),

  // comments
  listComments: (id: string) =>
    get<Comment[]>(`/api/entities/comments?${entityQS(id)}`),
  addComment: (id: string, body: string) =>
    post<Comment>(`/api/entities/comments?${entityQS(id)}`, { body }),
  deleteComment: (cid: number) => del(`/api/comments/${cid}`),

  // edits
  getEdit: (id: string) =>
    get<Edit | null>(`/api/entities/edit?${entityQS(id)}`),
  putEdit: (id: string, draftSource: string) =>
    put<Edit>(`/api/entities/edit?${entityQS(id)}`, {
      draft_source: draftSource,
    }),
  discardEdit: (id: string) => del(`/api/entities/edit?${entityQS(id)}`),
  applyEdit: (id: string) =>
    post<ApplyResult>(`/api/entities/edit/apply?${entityQS(id)}`, {}),
}
