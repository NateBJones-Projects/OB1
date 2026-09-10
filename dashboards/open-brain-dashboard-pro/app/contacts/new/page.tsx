import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionOrRedirect } from "@/lib/auth";
import { createCrmContact, ApiError } from "@/lib/api";
import { NewContactForm } from "./NewContactForm";

export const dynamic = "force-dynamic";

async function createAction(
  formData: FormData
): Promise<{ error: string } | undefined> {
  "use server";
  const { apiKey } = await requireSessionOrRedirect();
  const display_name = String(formData.get("display_name") || "").trim();
  if (!display_name) return { error: "Name is required" };

  let contactId: string | null = null;
  try {
    const res = await createCrmContact(apiKey, {
      display_name,
      canonical_email: String(formData.get("canonical_email") || "").trim() || undefined,
      organization_name: String(formData.get("organization_name") || "").trim() || undefined,
      job_title: String(formData.get("job_title") || "").trim() || undefined,
      actor: "dashboard",
    });
    contactId = res.contact_id;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error("[contacts/new] upstream", err.status, err.upstreamBody);
    } else {
      console.error("[contacts/new]", err);
    }
    return { error: err instanceof ApiError ? err.message : "Failed to create contact" };
  }
  // redirect() throws NEXT_REDIRECT, so it must run outside the try/catch above.
  redirect(`/contacts/${contactId}`);
}

export default async function NewContactPage() {
  await requireSessionOrRedirect();
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <Link href="/contacts" className="text-sm text-text-muted hover:text-violet transition-colors">
          ← Contacts
        </Link>
        <h1 className="text-2xl font-semibold mt-2 mb-1">New contact</h1>
        <p className="text-text-secondary text-sm">
          Create a contact you own directly. Machine writers propose changes instead.
        </p>
      </div>
      <NewContactForm action={createAction} />
    </div>
  );
}
