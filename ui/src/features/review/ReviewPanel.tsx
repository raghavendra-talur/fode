import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import type { ReviewStatus } from '../../types'

const STATUSES: ReviewStatus[] = ['todo', 'reviewed', 'flagged']

interface Props {
  entityID: string
  repoID: number
}

export default function ReviewPanel({ entityID, repoID }: Props) {
  const qc = useQueryClient()
  const review = useQuery({
    queryKey: ['review', entityID],
    queryFn: () => api.getReview(entityID),
  })

  const savedStatus = review.data?.status ?? null
  const savedNotes = review.data?.notes ?? ''
  const [notes, setNotes] = useState(savedNotes)

  useEffect(() => {
    setNotes(savedNotes)
  }, [savedNotes])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['review', entityID] })
    qc.invalidateQueries({ queryKey: ['repo-reviews', repoID] })
  }

  const upsert = useMutation({
    mutationFn: (body: { status: ReviewStatus; notes: string }) =>
      api.putReview(entityID, body),
    onSuccess: invalidate,
  })
  const clear = useMutation({
    mutationFn: () => api.deleteReview(entityID),
    onSuccess: invalidate,
  })

  const setStatus = (s: ReviewStatus) => upsert.mutate({ status: s, notes })
  const commitNotes = () => {
    if (notes === savedNotes) return
    upsert.mutate({ status: savedStatus ?? 'todo', notes })
  }

  return (
    <section className="review-panel">
      <h3>Review</h3>
      <div className="status-row">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`status-chip status-${s} ${
              savedStatus === s ? 'status-chip-active' : ''
            }`}
            onClick={() => setStatus(s)}
            disabled={upsert.isPending}
          >
            {s}
          </button>
        ))}
        {savedStatus !== null ? (
          <button
            className="status-clear"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            clear
          </button>
        ) : null}
      </div>
      <textarea
        className="review-notes"
        placeholder="Notes — saves on blur"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        rows={3}
      />
    </section>
  )
}
