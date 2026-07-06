"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WikiPageKind } from "@/lib/types";

const PAGE_KINDS: WikiPageKind[] = ["topic", "entity", "autobiography", "custom"];

// Turn a title into a reasonable default slug: lowercase, spaces→hyphens, drop
// anything that isn't a word char or hyphen. The user can still override it.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function NewPageForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [kind, setKind] = useState<WikiPageKind>("topic");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(title);

  function reset() {
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setKind("topic");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const finalSlug = (slugEdited ? slug : slugify(title)).trim();
    const finalTitle = title.trim();
    if (!finalTitle) {
      setError("Enter a title.");
      return;
    }
    if (!finalSlug) {
      setError("Enter a slug.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/wiki/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: finalSlug, title: finalTitle, page_kind: kind }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to create page");
      }
      reset();
      setOpen(false);
      // The list re-reads server-side; then jump to the new page.
      router.refresh();
      router.push(`/wiki/${encodeURIComponent(finalSlug)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors whitespace-nowrap"
      >
        New page
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bg-surface border border-border rounded-lg p-4 space-y-3 w-full"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="wiki_title" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Title
          </label>
          <input
            id="wiki_title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Vector search"
            className="w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="wiki_slug" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Slug
          </label>
          <input
            id="wiki_slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
            placeholder="vector-search"
            className="w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition font-mono"
          />
        </div>
        <div>
          <label htmlFor="wiki_kind" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Kind
          </label>
          <select
            id="wiki_kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as WikiPageKind)}
            className="px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm capitalize focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          >
            {PAGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Creating…" : "Create page"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
