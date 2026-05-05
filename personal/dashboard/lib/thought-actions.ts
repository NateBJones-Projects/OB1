"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { ok: false; error: string };

async function callUpdateThought(payload: Record<string, unknown>): Promise<Result> {
  const url = process.env.UPDATE_THOUGHT_URL;
  const secret = process.env.UPDATE_THOUGHT_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "UPDATE_THOUGHT_URL or UPDATE_THOUGHT_SECRET missing" };
  }

  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dashboard-secret": secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    return { ok: false, error: `${r.status}: ${msg.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function editThought(id: string, content: string): Promise<Result> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, error: "empty content" };
  if (trimmed.length > 100_000) return { ok: false, error: "content too long" };

  const result = await callUpdateThought({ action: "edit", id, content: trimmed });
  if (result.ok) {
    revalidatePath(`/t/${id}`);
    revalidatePath("/");
  }
  return result;
}

export async function softDeleteThought(id: string): Promise<void> {
  const result = await callUpdateThought({ action: "delete", id });
  if (!result.ok) {
    redirect(`/t/${id}?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath("/");
  redirect(`/?deleted=${encodeURIComponent(id)}`);
}

export async function undeleteThought(id: string): Promise<void> {
  const result = await callUpdateThought({ action: "undelete", id });
  if (!result.ok) {
    redirect(`/?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath("/");
  revalidatePath(`/t/${id}`);
  redirect("/");
}
