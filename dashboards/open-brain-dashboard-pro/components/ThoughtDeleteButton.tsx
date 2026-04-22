"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteModal } from "./DeleteModal";

export function ThoughtDeleteButton({
  deleteAction,
}: {
  deleteAction: () => Promise<void>;
}) {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-3 py-1.5 text-xs font-medium text-danger/70 hover:text-danger border border-danger/20 hover:border-danger/40 rounded-lg transition-colors"
      >
        Delete
      </button>
      {showModal && (
        <DeleteModal
          title="Delete Thought"
          message="This thought will be permanently deleted. This action cannot be undone."
          onConfirm={async () => {
            await deleteAction();
            router.push("/thoughts");
          }}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}
