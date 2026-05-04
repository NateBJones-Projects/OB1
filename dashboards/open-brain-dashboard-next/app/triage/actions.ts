"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { promotePendingThought } from "@/lib/triage";

export async function promotePendingThoughtAction(formData: FormData) {
  await requireSession();

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing pending thought id.");

  await promotePendingThought(id);
  revalidatePath("/triage");
  revalidatePath("/thoughts");
}
