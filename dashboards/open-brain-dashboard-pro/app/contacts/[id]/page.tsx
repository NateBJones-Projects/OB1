import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchCrmContact, fetchCrmFieldEvidence, fetchCrmProposals, resolveCrmProposal, patchCrmContact, setCrmFieldLock, addCrmMethod, fetchCrmRelationshipItems, addCrmNote, updateCrmNote, addCrmTask, updateCrmTask, addCrmImportantDate, updateCrmImportantDate, fetchCrmTimeline, fetchCrmHistory, ApiError } from "@/lib/api";
import { requireSessionOrRedirect, getSession } from "@/lib/auth";
import { FormattedDate } from "@/components/FormattedDate";
import { EditableFactPanel } from "./EditableFactPanel";
import type { EditResult, EditableField } from "./EditableFactPanel";
import { AddMethodForm } from "./AddMethodForm";
import type { AddMethodResult } from "./AddMethodForm";
import { FieldEvidence } from "./FieldEvidence";
import { ContactProposals } from "./ContactProposals";
import type { ResolveResult } from "./ContactProposals";
import { RelationshipPanel } from "./RelationshipPanel";
import type { ItemResult } from "./RelationshipPanel";
import { ContactActivity } from "./ContactActivity";
import type { CrmContactRecord, CrmEvidence, CrmProposal, CrmRelationshipItems, CrmTimelineEvent, CrmChangeLogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const DISPLAY_FIELDS: Array<{ key: keyof CrmContactRecord; label: string }> = [
  { key: "display_name", label: "Name" },
  { key: "preferred_name", label: "Preferred name" },
  { key: "given_name", label: "Given name" },
  { key: "family_name", label: "Family name" },
  { key: "pronouns", label: "Pronouns" },
  { key: "job_title", label: "Title" },
  { key: "organization_name", label: "Organization" },
  { key: "location", label: "Location" },
  { key: "relationship_note", label: "Note" },
  { key: "owner_label", label: "Owner" },
];

// Fields a human owner may edit inline. Everything else (e.g. owner_label) is
// read-only here. The set also gates the server action so an arbitrary column
// can never be smuggled into the patch body.
const EDITABLE_KEYS = new Set<string>([
  "display_name",
  "preferred_name",
  "given_name",
  "family_name",
  "pronouns",
  "job_title",
  "organization_name",
  "location",
  "relationship_note",
]);

async function editFieldAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const fieldKey = String(formData.get("field_key") || "");
  const expected = String(formData.get("expected_updated_at") || "") || null;
  const raw = String(formData.get("value") ?? "").trim();
  if (!id || !EDITABLE_KEYS.has(fieldKey)) {
    return { error: "That field can't be edited here." };
  }
  // Blank clears the field; the truth layer treats null as "unset".
  const value = raw === "" ? null : raw;

  try {
    await patchCrmContact(apiKey, id, {
      patch: { [fieldKey]: value },
      actor: "dashboard",
      origin: "manual",
      expected_updated_at: expected,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/edit] upstream", err.status, err.upstreamBody);
      if (err.status === 409) {
        return {
          stale: true,
          error:
            "This contact changed since you loaded it. Reload to pull the latest values, then edit again.",
        };
      }
      if (err.status === 403) {
        return { error: "This field is locked or restricted." };
      }
      return { error: err.message };
    }
    console.error("[contact/edit]", err);
    return { error: "Failed to save." };
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function lockFieldAction(
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const fieldKey = String(formData.get("field_key") || "");
  // The form sends the desired next state, computed from the current lock.
  const locked = String(formData.get("locked") || "") === "true";
  if (!id || !EDITABLE_KEYS.has(fieldKey)) {
    return { error: "That field can't be locked here." };
  }

  try {
    await setCrmFieldLock(apiKey, id, {
      field_key: fieldKey,
      locked,
      actor: "dashboard",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/lock] upstream", err.status, err.upstreamBody);
      if (err.status === 403) {
        return { error: "You can't change the lock on this field." };
      }
      return { error: err.message };
    }
    console.error("[contact/lock]", err);
    return { error: "Failed to update the lock." };
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function addMethodAction(
  _prev: AddMethodResult,
  formData: FormData
): Promise<AddMethodResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const rawType = String(formData.get("method_type") || "").trim();
  const customType = String(formData.get("method_type_custom") || "").trim();
  const methodType = rawType === "other" ? customType : rawType;
  const value = String(formData.get("value") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const isPrimary = String(formData.get("is_primary") || "") === "true";
  if (!id) {
    return { error: "Missing contact." };
  }
  if (!methodType) {
    return { error: "Pick or name a method type." };
  }
  if (!value) {
    return { error: "Enter a value." };
  }

  try {
    await addCrmMethod(apiKey, id, {
      method_type: methodType,
      value,
      label: label || undefined,
      is_primary: isPrimary,
      actor: "dashboard",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/add-method] upstream", err.status, err.upstreamBody);
      if (err.status === 403) {
        return { error: "You can't add a method to this contact." };
      }
      return { error: err.message };
    }
    console.error("[contact/add-method]", err);
    return { error: "Failed to add the method." };
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function resolveProposalAction(
  _prev: ResolveResult,
  formData: FormData
): Promise<ResolveResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const contactId = String(formData.get("contact_id") || "");
  const proposalId = String(formData.get("proposal_id") || "");
  const decision = String(formData.get("decision") || "");
  if (!proposalId || (decision !== "accept" && decision !== "reject")) {
    return { error: "That decision can't be recorded." };
  }

  try {
    await resolveCrmProposal(apiKey, proposalId, {
      decision,
      actor: "dashboard",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/resolve-proposal] upstream", err.status, err.upstreamBody);
      if (err.status === 409) {
        return { error: "This proposal was already decided. Reload to refresh." };
      }
      if (err.status === 403) {
        return { error: "You can't decide this proposal." };
      }
      if (err.status === 404) {
        return { error: "This proposal no longer exists. Reload to refresh." };
      }
      return { error: err.message };
    }
    console.error("[contact/resolve-proposal]", err);
    return { error: "Failed to record the decision." };
  }

  if (contactId) {
    revalidatePath(`/contacts/${contactId}`);
  }
  return { ok: true };
}

// Shared error handling for the relationship-item actions (notes/tasks/dates):
// log the upstream body server-side, surface only a short message to the client.
function relationshipItemError(scope: string, err: unknown): ItemResult {
  if (err instanceof ApiError) {
    console.error(`[contact/${scope}] upstream`, err.status, err.upstreamBody);
    if (err.status === 403) return { error: "You can't change this contact." };
    if (err.status === 404) return { error: "That item no longer exists. Reload to refresh." };
    return { error: err.message };
  }
  console.error(`[contact/${scope}]`, err);
  return { error: "Something went wrong. Try again." };
}

async function addNoteAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const body = String(formData.get("body") ?? "").trim();
  const noteType = String(formData.get("note_type") || "").trim();
  const pinned = String(formData.get("pinned") || "") === "true";
  if (!id) return { error: "Missing contact." };
  if (!body) return { error: "Enter a note." };

  try {
    await addCrmNote(apiKey, id, {
      body,
      note_type: noteType || undefined,
      pinned,
      actor: "dashboard",
    });
  } catch (err) {
    return relationshipItemError("add-note", err);
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function pinNoteAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const noteId = String(formData.get("note_id") || "");
  const pinned = String(formData.get("pinned") || "") === "true";
  if (!noteId) return { error: "Missing note." };

  try {
    await updateCrmNote(apiKey, noteId, { pinned, actor: "dashboard" });
  } catch (err) {
    return relationshipItemError("pin-note", err);
  }

  if (id) revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function addTaskAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const taskType = String(formData.get("task_type") || "").trim();
  const priority = String(formData.get("priority") || "").trim();
  // datetime-local yields "YYYY-MM-DDTHH:MM"; pass through as-is, blank clears.
  const dueAt = String(formData.get("due_at") || "").trim();
  if (!id) return { error: "Missing contact." };
  if (!title) return { error: "Enter a title." };

  try {
    await addCrmTask(apiKey, id, {
      title,
      description: description || undefined,
      task_type: taskType || undefined,
      priority: priority || undefined,
      due_at: dueAt || undefined,
      actor: "dashboard",
    });
  } catch (err) {
    return relationshipItemError("add-task", err);
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function setTaskStatusAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const taskId = String(formData.get("task_id") || "");
  const status = String(formData.get("status") || "");
  if (!taskId || (status !== "open" && status !== "completed")) {
    return { error: "That change can't be recorded." };
  }

  try {
    await updateCrmTask(apiKey, taskId, { status, actor: "dashboard" });
  } catch (err) {
    return relationshipItemError("set-task-status", err);
  }

  if (id) revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function addDateAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const label = String(formData.get("label") ?? "").trim();
  const dateValue = String(formData.get("date_value") || "").trim();
  const dateKind = String(formData.get("date_kind") || "").trim();
  const recurrence = String(formData.get("recurrence_annual") || "") === "true" ? "annual" : "none";
  if (!id) return { error: "Missing contact." };
  if (!label) return { error: "Enter a label." };
  if (!dateValue) return { error: "Pick a date." };

  try {
    await addCrmImportantDate(apiKey, id, {
      label,
      date_value: dateValue,
      date_kind: dateKind || undefined,
      recurrence,
      actor: "dashboard",
    });
  } catch (err) {
    return relationshipItemError("add-date", err);
  }

  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

async function removeDateAction(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const id = String(formData.get("id") || "");
  const dateId = String(formData.get("date_id") || "");
  if (!dateId) return { error: "Missing date." };

  try {
    await updateCrmImportantDate(apiKey, dateId, { deleted: true, actor: "dashboard" });
  } catch (err) {
    return relationshipItemError("remove-date", err);
  }

  if (id) revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { apiKey } = await requireSessionOrRedirect();
  const session = await getSession();
  const excludeRestricted = session.restrictedUnlocked !== true;
  const { id } = await params;

  let bundle;
  try {
    bundle = await fetchCrmContact(apiKey, id, excludeRestricted);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact] upstream", err.status, err.upstreamBody);
      if (err.status === 403) {
        return (
          <div className="space-y-4">
            <Link href="/contacts" className="text-sm text-text-muted hover:text-violet transition-colors">← Contacts</Link>
            <div className="bg-bg-surface border border-border rounded-lg p-8 text-center">
              <p className="text-text-secondary">This contact is restricted.</p>
              <p className="text-text-muted text-sm mt-1">Unlock restricted content to view it.</p>
            </div>
          </div>
        );
      }
      if (err.status === 404) {
        return (
          <div className="space-y-4">
            <Link href="/contacts" className="text-sm text-text-muted hover:text-violet transition-colors">← Contacts</Link>
            <p className="text-text-secondary">Contact not found.</p>
          </div>
        );
      }
    } else {
      console.error("[contact]", err);
    }
    return (
      <div className="space-y-4">
        <Link href="/contacts" className="text-sm text-text-muted hover:text-violet transition-colors">← Contacts</Link>
        <p className="text-danger text-sm">Failed to load contact.</p>
      </div>
    );
  }

  const { record, methods, aliases } = bundle;
  const provenance = record.field_provenance || {};

  // Field evidence is a separate, optional read: an older brain may not expose
  // the route, so a failure here degrades to an empty panel rather than blanking
  // the whole contact page.
  let evidence: CrmEvidence[] = [];
  try {
    const res = await fetchCrmFieldEvidence(apiKey, id, {
      exclude_restricted: excludeRestricted,
    });
    evidence = res.evidence;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/evidence] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contact/evidence]", err);
    }
  }
  const fieldLabels: Record<string, string> = Object.fromEntries(
    DISPLAY_FIELDS.map(({ key, label }) => [String(key), label])
  );

  // Open proposals for this contact are another optional read: brains without the
  // CRM engagement layer won't expose the route, so a failure degrades to an empty
  // (hidden) section rather than blanking the page.
  let proposals: CrmProposal[] = [];
  try {
    const res = await fetchCrmProposals(apiKey, {
      contact_id: id,
      status: "open",
      per_page: 50,
    });
    proposals = res.data;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/proposals] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contact/proposals]", err);
    }
  }

  // Notes / tasks / important dates from the CRM engagement layer. Optional, so
  // a brain without the route degrades to an empty (add-only) panel.
  let relationshipItems: CrmRelationshipItems = { notes: [], tasks: [], important_dates: [] };
  try {
    relationshipItems = await fetchCrmRelationshipItems(apiKey, id, excludeRestricted);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/relationship-items] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contact/relationship-items]", err);
    }
  }

  // Merged activity timeline (changes + interactions + evidence). Optional read;
  // degrade to an empty timeline rather than blanking the page.
  let timeline: CrmTimelineEvent[] = [];
  try {
    const res = await fetchCrmTimeline(apiKey, id, { exclude_restricted: excludeRestricted });
    timeline = res.timeline;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/timeline] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contact/timeline]", err);
    }
  }

  // Raw field change log (first page). Optional read; degrades to empty.
  let history: CrmChangeLogEntry[] = [];
  try {
    const res = await fetchCrmHistory(apiKey, id, { per_page: 50 });
    history = res.history;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contact/history] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contact/history]", err);
    }
  }

  // Editable fields always render (even when empty, so an owner can fill them);
  // read-only fields only render when populated.
  const fieldData: EditableField[] = DISPLAY_FIELDS.map(({ key, label }) => {
    const raw = record[key];
    const value = raw === null || raw === undefined ? "" : String(raw);
    const prov = provenance[key as string];
    return {
      key: String(key),
      label,
      value,
      origin: prov?.origin,
      locked: prov?.locked,
      editable: EDITABLE_KEYS.has(key as string),
    };
  }).filter((f) => f.editable || f.value !== "");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contacts" className="text-sm text-text-muted hover:text-violet transition-colors">← Contacts</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold">{record.display_name}</h1>
          {record.lifecycle_status === "archived" && (
            <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg-elevated text-text-muted">archived</span>
          )}
        </div>
        {(record.job_title || record.organization_name) && (
          <p className="text-text-secondary text-sm mt-1">
            {[record.job_title, record.organization_name].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Fact panel */}
      <EditableFactPanel
        contactId={record.id}
        updatedAt={record.updated_at}
        fields={fieldData}
        action={editFieldAction}
        lockAction={lockFieldAction}
      />

      {/* Field evidence */}
      <FieldEvidence evidence={evidence} labels={fieldLabels} />

      {/* Open proposals */}
      <ContactProposals
        contactId={record.id}
        proposals={proposals}
        action={resolveProposalAction}
      />

      {/* Methods */}
      <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Contact methods</h2>
        </div>
        {methods.length === 0 ? (
          <p className="px-4 py-6 text-center text-text-muted text-sm">No methods.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {methods.map((method) => (
              <li key={method.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-text-muted text-xs uppercase tracking-wider w-16">{method.method_type}</span>
                <span className="text-text-primary flex-1 break-words">{method.value}</span>
                {method.label && <span className="text-xs text-text-muted">{method.label}</span>}
                {method.is_primary && <span className="text-xs text-violet">primary</span>}
              </li>
            ))}
          </ul>
        )}
        <AddMethodForm contactId={record.id} action={addMethodAction} />
      </section>

      {/* Notes, tasks & important dates */}
      <RelationshipPanel
        contactId={record.id}
        notes={relationshipItems.notes}
        tasks={relationshipItems.tasks}
        importantDates={relationshipItems.important_dates}
        addNote={addNoteAction}
        pinNote={pinNoteAction}
        addTask={addTaskAction}
        setTaskStatus={setTaskStatusAction}
        addDate={addDateAction}
        removeDate={removeDateAction}
      />

      {/* Activity (timeline / change log) */}
      <ContactActivity timeline={timeline} history={history} />

      {/* Aliases */}
      {aliases.length > 0 && (
        <section className="bg-bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Aliases</h2>
          </div>
          <ul className="divide-y divide-border-subtle">
            {aliases.map((alias) => (
              <li key={alias.id} className="px-4 py-3 text-sm text-text-primary">{alias.alias}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-text-muted text-xs">
        Created <FormattedDate date={record.created_at} /> · Updated <FormattedDate date={record.updated_at} />
      </p>
    </div>
  );
}
