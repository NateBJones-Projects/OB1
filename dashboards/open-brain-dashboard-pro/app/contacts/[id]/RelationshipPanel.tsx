"use client";

import { useActionState, useState } from "react";
import { FormattedDate } from "@/components/FormattedDate";
import type { CrmNote, CrmTask, CrmImportantDate } from "@/lib/types";

// Every relationship-item server action returns one of these; `undefined` is
// the initial state.
export type ItemResult = { ok: true } | { error: string } | undefined;

type Action = (prev: ItemResult, formData: FormData) => Promise<ItemResult>;

const NOTE_TYPES = ["relationship_note", "private_note", "context"];
const TASK_TYPES = ["follow_up", "reminder", "todo"];
const TASK_PRIORITIES = ["low", "normal", "high"];
const DATE_KINDS = ["birthday", "anniversary", "work_anniversary", "other"];

const inputClass =
  "w-full px-3 py-1.5 bg-bg-elevated border border-border rounded text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition";
const labelClass = "block text-text-muted text-xs uppercase tracking-wider mb-1";
const primaryBtn =
  "text-xs px-3 py-1.5 rounded bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** A small form whose submit button toggles one field on an existing item. */
function InlineToggle({
  action,
  fields,
  label,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <span className="inline-flex flex-col items-start">
      <form action={formAction}>
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button type="submit" disabled={pending} className={ghostBtn}>
          {pending ? "…" : label}
        </button>
      </form>
      {state && "error" in state && <span className="text-danger text-xs mt-1">{state.error}</span>}
    </span>
  );
}

/** Collapsible "+ Add …" affordance shared by the three add forms. */
function AddForm({
  contactId,
  action,
  openLabel,
  submitLabel,
  children,
}: {
  contactId: string;
  action: Action;
  openLabel: string;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ItemResult, formData: FormData) => {
      const result = await action(prev, formData);
      if (result && "ok" in result && result.ok) setOpen(false);
      return result;
    },
    undefined
  );

  if (!open) {
    return (
      <div className="px-4 py-3 border-t border-border">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-text-muted hover:text-violet transition-colors">
          {openLabel}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="px-4 py-3 border-t border-border space-y-3">
      <input type="hidden" name="id" value={contactId} />
      {children}
      {state && "error" in state && <p className="text-danger text-xs">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">
          {title} <span className="text-text-muted font-normal">({count})</span>
        </h2>
      </div>
      {children}
    </section>
  );
}

export function RelationshipPanel({
  contactId,
  notes,
  tasks,
  importantDates,
  addNote,
  pinNote,
  addTask,
  setTaskStatus,
  addDate,
  removeDate,
}: {
  contactId: string;
  notes: CrmNote[];
  tasks: CrmTask[];
  importantDates: CrmImportantDate[];
  addNote: Action;
  pinNote: Action;
  addTask: Action;
  setTaskStatus: Action;
  addDate: Action;
  removeDate: Action;
}) {
  return (
    <div className="space-y-6">
      {/* Notes */}
      <Section title="Notes" count={notes.length}>
        {notes.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No notes.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3 space-y-2 text-sm">
                <p className="text-text-primary whitespace-pre-wrap break-words">{note.body}</p>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>{note.note_type}</span>
                  {note.pinned && <span className="text-violet">pinned</span>}
                  <span className="ml-auto"><FormattedDate date={note.created_at} /></span>
                  <InlineToggle
                    action={pinNote}
                    fields={{ note_id: note.id, pinned: note.pinned ? "false" : "true" }}
                    label={note.pinned ? "Unpin" : "Pin"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <AddForm contactId={contactId} action={addNote} openLabel="+ Add note" submitLabel="Add note">
          <div>
            <label htmlFor="note_body" className={labelClass}>Note</label>
            <textarea id="note_body" name="body" required rows={3} placeholder="What happened?" className={inputClass} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="note_type" className={labelClass}>Type</label>
              <select id="note_type" name="note_type" defaultValue="relationship_note" className={inputClass}>
                {NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-text-secondary text-sm pb-1.5">
              <input type="checkbox" name="pinned" value="true" className="accent-violet" />
              Pinned
            </label>
          </div>
        </AddForm>
      </Section>

      {/* Tasks */}
      <Section title="Tasks" count={tasks.length}>
        {tasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No tasks.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {tasks.map((task) => {
              const done = task.status === "completed";
              return (
                <li key={task.id} className="px-4 py-3 space-y-2 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-text-primary font-medium ${done ? "line-through text-text-muted" : ""}`}>{task.title}</span>
                    <span className="text-text-muted text-xs">{task.task_type}</span>
                    {task.priority !== "normal" && <span className="text-text-muted text-xs">· {task.priority}</span>}
                  </div>
                  {task.description && <p className="text-text-secondary whitespace-pre-wrap break-words">{task.description}</p>}
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{task.status}</span>
                    {task.due_at && <span>· due <FormattedDate date={task.due_at} /></span>}
                    <span className="ml-auto">
                      <InlineToggle
                        action={setTaskStatus}
                        fields={{ task_id: task.id, status: done ? "open" : "completed" }}
                        label={done ? "Reopen" : "Complete"}
                      />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <AddForm contactId={contactId} action={addTask} openLabel="+ Add task" submitLabel="Add task">
          <div>
            <label htmlFor="task_title" className={labelClass}>Title</label>
            <input id="task_title" name="title" required placeholder="Follow up on…" className={inputClass} />
          </div>
          <div>
            <label htmlFor="task_description" className={labelClass}>Description</label>
            <textarea id="task_description" name="description" rows={2} placeholder="Optional detail" className={inputClass} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="task_type" className={labelClass}>Type</label>
              <select id="task_type" name="task_type" defaultValue="follow_up" className={inputClass}>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task_priority" className={labelClass}>Priority</label>
              <select id="task_priority" name="priority" defaultValue="normal" className={inputClass}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="task_due" className={labelClass}>Due</label>
              <input id="task_due" type="datetime-local" name="due_at" className={inputClass} />
            </div>
          </div>
        </AddForm>
      </Section>

      {/* Important dates */}
      <Section title="Important dates" count={importantDates.length}>
        {importantDates.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No important dates.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {importantDates.map((d) => (
              <li key={d.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-text-primary font-medium">{d.label}</span>
                <span className="text-text-secondary">{d.date_value}</span>
                <span className="text-text-muted text-xs">{d.date_kind}{d.recurrence === "annual" ? " · annual" : ""}</span>
                <span className="ml-auto">
                  <InlineToggle action={removeDate} fields={{ date_id: d.id }} label="Remove" />
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddForm contactId={contactId} action={addDate} openLabel="+ Add important date" submitLabel="Add date">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[10rem]">
              <label htmlFor="date_label" className={labelClass}>Label</label>
              <input id="date_label" name="label" required placeholder="Birthday" className={inputClass} />
            </div>
            <div>
              <label htmlFor="date_value" className={labelClass}>Date</label>
              <input id="date_value" type="date" name="date_value" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="date_kind" className={labelClass}>Kind</label>
              <select id="date_kind" name="date_kind" defaultValue="birthday" className={inputClass}>
                {DATE_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-text-secondary text-sm pb-1.5">
              <input type="checkbox" name="recurrence_annual" value="true" defaultChecked className="accent-violet" />
              Repeats annually
            </label>
          </div>
        </AddForm>
      </Section>
    </div>
  );
}
