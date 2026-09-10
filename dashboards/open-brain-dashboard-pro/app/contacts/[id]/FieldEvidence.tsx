import { FormattedDate } from "@/components/FormattedDate";
import type { CrmEvidence } from "@/lib/types";

// Read-only view of the evidence rows the truth layer keeps behind each field.
// Grouped by field so an owner can see *why* a value is what it is (and which
// captured thought a machine writer cited). Rows with no field_key are
// contact-level evidence and fall under "General".

const GENERAL = "__general__";

export function FieldEvidence({
  evidence,
  labels,
}: {
  evidence: CrmEvidence[];
  // Maps a field_key to the friendly label shown in the Fields panel.
  labels: Record<string, string>;
}) {
  // Preserve the order the API returned (newest-first per field) while
  // bucketing by field_key.
  const groups = new Map<string, CrmEvidence[]>();
  for (const row of evidence) {
    const key = row.field_key || GENERAL;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Field evidence</h2>
        <p className="text-text-muted text-xs">
          The captured thoughts each value was drawn from. Machine writers cite their source here.
        </p>
      </div>

      {groups.size === 0 ? (
        <p className="px-4 py-6 text-center text-text-muted text-sm">No evidence recorded.</p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {[...groups.entries()].map(([key, rows]) => (
            <div key={key} className="px-4 py-3">
              <h3 className="text-text-muted text-xs uppercase tracking-wider">
                {key === GENERAL ? "General" : labels[key] || key}
              </h3>
              <ul className="mt-2 space-y-2">
                {rows.map((row) => (
                  <li
                    key={row.evidence_id}
                    className="rounded border border-border-subtle bg-bg-elevated px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span className="uppercase tracking-wider text-violet">{row.role}</span>
                      <span>·</span>
                      <FormattedDate date={row.thought_created_at} />
                    </div>
                    {row.thought_snippet ? (
                      <p className="text-text-primary text-sm mt-1 break-words">{row.thought_snippet}</p>
                    ) : (
                      <p className="text-text-muted text-sm mt-1 italic">No snippet available.</p>
                    )}
                    {row.note && <p className="text-text-secondary text-xs mt-1">{row.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
