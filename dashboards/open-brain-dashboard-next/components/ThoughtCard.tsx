import Link from "next/link";
import type { Thought } from "@/lib/types";
import { FormattedDate } from "@/components/FormattedDate";

const typeLabels: Record<string, string> = {
  observation: "Note",
  task: "Task",
  idea: "Idea",
  reference: "Reference",
  person_note: "Contact note",
  decision: "Decision",
  lesson: "Lesson",
  meeting: "Meeting",
  journal: "Journal",
};

const typeColors: Record<string, string> = {
  observation: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800/40 dark:text-stone-400 dark:border-stone-700",
  idea: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  task: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  person_note: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
  reference: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
  decision: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800",
  lesson: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  meeting: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-800",
  journal: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400 dark:border-pink-800",
};

export function TypeBadge({ type }: { type: string }) {
  const colors = typeColors[type] || typeColors.reference;
  const label = typeLabels[type] || type;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${colors}`}>
      {label}
    </span>
  );
}

function extractSubject(content: string): string | null {
  const match = content.match(/Subject:\s*([^|]+)/);
  if (match) return match[1].trim();
  const docMatch = content.match(/\[Document:\s*([^\]—]+)/);
  if (docMatch) return docMatch[1].trim();
  return null;
}

export function ThoughtCard({
  thought,
  showLink = true,
}: {
  thought: Thought;
  showLink?: boolean;
}) {
  const subject = extractSubject(thought.content);
  const preview = thought.content.length > 180
    ? thought.content.slice(0, 180) + "..."
    : thought.content;

  const source = thought.source_type;
  const sourceLabel = source === "outlook" ? "Email" : source === "document" ? "Document" : source === "mcp" ? "Captured" : source === "dashboard" ? "Dashboard" : source || "";

  const inner = (
    <div className="bg-bg-surface border border-border rounded-lg px-4 py-3.5 hover:border-border-subtle hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <TypeBadge type={thought.type} />
          {sourceLabel && (
            <span className="text-[11px] text-text-muted">{sourceLabel}</span>
          )}
        </div>
        <FormattedDate date={thought.created_at} className="text-[11px] text-text-muted whitespace-nowrap" />
      </div>
      {subject && (
        <p className="text-[13px] font-medium text-text-primary mb-1 truncate">{subject}</p>
      )}
      <p className="text-[13px] text-text-secondary leading-relaxed line-clamp-2">{preview}</p>
    </div>
  );

  if (showLink) {
    return <Link href={`/thoughts/${thought.id}`}>{inner}</Link>;
  }
  return inner;
}
