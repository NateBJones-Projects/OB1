import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ConsentPageProps = {
  searchParams: Promise<{
    authorization_id?: string;
  }>;
};

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { authorization_id: authorizationId } = await searchParams;

  if (!authorizationId) {
    return (
      <main className="shell">
        <section className="card stack">
          <span className="pill">Missing Request</span>
          <h1>Authorization request is incomplete.</h1>
          <p className="muted">
            This page expects an <code>authorization_id</code> from Supabase Auth.
          </p>
        </section>
      </main>
    );
  }

  if (authorizationId === "demo") {
    return (
      <main className="shell">
        <section className="card stack">
          <span className="pill">Consent Preview</span>
          <h1>Authorize Open Brain</h1>
          <p className="muted">
            This is the layout your connector users will see during the real OAuth flow.
          </p>
          <div className="meta">
            <div className="meta-row">
              <strong>Client</strong>
              <span>Claude Desktop</span>
            </div>
            <div className="meta-row">
              <strong>Redirect URI</strong>
              <span>https://claude.ai/api/mcp/callback</span>
            </div>
            <div className="meta-row">
              <strong>Requested Permissions</strong>
              <ul className="list">
                <li>openid</li>
                <li>email</li>
                <li>offline_access</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  const { data: authDetails, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !authDetails) {
    return (
      <main className="shell">
        <section className="card stack">
          <span className="pill">Authorization Error</span>
          <h1>Could not load this authorization request.</h1>
          <p className="error">{error?.message || "Supabase returned an invalid authorization request."}</p>
        </section>
      </main>
    );
  }

  if ("redirect_url" in authDetails) {
    redirect(authDetails.redirect_url);
  }

  return (
    <main className="shell">
      <section className="card stack">
        <div>
          <span className="pill">Connector Approval</span>
          <h1 className="headline" style={{ fontSize: "clamp(2rem, 3vw, 3.6rem)" }}>
            Authorize {authDetails.client.name}
          </h1>
          <p className="muted">
            Open Brain keeps this approval narrow: connector identity, requested scopes, and a clear
            approve or deny decision.
          </p>
        </div>

        <div className="meta">
          <div className="meta-row">
            <strong>Signed In As</strong>
            <span>{user.email || user.id}</span>
          </div>
          <div className="meta-row">
            <strong>Client</strong>
            <span>{authDetails.client.name}</span>
          </div>
          <div className="meta-row">
            <strong>Redirect URI</strong>
            <span>{authDetails.redirect_uri}</span>
          </div>
          <div className="meta-row">
            <strong>Requested Permissions</strong>
            {authDetails.scope?.trim() ? (
              <ul className="list">
                {authDetails.scope.split(" ").map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            ) : (
              <span>No additional scopes requested.</span>
            )}
          </div>
        </div>

        <form action="/api/oauth/decision" method="POST" className="button-row">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button type="submit" name="decision" value="approve">
            Approve Access
          </button>
          <button className="ghost-button" type="submit" name="decision" value="deny">
            Deny
          </button>
        </form>
      </section>
    </main>
  );
}
