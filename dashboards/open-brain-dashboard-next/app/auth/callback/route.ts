import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSession } from "@/lib/auth";
import { exchangeAuthCodeForUser, verifyMagicLink } from "@/lib/supabaseAuth";

function sanitizeNext(next: string | null) {
  if (!next || !next.startsWith("/")) {
    return "/";
  }
  return next;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeNext(searchParams.get("next"));

  try {
    const user = code
      ? await exchangeAuthCodeForUser(code)
      : tokenHash && type
        ? await verifyMagicLink(tokenHash, type)
        : null;

    if (!user) {
      redirect("/login?error=Invalid%20or%20expired%20sign-in%20link");
    }

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email ?? "";
    session.loggedIn = true;
    session.restrictedUnlocked = false;
    await session.save();
  } catch {
    redirect("/login?error=Authentication%20callback%20failed");
  }

  redirect(next);
}
