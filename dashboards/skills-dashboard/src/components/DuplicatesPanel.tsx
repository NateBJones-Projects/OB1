import { useEffect, useRef, useState } from 'react'
import { deleteInstall, runDedup } from '../api.ts'
import type { DuplicateGroup, HarnessId } from '../types.ts'

interface Props {
  groups: DuplicateGroup[]
  live: boolean
  llmAvailable: boolean
  onClose: () => void
  /** Ask App to refetch so verdicts land in the main payload too. */
  onJudged: () => void
}

const HARNESS_LABELS: Record<HarnessId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  hermes: 'Hermes',
  'claude-desktop': 'Claude Desktop',
  'chatgpt-desktop': 'ChatGPT Desktop',
}

const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function VerdictBadge({ verdict }: { verdict: DuplicateGroup['verdict'] }) {
  if (!verdict) return null
  return <span className={`verdict-badge verdict-${verdict.verdict}`}>{verdict.verdict}</span>
}

export function DuplicatesPanel({ groups: initial, live, llmAvailable, onClose, onJudged }: Props) {
  const [groups, setGroups] = useState(initial)
  const [judging, setJudging] = useState<string | 'all' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  const pending = groups.filter((g) => !g.identical && !g.verdict)

  const judge = async (groupId?: string) => {
    setJudging(groupId ?? 'all')
    setNote(null)
    try {
      const result = await runDedup(groupId)
      setGroups(result.groups)
      setNote(`judged ${result.judged} group${result.judged === 1 ? '' : 's'}`)
      onJudged()
    } catch (err) {
      setNote(`judgment failed: ${(err as Error).message}`)
    } finally {
      setJudging(null)
    }
  }

  const remove = async (dirPath: string) => {
    setDeleting(dirPath)
    setNote(null)
    try {
      const result = await deleteInstall(dirPath)
      setGroups(result.duplicates)
      setNote(`moved to Trash: ${result.trashedTo}`)
      onJudged()
    } catch (err) {
      setNote(`delete failed: ${(err as Error).message}`)
    } finally {
      setDeleting(null)
      setConfirmPath(null)
    }
  }

  return (
    <div className="popup-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="popup-panel duplicates-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate skills"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="popup-header">
          <span className="popup-title">Duplicate skills ({groups.length})</span>
          <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dedup-toolbar">
          <span className="dedup-summary">
            {groups.filter((g) => g.identical).length} identical ·{' '}
            {groups.filter((g) => !g.identical && g.verdict).length} judged · {pending.length}{' '}
            pending
          </span>
          {live && llmAvailable && pending.length > 0 && (
            <button type="button" onClick={() => judge()} disabled={judging !== null}>
              {judging === 'all' ? 'Judging…' : `Dedup ${pending.length} with OpenRouter`}
            </button>
          )}
          {!live && <span className="dedup-note">snapshot mode — judgment needs the live server</span>}
          {live && !llmAvailable && (
            <span className="dedup-note">set OPENROUTER_API_KEY in .env to enable judgment</span>
          )}
          {note && <span className="dedup-note">{note}</span>}
        </div>
        <div className="popup-body">
          {groups.length === 0 && <p className="popup-note">No duplicate installs found.</p>}
          <ul className="dedup-list">
            {groups.map((g) => (
              <li key={g.id} className="dedup-group">
                <div className="dedup-head">
                  <span className="dedup-skill">{g.displayName}</span>
                  <span className="dedup-harness">{HARNESS_LABELS[g.harness]}</span>
                  {g.identical ? (
                    <span className="chip chip-identical">identical copies</span>
                  ) : (
                    <span className="chip chip-differs">content differs</span>
                  )}
                  <VerdictBadge verdict={g.verdict} />
                  {live && llmAvailable && !g.identical && !g.verdict && (
                    <button
                      type="button"
                      className="dedup-judge"
                      onClick={() => judge(g.id)}
                      disabled={judging !== null}
                    >
                      {judging === g.id ? 'Judging…' : 'Judge'}
                    </button>
                  )}
                </div>
                <ul className="dedup-installs">
                  {g.installs.map((d) => (
                    <li key={d.sourcePath}>
                      <span className="install-source">{d.source}</span>
                      <span className="install-date">{fmtDate(d.mtimeMs)}</span>
                      <span className="install-path">{d.sourcePath}</span>
                      {live &&
                        (confirmPath === d.dirPath ? (
                          <span className="delete-confirm">
                            <button
                              type="button"
                              className="delete-yes"
                              onClick={() => remove(d.dirPath)}
                              disabled={deleting !== null}
                            >
                              {deleting === d.dirPath ? 'Moving to Trash…' : 'Confirm delete'}
                            </button>
                            <button
                              type="button"
                              className="delete-no"
                              onClick={() => setConfirmPath(null)}
                              disabled={deleting !== null}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="delete-button"
                            title="Move this copy to the Trash"
                            onClick={() => setConfirmPath(d.dirPath)}
                            disabled={deleting !== null}
                          >
                            Delete
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
                {g.verdict && (
                  <p className="dedup-verdict-text">
                    {g.verdict.reasoning} <strong>{g.verdict.recommendation}</strong>
                    <span className="dedup-judged-by"> — {g.verdict.judgedBy}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
