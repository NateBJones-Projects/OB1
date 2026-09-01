"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MarkdownBody } from "@/components/MarkdownBody";
import { FormattedDate } from "@/components/FormattedDate";
import type { WikiSection } from "@/lib/types";

// Matches /thoughts/[id]'s own id guard — only ids shaped like this are
// linkable there, so only ids shaped like this get a link here.
const LINKABLE_THOUGHT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An origin chip that reads the ownership at a glance: a manual section is "yours"
// (violet), a generated section is machine-owned (neutral). A lock badge rides
// alongside when the section is locked.
function OriginChip({ origin, locked }: { origin: string; locked: boolean }) {
  const isManual = origin === "manual";
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
          isManual
            ? "border-violet/30 bg-violet-surface text-violet"
            : "border-border bg-bg-elevated text-text-muted"
        }`}
        title={
          isManual
            ? "Owned by you — machine writers can only propose pending drafts here."
            : "Machine-owned — regenerators may overwrite this section freely."
        }
      >
        {isManual ? "yours" : "generated"}
      </span>
      {locked && (
        <span
          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-amber/30 bg-amber/10 text-amber"
          title="Locked — writes are blocked until unlocked."
        >
          🔒 locked
        </span>
      )}
    </span>
  );
}

// Display-integrity guard for agent-controlled strings rendered beside the
// Accept/Reject decision: strip control characters and bidi-override marks
// (LRM/RLM, embeddings/overrides, isolates — which could visually reorder or
// hide neighboring text), trim, and cap at 80 code points.
const UNSAFE_DISPLAY_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function sanitizeLabel(input: string): string {
  const cleaned = input.replace(UNSAFE_DISPLAY_CHARS, "").trim();
  return Array.from(cleaned).slice(0, 80).join("");
}

// A short human summary of where a pending draft came from. generation_source is
// free-form jsonb written by agents, so every string is sanitized before display;
// we surface the common {model, thought_count} shape and fall back gracefully.
function generationSummary(source: Record<string, unknown>): string | null {
  if (!source || typeof source !== "object") return null;
  const parts: string[] = [];
  const model = source.model ?? source.model_name;
  if (typeof model === "string") {
    const label = sanitizeLabel(model);
    if (label) parts.push(label);
  }
  const count = source.thought_count ?? source.thoughts ?? source.evidence_count;
  if (typeof count === "number") parts.push(`${count} ${count === 1 ? "thought" : "thoughts"}`);
  const src = source.source ?? source.generator;
  if (parts.length === 0 && typeof src === "string") {
    const label = sanitizeLabel(src);
    if (label) parts.push(label);
  }
  return parts.length ? parts.join(" · ") : null;
}

// Note: sections stay fully interactive on ARCHIVED pages too. The gateway
// deliberately allows section writes regardless of page status (parity with
// wiki_write_section, which has no page-status check), and freezing the UI
// would create a one-way door — frozen pending drafts and unlockable locks
// with no unarchive route.
export function WikiSectionPanel({
  slug,
  section,
}: {
  slug: string;
  section: WikiSection;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body_md);
  const [showEvidence, setShowEvidence] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "lock" | "accept" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  // Informational (non-error) outcome, e.g. a draft that was already resolved
  // in another tab or by another agent before this click landed.
  const [notice, setNotice] = useState<string | null>(null);

  const heading = section.heading || section.section_key;
  const hasPending = section.pending_generated_md !== null && section.pending_generated_md !== undefined;
  const evidenceIds = section.evidence_thought_ids || [];
  const genSummary = generationSummary(section.generation_source);

  // Runs a mutation and returns the parsed response body (null on failure) so
  // callers can branch on the gateway's `action` result.
  async function call(
    url: string,
    init: RequestInit,
    tag: typeof busy
  ): Promise<Record<string, unknown> | null> {
    setBusy(tag);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Request failed");
      }
      router.refresh();
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    const ok = await call(
      `/api/wiki/pages/${encodeURIComponent(slug)}/sections/${encodeURIComponent(section.section_key)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_md: draft }),
      },
      "save"
    );
    if (ok) setEditing(false);
  }

  async function handleLockToggle() {
    await call(
      `/api/wiki/sections/${encodeURIComponent(section.id)}/lock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: !section.locked }),
      },
      "lock"
    );
  }

  // Accept/Reject race: another tab or agent may resolve the draft first. The
  // gateway answers action:'no_pending' for the loser — surface that as a
  // distinct notice (the refresh already pulled the resolved state) instead of
  // pretending this click decided it. Mirrors ContactProposals' already-decided UX.
  async function handleAccept() {
    const result = await call(
      `/api/wiki/sections/${encodeURIComponent(section.id)}/accept-pending`,
      { method: "POST" },
      "accept"
    );
    if (result && result.action === "no_pending") {
      setNotice("This draft was already resolved elsewhere — refreshed.");
    }
  }

  async function handleReject() {
    const result = await call(
      `/api/wiki/sections/${encodeURIComponent(section.id)}/reject-pending`,
      { method: "POST" },
      "reject"
    );
    if (result && result.action === "no_pending") {
      setNotice("This draft was already resolved elsewhere — refreshed.");
    }
  }

  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary break-words">{heading}</h2>
          {section.heading && (
            <span className="text-text-muted text-xs font-mono">{section.section_key}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <OriginChip origin={section.origin} locked={section.locked} />
          {evidenceIds.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-bg-elevated text-text-muted hover:text-violet hover:border-violet/30 transition-colors"
              title="Supporting thoughts for this section"
            >
              {evidenceIds.length} {evidenceIds.length === 1 ? "source" : "sources"}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(section.body_md);
                setEditing(true);
                setError(null);
              }}
              className="text-xs text-text-muted hover:text-violet transition-colors"
              title="Edit this section (your edit takes ownership)"
            >
              Edit
            </button>
          )}
          {!editing && (
            <button
              type="button"
              onClick={handleLockToggle}
              disabled={busy === "lock"}
              className="text-xs text-text-muted hover:text-violet transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                section.locked
                  ? "Unlock so this section can be edited or written by agents"
                  : "Lock to block all writes until unlocked"
              }
            >
              {busy === "lock" ? "…" : section.locked ? "Unlock" : "Lock"}
            </button>
          )}
        </div>
      </div>

      {/* Action feedback strips (mirrors EditableFactPanel's lock-error strip).
          The editor renders its own inline error, so the strip hides while editing. */}
      {error && !editing && (
        <div className="px-4 py-2 border-b border-border bg-bg-elevated">
          <p className="text-danger text-xs">{error}</p>
        </div>
      )}
      {notice && (
        <div className="px-4 py-2 border-b border-border bg-bg-elevated">
          <p className="text-info text-xs">{notice}</p>
        </div>
      )}

      {/* Evidence list (expanded) */}
      {showEvidence && evidenceIds.length > 0 && (
        <div className="px-4 py-3 border-b border-border bg-bg-elevated/50">
          <p className="text-text-muted text-xs uppercase tracking-wider mb-1.5">Sources</p>
          <ul className="flex flex-wrap gap-1.5">
            {evidenceIds.map((tid) =>
              LINKABLE_THOUGHT_ID_RE.test(tid) ? (
                <li key={tid}>
                  <Link
                    href={`/thoughts/${tid}`}
                    title={tid}
                    className="text-xs px-2 py-0.5 rounded bg-bg-surface border border-border text-text-secondary font-mono hover:text-violet hover:border-violet/30 transition-colors"
                  >
                    {tid.slice(0, 8)}…
                  </Link>
                </li>
              ) : (
                <li key={tid}>
                  {/* Defensive fallback — non-UUID ids (e.g. legacy numeric
                      ids) render inert rather than linking to a route that
                      only resolves UUID-shaped ids. Full id on hover. */}
                  <span
                    title={tid}
                    className="text-xs px-2 py-0.5 rounded bg-bg-surface border border-border text-text-secondary font-mono cursor-default"
                  >
                    {tid.slice(0, 8)}…
                  </span>
                </li>
              )
            )}
          </ul>
        </div>
      )}

      {/* Pending-draft review panel — the heart. Sits ABOVE the body. */}
      {hasPending && (
        <div className="px-4 py-3 border-b border-amber/30 bg-amber/5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-amber text-sm font-semibold">Machine update awaiting review</p>
              <p className="text-text-muted text-xs mt-0.5">
                {section.pending_generated_at && (
                  <>
                    Proposed <FormattedDate date={section.pending_generated_at} />
                  </>
                )}
                {genSummary && (
                  <>
                    {section.pending_generated_at ? " · " : ""}
                    {genSummary}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleAccept}
                disabled={busy === "accept" || busy === "reject"}
                className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === "accept" ? "…" : "Accept"}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={busy === "accept" || busy === "reject"}
                className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === "reject" ? "…" : "Reject"}
              </button>
            </div>
          </div>

          {/* Stacked diff: current body (dimmed) vs proposed draft (highlighted). */}
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border border-border bg-bg-surface/60 p-3 opacity-70">
              <p className="text-text-muted text-[11px] uppercase tracking-wider mb-1.5">Current</p>
              <MarkdownBody>{section.body_md}</MarkdownBody>
            </div>
            <div className="rounded border border-amber/30 bg-amber/5 p-3">
              <p className="text-amber text-[11px] uppercase tracking-wider mb-1.5">Proposed draft</p>
              <MarkdownBody>{section.pending_generated_md || ""}</MarkdownBody>
            </div>
          </div>
        </div>
      )}

      {/* Body / editor */}
      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
            />
            <p className="text-text-muted text-xs">
              Saving takes ownership of this section (origin becomes &ldquo;yours&rdquo;). Markdown is rendered
              sanitized — raw HTML is shown as text, never executed.
            </p>
            {error && <p className="text-danger text-xs">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy === "save"}
                className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <MarkdownBody>{section.body_md}</MarkdownBody>
        )}
      </div>
    </section>
  );
}
