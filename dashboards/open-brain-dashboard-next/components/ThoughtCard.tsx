import Link from "next/link";
import type { Thought } from "@/lib/types";
import { FormattedDate } from "@/components/FormattedDate";

const typeColors: Record<string, string> = {
  idea: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  task: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  person_note: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  reference: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  decision: "bg-violet/15 text-violet border-violet/20",
  lesson: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  meeting: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  journal: "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

export function TypeBadge({ type }: { type: string }) {
  const colors = typeColors[type] || typeColors.reference;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors}`}
    >
      {type}
    </span>
  );
}

export function ThoughtCard({
  thought,
  showLink = true,
}: {
  thought: Thought;
  showLink?: boolean;
}) {
  const preview =
    thought.content.length > 200
      ? thought.content.slice(0, 200) + "..."
      : thought.content;

  const inner = (
    <div className="bg-bg-surface border border-border rounded-lg p-4 hover:border-violet/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <TypeBadge type={thought.type} />
          {thought.importance > 0 && (
            <span className="text-xs text-text-muted">
              imp: {thought.importance}
            </span>
          )}
        </div>
        <FormattedDate date={thought.created_at} className="text-xs text-text-muted whitespace-nowrap" />
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">{preview}</p>
      {thought.source_type && (
        <span className="inline-block mt-2 text-xs text-text-muted">
          {thought.source_type}
        </span>
      )}
    </div>
  );

  if (showLink) {
    return <Link href={`/thoughts/${thought.id}`}>{inner}</Link>;
  }
  return inner;
}
