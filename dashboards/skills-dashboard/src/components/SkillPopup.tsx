import { useEffect, useMemo, useRef, useState } from 'react'
import type { HarnessId, InstallDetail } from '../types.ts'
import type { VisibleRow } from '../App.tsx'
import { FileTree } from './FileTree.tsx'
import { FileViewer } from './FileViewer.tsx'

interface Props {
  row: VisibleRow
  live: boolean
  onClose: () => void
}

const HARNESS_LABELS: Record<HarnessId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok Build',
  hermes: 'Hermes',
  'claude-desktop': 'Claude Desktop',
  'chatgpt-desktop': 'ChatGPT Desktop',
}

interface InstallTab {
  harness: HarnessId
  detail: InstallDetail
}

export function SkillPopup({ row, live, onClose }: Props) {
  // One tab per install across harnesses; most recently updated first (and default).
  const tabs = useMemo<InstallTab[]>(
    () =>
      (Object.entries(row.visibleInstalls) as [HarnessId, InstallDetail[]][])
        .flatMap(([harness, details]) => details.map((detail) => ({ harness, detail })))
        .sort((a, b) => b.detail.mtimeMs - a.detail.mtimeMs),
    [row],
  )
  const [activeTab, setActiveTab] = useState(0)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // Document-level so Esc works even when focus fell back to <body>
  // (e.g. after the ← Back button unmounts).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Minimal focus trap: keep Tab cycling inside the panel.
    if (e.key === 'Tab' && panelRef.current) {
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const tab = tabs[Math.min(activeTab, tabs.length - 1)]

  return (
    <div className="popup-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="popup-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Files for ${row.displayName}`}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="popup-header">
          {openFile ? (
            <button type="button" className="popup-back" onClick={() => setOpenFile(null)}>
              ← Back
            </button>
          ) : (
            <span className="popup-title">{row.displayName}</span>
          )}
          <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {!live ? (
          <p className="popup-note">
            File browsing needs the live local server — this is a static snapshot.
          </p>
        ) : (
          <>
            {!openFile && tabs.length > 1 && (
              <div className="popup-tabs" role="tablist">
                {tabs.map((t, i) => (
                  <button
                    key={`${t.harness}:${t.detail.sourcePath}`}
                    type="button"
                    role="tab"
                    aria-selected={i === activeTab}
                    className={i === activeTab ? 'active' : ''}
                    onClick={() => {
                      setActiveTab(i)
                      setOpenFile(null)
                    }}
                  >
                    {HARNESS_LABELS[t.harness]}
                    {t.detail.source !== 'personal' && (
                      <span className="tab-source"> · {t.detail.source}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="popup-body">
              {openFile ? (
                <FileViewer key={openFile} path={openFile} />
              ) : tab ? (
                <FileTree key={tab.detail.dirPath} dirPath={tab.detail.dirPath} onOpenFile={setOpenFile} />
              ) : (
                <p className="popup-note">No installs to browse.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
