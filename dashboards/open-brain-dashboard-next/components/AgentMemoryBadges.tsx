import type { AgentMemory, AgentMemoryRecord } from "@/lib/types";

type PolicyLike =
  | AgentMemory["use_policy"]
  | {
      can_use_as_instruction: boolean;
      can_use_as_evidence: boolean;
      requires_user_confirmation: boolean;
    };

export function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "confirmed"
      ? "border-success/30 bg-success/10 text-success"
      : value === "pending"
        ? "border-warning/30 bg-warning/10 text-warning"
        : value === "rejected" || value === "disputed"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-border bg-bg-elevated text-text-secondary";

  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${tone}`}>
      {value}
    </span>
  );
}

export function ProvenanceBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border border-info/30 bg-info/10 text-info">
      {value}
    </span>
  );
}

export function PolicyBadges({ policy }: { policy: PolicyLike }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {policy.can_use_as_instruction && (
        <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">
          instruction
        </span>
      )}
      {policy.can_use_as_evidence && (
        <span className="rounded bg-info/10 px-2 py-0.5 text-xs text-info">
          evidence
        </span>
      )}
      {policy.requires_user_confirmation && (
        <span className="rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">
          needs review
        </span>
      )}
      {!policy.can_use_as_instruction && !policy.can_use_as_evidence && (
        <span className="rounded bg-danger/10 px-2 py-0.5 text-xs text-danger">
          blocked
        </span>
      )}
    </div>
  );
}

export function MemoryRecordPolicy({ memory }: { memory: AgentMemoryRecord }) {
  return (
    <PolicyBadges
      policy={{
        can_use_as_instruction: memory.can_use_as_instruction,
        can_use_as_evidence: memory.can_use_as_evidence,
        requires_user_confirmation: memory.requires_user_confirmation,
      }}
    />
  );
}
