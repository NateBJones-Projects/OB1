import { NextResponse } from "next/server";
import { requireSession, getSession, AuthError } from "@/lib/auth";
import { crmAvailable, wikiAvailable } from "@/lib/api";

/**
 * POST /api/capabilities/recheck — re-probes both optional surfaces (CRM,
 * wiki) and writes the results into the session. Lets a user who just applied
 * a schema pick it up immediately via the "Re-check now" button instead of
 * signing out and back in (the only other way to re-run the login-time probe).
 */
export async function POST() {
  let apiKey: string;
  try {
    ({ apiKey } = await requireSession());
  } catch (err) {
    if (err instanceof AuthError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  let crmEnabled: boolean;
  let wikiEnabled: boolean;
  try {
    [crmEnabled, wikiEnabled] = await Promise.all([
      crmAvailable(apiKey),
      wikiAvailable(apiKey),
    ]);
  } catch (err) {
    // crmAvailable/wikiAvailable already swallow their own upstream errors and
    // resolve to false — this catch only guards against something unexpected
    // (e.g. a thrown non-ApiError) so the route never 500s on a re-check.
    console.error("[capabilities/recheck]", err);
    return NextResponse.json(
      { error: "Failed to re-check capabilities" },
      { status: 500 }
    );
  }

  const session = await getSession();
  session.crmEnabled = crmEnabled;
  session.wikiEnabled = wikiEnabled;
  await session.save();

  return NextResponse.json({ crmEnabled, wikiEnabled });
}
