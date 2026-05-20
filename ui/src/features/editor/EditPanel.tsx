import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Editor from '@monaco-editor/react'
import { api } from '../../api'

interface Props {
  entityID: string
  source: string
  onApplied: () => void
  onCancel: () => void
}

export default function EditPanel({ entityID, source, onApplied, onCancel }: Props) {
  const qc = useQueryClient()
  const draft = useQuery({
    queryKey: ['edit', entityID],
    queryFn: () => api.getEdit(entityID),
  })

  const [text, setText] = useState<string>(source)

  // Hydrate from server: if a draft already exists, prefer it; otherwise use
  // the entity's current source as the starting point.
  useEffect(() => {
    if (draft.isLoading) return
    setText(draft.data?.draft_source ?? source)
  }, [draft.isLoading, draft.data, source])

  const save = useMutation({
    mutationFn: (next: string) => api.putEdit(entityID, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edit', entityID] }),
  })

  const discard = useMutation({
    mutationFn: () => api.discardEdit(entityID),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edit', entityID] })
      setText(source)
    },
  })

  const apply = useMutation({
    mutationFn: () => api.applyEdit(entityID),
    onSuccess: () => {
      // Apply re-analyzes the whole repo — every entity-bound cache is now
      // potentially stale. Nuke the lot, then bounce back to View.
      qc.invalidateQueries()
      onApplied()
    },
  })

  const savedDraft = draft.data?.draft_source ?? null
  const dirty = text !== (savedDraft ?? source)
  const hasDraft = savedDraft !== null
  const applyError = apply.error ? (apply.error as Error).message : null

  return (
    <section className="edit-panel">
      <header className="edit-toolbar">
        <div className="edit-status">
          {hasDraft ? (
            <span className="muted">
              Draft saved · {dirty ? 'unsaved changes' : 'in sync'}
            </span>
          ) : (
            <span className="muted">
              {dirty ? 'unsaved draft' : 'unchanged'}
            </span>
          )}
        </div>
        <div className="edit-actions">
          <button
            className="btn-secondary"
            onClick={onCancel}
            disabled={apply.isPending}
          >
            Cancel
          </button>
          <button
            className="btn-secondary"
            onClick={() => save.mutate(text)}
            disabled={!dirty || save.isPending || apply.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save draft'}
          </button>
          {hasDraft ? (
            <button
              className="btn-secondary btn-danger"
              onClick={() => discard.mutate()}
              disabled={discard.isPending || apply.isPending}
            >
              Discard
            </button>
          ) : null}
          <button
            className="btn-primary"
            onClick={() => {
              if (dirty) save.mutate(text, { onSuccess: () => apply.mutate() })
              else apply.mutate()
            }}
            disabled={(!hasDraft && !dirty) || apply.isPending}
          >
            {apply.isPending ? 'Applying…' : 'Apply to disk'}
          </button>
        </div>
      </header>

      {applyError ? <p className="error">{applyError}</p> : null}

      <div className="monaco-host">
        <Editor
          height="60vh"
          defaultLanguage="go"
          value={text}
          theme="vs-dark"
          onChange={(v) => setText(v ?? '')}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: false,
          }}
        />
      </div>
    </section>
  )
}
