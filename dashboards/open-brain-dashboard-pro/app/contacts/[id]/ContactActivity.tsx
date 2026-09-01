"use client";

import { useState } from "react";
import { FormattedDate } from "@/components/FormattedDate";
import type { CrmTimelineEvent, CrmChangeLogEntry } from "@/lib/types";

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const EVENT_META: Record<CrmTimelineEvent["type"], { label: string; color: string }> = {
  change: { label: "Change", color: "text-violet border-violet/30 bg-violet-surface" },
  interaction: { label: "Interaction", color: "text-emerald border-emerald/30 bg-emerald/10" },
  evidence: { label: "Evidence", color: "text-text-muted border-border bg-bg-elevated" },
};

function TimelineEventRow({ event }: { event: CrmTimelineEvent }) {
  const meta = EVENT_META[event.type] ?? EVENT_META.change;
  const data = event.data;

  let summary: string;
  if (event.type === "change") {
    const fields = data.changed_fields && typeof data.changed_fields === "object"
      ? Object.keys(data.changed_fields as Record<string, unknown>)
      : [];
    const actor = str(data.actor_label);
    summary = `${str(data.action) || "changed"}${fields.length ? ` · ${fields.join(", ")}` : ""}${actor ? ` · by ${actor}` : ""}`;
  } else if (event.type === "interaction") {
    summary = `${str(data.kind) || "interaction"}${data.summary ? `: ${str(data.summary)}` : ""}`;
  } else {
    const field = str(data.field_key);
    summary = field ? `Evidence for ${field}` : "Evidence";
  }

  const detail = event.type === "evidence" ? str(data.thought_snippet) : "";

  return (
    <li className="px-4 py-3 text-sm flex gap-3">
      <span className={`shrink-0 inline-block text-xs px-2 py-0.5 rounded border h-fit ${meta.color}`}>{meta.label}</span>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary break-words">{summary}</p>
        {detail && <p className="text-text-muted text-xs mt-0.5 break-words">{detail}</p>}
      </div>
      {event.at && (
        <span className="shrink-0 text-text-muted text-xs whitespace-nowrap">
          <FormattedDate date={event.at} />
        </span>
      )}
    </li>
  );
}

function ChangeLogRow({ entry }: { entry: CrmChangeLogEntry }) {
  const fields = entry.changed_fields && typeof entry.changed_fields === "object"
    ? Object.keys(entry.changed_fields)
    : [];
  return (
    <li className="px-4 py-3 text-sm flex gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-text-primary break-words">
          <span className="font-medium">{entry.action || "changed"}</span>
          {fields.length > 0 && <span className="text-text-secondary"> · {fields.join(", ")}</span>}
        </p>
        {entry.actor_label && <p className="text-text-muted text-xs mt-0.5">by {entry.actor_label}</p>}
      </div>
      <span className="shrink-0 text-text-muted text-xs whitespace-nowrap">
        <FormattedDate date={entry.created_at} />
      </span>
    </li>
  );
}

type TabKey = "timeline" | "changelog";

/**
 * Tabbed activity view on the contact detail page: the merged timeline (changes
 * + interactions + evidence) and the raw field change log.
 */
export function ContactActivity({
  timeline,
  history,
}: {
  timeline: CrmTimelineEvent[];
  history: CrmChangeLogEntry[];
}) {
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "timeline", label: "Timeline" },
    { key: "changelog", label: "Change log" },
  ];
  const [active, setActive] = useState<TabKey>("timeline");

  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex gap-1 px-3 py-2 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              active === tab.key
                ? "bg-violet-surface text-violet border border-violet/20"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === "timeline" && (
        timeline.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {timeline.map((event, i) => (
              <TimelineEventRow key={`${event.type}-${event.at}-${i}`} event={event} />
            ))}
          </ul>
        )
      )}

      {active === "changelog" && (
        history.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No changes recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {history.map((entry) => (
              <ChangeLogRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )
      )}
    </section>
  );
}
