"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ReflectionInput,
  ReflectionFactor,
} from "@/lib/types";

const REFLECTION_TYPES = [
  "decision_trace",
  "lesson_trace",
  "retrospective",
  "hypothesis",
];

const emptyForm: ReflectionInput = {
  trigger_context: "",
  options: [],
  factors: [],
  conclusion: "",
  reflection_type: "decision_trace",
};

export function ReflectionComposer({ thoughtId }: { thoughtId: number }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ReflectionInput>({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function reset() {
    setForm({ ...emptyForm, options: [], factors: [] });
    setError(null);
  }

  // --- options helpers ---
  function addOption() {
    setForm((f) => ({
      ...f,
      options: [...f.options, { label: "" }],
    }));
  }

  function updateOption(index: number, label: string) {
    setForm((f) => ({
      ...f,
      options: f.options.map((o, i) => (i === index ? { label } : o)),
    }));
  }

  function removeOption(index: number) {
    setForm((f) => ({
      ...f,
      options: f.options.filter((_, i) => i !== index),
    }));
  }

  // --- factors helpers ---
  function addFactor() {
    setForm((f) => ({
      ...f,
      factors: [...f.factors, { label: "", weight: 0.5 }],
    }));
  }

  function updateFactor(
    index: number,
    field: keyof ReflectionFactor,
    value: string | number
  ) {
    setForm((f) => ({
      ...f,
      factors: f.factors.map((fac, i) =>
        i === index ? { ...fac, [field]: value } : fac
      ),
    }));
  }

  function removeFactor(index: number) {
    setForm((f) => ({
      ...f,
      factors: f.factors.filter((_, i) => i !== index),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.trigger_context.trim() && !form.conclusion.trim()) {
      setError("At least trigger context or conclusion is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    // Filter out empty options/factors
    const payload: ReflectionInput = {
      ...form,
      options: form.options.filter((o) => o.label.trim()),
      factors: form.factors.filter((f) => f.label.trim()),
    };

    try {
      const res = await fetch(`/api/thoughts/${thoughtId}/reflection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save reflection");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-violet hover:text-violet-dim transition-colors"
      >
        + Add Reflection
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bg-surface border border-violet/30 rounded-lg p-5 space-y-4"
    >
      <h3 className="text-sm font-medium text-text-primary">New Reflection</h3>

      {/* Reflection type */}
      <div>
        <label className="block text-xs text-text-muted mb-1">Type</label>
        <select
          value={form.reflection_type}
          onChange={(e) =>
            setForm((f) => ({ ...f, reflection_type: e.target.value }))
          }
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
        >
          {REFLECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Trigger context */}
      <div>
        <label className="block text-xs text-text-muted mb-1">
          What prompted this?
        </label>
        <textarea
          value={form.trigger_context}
          onChange={(e) =>
            setForm((f) => ({ ...f, trigger_context: e.target.value }))
          }
          rows={3}
          className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
          placeholder="Context or trigger for this reflection..."
        />
      </div>

      {/* Options */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-text-muted">Options</label>
          <button
            type="button"
            onClick={addOption}
            className="text-xs text-violet hover:text-violet-dim transition-colors"
          >
            + Add option
          </button>
        </div>
        {form.options.map((opt, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              type="text"
              value={opt.label}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              className="text-xs text-text-muted hover:text-red-400 transition-colors px-2"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Factors */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-text-muted">Factors</label>
          <button
            type="button"
            onClick={addFactor}
            className="text-xs text-violet hover:text-violet-dim transition-colors"
          >
            + Add factor
          </button>
        </div>
        {form.factors.map((fac, i) => (
          <div key={i} className="flex gap-2 mb-2 items-center">
            <input
              type="text"
              value={fac.label}
              onChange={(e) => updateFactor(i, "label", e.target.value)}
              placeholder={`Factor ${i + 1}`}
              className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-violet"
            />
            <div className="flex items-center gap-1">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={fac.weight}
                onChange={(e) =>
                  updateFactor(i, "weight", parseFloat(e.target.value))
                }
                className="w-20 accent-violet"
              />
              <span className="text-xs text-text-muted w-7 text-right">
                {fac.weight.toFixed(1)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeFactor(i)}
              className="text-xs text-text-muted hover:text-red-400 transition-colors px-2"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Conclusion */}
      <div>
        <label className="block text-xs text-text-muted mb-1">
          What was decided or learned?
        </label>
        <textarea
          value={form.conclusion}
          onChange={(e) =>
            setForm((f) => ({ ...f, conclusion: e.target.value }))
          }
          rows={3}
          className="w-full bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text-primary focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition resize-y"
          placeholder="Conclusion or lesson..."
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium bg-violet hover:bg-violet-dim text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save Reflection"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-elevated border border-border rounded-lg hover:bg-bg-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
