import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const decision = formData.get("decision");
  const authorizationId = String(formData.get("authorization_id") || "");

  if (!authorizationId) {
    return NextResponse.json({ error: "Missing authorization_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  if (decision === "approve") {
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.redirect(data.redirect_url);
  }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.redirect(data.redirect_url);
}
