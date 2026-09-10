"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Adds a new section via the same PUT route the editor uses — the write guard
// treats a first write to a new section_key as a create.
export function AddSectionForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sectionKey, setSectionKey] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSectionKey("");
    setHeading("");
    setBody("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const key = sectionKey.trim();
    if (!key) {
      setError("Enter a section key.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/wiki/pages/${encodeURIComponent(slug)}/sections/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body_md: body,
            heading: heading.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to add section");
      }
      reset();
      setOpen(false);
      router.refresh();
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
        className="text-sm text-text-muted hover:text-violet transition-colors"
      >
        + Add section
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bg-surface border border-border rounded-lg p-4 space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="section_key" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Section key
          </label>
          <input
            id="section_key"
            value={sectionKey}
            onChange={(e) => setSectionKey(e.target.value)}
            placeholder="overview"
            className="w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition font-mono"
          />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="section_heading" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
            Heading
          </label>
          <input
            id="section_heading"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            placeholder="Overview (optional)"
            className="w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
          />
        </div>
      </div>
      <div>
        <label htmlFor="section_body" className="block text-text-muted text-xs uppercase tracking-wider mb-1">
          Body (markdown)
        </label>
        <textarea
          id="section_body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Write the section in markdown…"
          className="w-full px-3 py-2 bg-bg-elevated border border-border rounded text-text-primary text-sm font-mono placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
        />
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Adding…" : "Add section"}
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
