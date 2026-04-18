"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

export function QuickCapture({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await action(formData);
        ref.current?.reset();
        router.refresh();
      }}
      className="flex gap-2"
    >
      <input
        name="content"
        type="text"
        placeholder="Capture a thought..."
        required
        className="flex-1 px-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition"
      />
      <button
        type="submit"
        className="px-5 py-2.5 bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors"
      >
        Capture
      </button>
    </form>
  );
}
