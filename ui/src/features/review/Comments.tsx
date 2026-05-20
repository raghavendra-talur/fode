import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'

export default function Comments({ entityID }: { entityID: string }) {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['comments', entityID],
    queryFn: () => api.listComments(entityID),
  })
  const [body, setBody] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['comments', entityID] })

  const add = useMutation({
    mutationFn: (text: string) => api.addComment(entityID, text),
    onSuccess: () => {
      setBody('')
      invalidate()
    },
  })
  const del = useMutation({
    mutationFn: (id: number) => api.deleteComment(id),
    onSuccess: invalidate,
  })

  return (
    <section className="comments">
      <h3>Comments</h3>
      {(list.data?.length ?? 0) === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {list.data?.map((c) => (
            <li key={c.id} className="comment-item">
              <p className="comment-body">{c.body}</p>
              <span className="comment-meta">
                {new Date(c.created_at * 1000).toLocaleString()}
              </span>
              <button
                className="comment-delete"
                onClick={() => del.mutate(c.id)}
                title="Delete comment"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault()
          const t = body.trim()
          if (t) add.mutate(t)
        }}
      >
        <input
          type="text"
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="submit" disabled={!body.trim() || add.isPending}>
          Add
        </button>
      </form>
    </section>
  )
}
