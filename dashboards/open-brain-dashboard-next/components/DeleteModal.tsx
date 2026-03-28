"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function DeleteModal({
  title = "Confirm Delete",
  message,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }, [onConfirm]);

  useEffect(() => {
    cancelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable =
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onCancel}
      />
      <div className="relative bg-bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3
          id={titleId}
          className="text-lg font-semibold text-text-primary mb-2"
        >
          {title}
        </h3>
        <p id={descId} className="text-sm text-text-secondary mb-6">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-elevated border border-border rounded-lg hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="px-4 py-2 text-sm font-medium text-white bg-danger/80 hover:bg-danger rounded-lg transition-colors disabled:opacity-50"
          >
            {confirming ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
